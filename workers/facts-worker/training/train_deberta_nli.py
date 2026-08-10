#!/usr/bin/env python3
"""Continue fine-tune cross-encoder/nli-deberta-v3-base on mixed NLI datasets.

Produces a checkpoint loadable by:
  python workers/facts-worker/tools/nli_verdicts.py \\
    --backend=deberta --model=model_evals/nli/deberta-ft-10k

The frozen gold set (test/fixtures/nli-gold-set.yaml) must NEVER be used for training.

Usage (smoke, ~10k pairs, local Mac):
  source workers/facts-worker/.venv/bin/activate
  python workers/facts-worker/training/train_deberta_nli.py \\
    --output-dir model_evals/nli/deberta-ft-10k \\
    --max-samples 10000 --epochs 1 --batch-size 8

Full mix (~750k pairs) — prefer HF Jobs A10G:
  python workers/facts-worker/training/train_deberta_nli.py \\
    --output-dir model_evals/nli/deberta-ft-full \\
    --epochs 1 --batch-size 16
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parents[3]

# DeBERTa cross-encoder label order: 0=contradiction, 1=entailment, 2=neutral
DEBERTA_LABELS = ("contradiction", "entailment", "neutral")

# GLUE MNLI / ANLI / FEVER-NLI: 0=entailment, 1=neutral, 2=contradiction
GLUE_TO_DEBERTA = {0: 1, 1: 2, 2: 0}

STRING_TO_DEBERTA = {
    "contradiction": 0,
    "entailment": 1,
    "neutral": 2,
}


def _row(sentence1: str, sentence2: str, label: int) -> Dict[str, Any]:
    return {"sentence1": sentence1.strip(), "sentence2": sentence2.strip(), "label": label}


def _map_glue_label(label: int) -> Optional[int]:
    if label is None or label < 0:
        return None
    return GLUE_TO_DEBERTA.get(int(label))


def _iter_mnli(max_rows: Optional[int] = None) -> Iterator[Dict[str, Any]]:
    from datasets import load_dataset

    ds = load_dataset("nyu-mll/glue", "mnli", split="train")
    count = 0
    for ex in ds:
        label = _map_glue_label(ex.get("label"))
        if label is None:
            continue
        yield _row(ex["premise"], ex["hypothesis"], label)
        count += 1
        if max_rows and count >= max_rows:
            return


def _iter_anli(max_rows: Optional[int] = None) -> Iterator[Dict[str, Any]]:
    from datasets import load_dataset

    count = 0
    for split in ("train_r1", "train_r2", "train_r3"):
        ds = load_dataset("facebook/anli", split=split)
        for ex in ds:
            label = _map_glue_label(ex.get("label"))
            if label is None:
                continue
            yield _row(ex["premise"], ex["hypothesis"], label)
            count += 1
            if max_rows and count >= max_rows:
                return


def _iter_wanli(max_rows: Optional[int] = None) -> Iterator[Dict[str, Any]]:
    from datasets import load_dataset

    ds = load_dataset("alisawuffles/WANLI", split="train")
    count = 0
    for ex in ds:
        label = STRING_TO_DEBERTA.get(str(ex.get("gold", "")).lower())
        if label is None:
            continue
        yield _row(ex["premise"], ex["hypothesis"], label)
        count += 1
        if max_rows and count >= max_rows:
            return


def _iter_fever(max_rows: Optional[int] = None) -> Iterator[Dict[str, Any]]:
    from datasets import load_dataset

    ds = load_dataset("pietrolesci/nli_fever", split="train")
    count = 0
    for ex in ds:
        label = _map_glue_label(ex.get("label"))
        if label is None:
            continue
        yield _row(ex["premise"], ex["hypothesis"], label)
        count += 1
        if max_rows and count >= max_rows:
            return


def _iter_paraphrase(max_rows: Optional[int] = None) -> Iterator[Dict[str, Any]]:
    """MNLI paraphrase bank: (premise, paraphrase) with preserved NLI label."""
    from datasets import load_dataset

    ds = load_dataset("Lidor-Mashiach/mnli-paraphrase-bank", split="train")
    count = 0
    for ex in ds:
        label = _map_glue_label(ex.get("label"))
        para = (ex.get("paraphrase") or "").strip()
        premise = (ex.get("premise") or "").strip()
        if label is None or not para or not premise:
            continue
        yield _row(premise, para, label)
        count += 1
        if max_rows and count >= max_rows:
            return


LOADERS = {
    "mnli": _iter_mnli,
    "anli": _iter_anli,
    "wanli": _iter_wanli,
    "fever": _iter_fever,
    "paraphrase": _iter_paraphrase,
}

# Default mix weights for capped runs (paraphrase weighted for SGRS gap)
DEFAULT_WEIGHTS = {
    "mnli": 0.35,
    "anli": 0.20,
    "wanli": 0.15,
    "fever": 0.15,
    "paraphrase": 0.15,
}


def _quota(max_samples: int, datasets: List[str], weights: Dict[str, float]) -> Dict[str, int]:
    total_w = sum(weights.get(d, 0.0) for d in datasets) or 1.0
    quotas: Dict[str, int] = {}
    assigned = 0
    for i, name in enumerate(datasets):
        if i == len(datasets) - 1:
            quotas[name] = max(0, max_samples - assigned)
        else:
            q = int(max_samples * weights.get(name, 0.0) / total_w)
            quotas[name] = q
            assigned += q
    return quotas


def build_train_rows(
    datasets: List[str],
    max_samples: Optional[int],
    seed: int,
) -> List[Dict[str, Any]]:
    rng = random.Random(seed)
    rows: List[Dict[str, Any]] = []

    if max_samples is None:
        for name in datasets:
            loader = LOADERS.get(name)
            if loader is None:
                raise ValueError(f"Unknown dataset: {name}")
            for row in loader():
                rows.append(row)
        rng.shuffle(rows)
        return rows

    quotas = _quota(max_samples, datasets, DEFAULT_WEIGHTS)
    for name in datasets:
        loader = LOADERS.get(name)
        if loader is None:
            raise ValueError(f"Unknown dataset: {name}")
        budget = quotas[name]
        if budget <= 0:
            continue
        taken = 0
        for row in loader(max_rows=budget * 3):
            rows.append(row)
            taken += 1
            if taken >= budget:
                break
        print(f"  {name}: {taken}/{budget}", flush=True)

    rng.shuffle(rows)
    return rows[:max_samples]


def build_eval_rows(max_samples: int = 2000) -> List[Dict[str, Any]]:
    from datasets import load_dataset

    ds = load_dataset("nyu-mll/glue", "mnli", split="validation_matched")
    rows: List[Dict[str, Any]] = []
    for ex in ds:
        label = _map_glue_label(ex.get("label"))
        if label is None:
            continue
        rows.append(_row(ex["premise"], ex["hypothesis"], label))
        if len(rows) >= max_samples:
            break
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune DeBERTa NLI cross-encoder")
    parser.add_argument(
        "--base-model",
        default="cross-encoder/nli-deberta-v3-base",
        help="Starting checkpoint (HF id or local path)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=REPO_ROOT / "model_evals" / "nli" / "deberta-ft-10k",
    )
    parser.add_argument(
        "--datasets",
        default="mnli,anli,wanli,fever,paraphrase",
        help="Comma-separated: mnli,anli,wanli,fever,paraphrase",
    )
    parser.add_argument("--max-samples", type=int, default=10_000,
                        help="Cap training rows (omit with --full for entire mix)")
    parser.add_argument("--full", action="store_true",
                        help="Use all rows from selected datasets (~750k+)")
    parser.add_argument("--max-eval-samples", type=int, default=2000)
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--lr", type=float, default=1e-5)
    parser.add_argument("--warmup-ratio", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--no-eval", action="store_true")
    args = parser.parse_args()

    dataset_names = [d.strip() for d in args.datasets.split(",") if d.strip()]
    unknown = [d for d in dataset_names if d not in LOADERS]
    if unknown:
        raise SystemExit(f"Unknown datasets: {unknown}. Choose from: {sorted(LOADERS)}")

    args.output_dir.mkdir(parents=True, exist_ok=True)

    max_samples = None if args.full else args.max_samples

    print(f"Building train set (max_samples={max_samples or 'all'})...", flush=True)
    train_rows = build_train_rows(dataset_names, max_samples, args.seed)
    print(f"  total train rows: {len(train_rows)}", flush=True)

    from datasets import Dataset
    from sentence_transformers import CrossEncoder
    from sentence_transformers.cross_encoder import CrossEncoderTrainer, CrossEncoderTrainingArguments
    from sentence_transformers.cross_encoder.losses import CrossEntropyLoss

    train_dataset = Dataset.from_list(train_rows)
    eval_rows: List[Dict[str, Any]] = []
    eval_dataset = None
    if not args.no_eval:
        eval_rows = build_eval_rows(args.max_eval_samples)
        eval_dataset = Dataset.from_list(eval_rows)
        print(f"  eval rows: {len(eval_rows)}", flush=True)

    model = CrossEncoder(args.base_model, num_labels=3, trust_remote_code=True)

    training_args = CrossEncoderTrainingArguments(
        output_dir=str(args.output_dir),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        learning_rate=args.lr,
        warmup_ratio=args.warmup_ratio,
        fp16=False,
        bf16=False,
        eval_strategy="epoch" if eval_dataset is not None else "no",
        save_strategy="epoch",
        load_best_model_at_end=eval_dataset is not None,
        metric_for_best_model="eval_loss",
        logging_steps=50,
        save_total_limit=2,
        seed=args.seed,
        report_to="none",
    )

    trainer = CrossEncoderTrainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        loss=CrossEntropyLoss(model),
    )

    print(f"Training -> {args.output_dir}", flush=True)
    trainer.train()
    trainer.save_model(str(args.output_dir))

    meta = {
        "base_model": args.base_model,
        "datasets": dataset_names,
        "train_rows": len(train_rows),
        "eval_rows": len(eval_rows),
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "lr": args.lr,
        "label_order": list(DEBERTA_LABELS),
    }
    (args.output_dir / "training_meta.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8"
    )
    print(f"Saved checkpoint + training_meta.json to {args.output_dir}", flush=True)


if __name__ == "__main__":
    main()
