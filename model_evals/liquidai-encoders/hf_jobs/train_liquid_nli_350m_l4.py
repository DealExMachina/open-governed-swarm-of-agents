# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "torch>=2.2",
#   "transformers>=4.48",
#   "datasets>=3.0",
#   "accelerate>=1.0",
#   "numpy>=1.26",
#   "huggingface_hub>=0.27",
#   "scikit-learn>=1.3",
# ]
# ///
"""Full Liquid NLI 350M pipeline on Hugging Face Jobs (L4).

Stage 1: MNLI probe (15k, Liquid recipe)
Stage 2: Domain fine-tune (train.jsonl from Hub, wd=0.1)
Stage 3: Refine (contradiction+neutral, wd=0.01)
Push final checkpoint to HF_HUB_MODEL.

Submit via scripts/run-hf-l4-full-pipeline-350m.sh
"""

from __future__ import annotations

import json
import os
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import numpy as np
import torch
import torch.nn as nn
from huggingface_hub import HfApi, hf_hub_download
from torch.nn import CrossEntropyLoss
from transformers import AutoModelForMaskedLM, AutoTokenizer, Trainer, TrainingArguments
from transformers.modeling_outputs import SequenceClassifierOutput

LABEL_NAMES = ("contradiction", "entailment", "neutral")
DOMAIN_LABEL_TO_ID = {"contradiction": 0, "equivalent": 1, "neutral": 2}
_SNLI_TO_NLI = {0: 1, 1: 2, 2: 0}


def mean_pool(last_hidden: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
    mask = attention_mask.unsqueeze(-1).expand(last_hidden.size()).float()
    summed = torch.sum(last_hidden * mask, dim=1)
    counts = torch.clamp(mask.sum(dim=1), min=1e-9)
    return summed / counts


@dataclass
class NliCheckpointMeta:
    base_model: str
    hidden_size: int
    num_labels: int = 3
    label_order: tuple[str, ...] = ("contradiction", "entailment", "neutral")


class Lfm2NliClassifier(nn.Module):
    def __init__(self, backbone: nn.Module, hidden_size: int, num_labels: int = 3) -> None:
        super().__init__()
        self.backbone = backbone
        self.dropout = nn.Dropout(0.1)
        self.classifier = nn.Linear(hidden_size, num_labels)

    def forward(
        self,
        input_ids: torch.Tensor,
        attention_mask: Optional[torch.Tensor] = None,
        labels: Optional[torch.Tensor] = None,
        **_: Any,
    ) -> SequenceClassifierOutput:
        out = self.backbone(input_ids=input_ids, attention_mask=attention_mask)
        hidden = out.last_hidden_state if hasattr(out, "last_hidden_state") else out[0]
        pooled = mean_pool(hidden, attention_mask)
        logits = self.classifier(self.dropout(pooled))
        loss = None
        if labels is not None:
            loss = nn.functional.cross_entropy(logits, labels)
        return SequenceClassifierOutput(loss=loss, logits=logits)


def build_nli_model(model_id: str, device: str):
    mlm = AutoModelForMaskedLM.from_pretrained(model_id, trust_remote_code=True)
    hidden_size = int(getattr(mlm.config, "hidden_size", 1024))
    model = Lfm2NliClassifier(mlm.lfm2, hidden_size=hidden_size, num_labels=3)
    tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)
    model.to(device)
    meta = NliCheckpointMeta(base_model=model_id, hidden_size=hidden_size)
    return model, tokenizer, meta


def load_nli_checkpoint(checkpoint_dir: Path, device: str):
    cfg = json.loads((checkpoint_dir / "nli_config.json").read_text(encoding="utf-8"))
    base_model = cfg.get("base_model", "LiquidAI/LFM2.5-Encoder-230M")
    mlm = AutoModelForMaskedLM.from_pretrained(base_model, trust_remote_code=True)
    model = Lfm2NliClassifier(
        mlm.lfm2,
        hidden_size=int(cfg.get("hidden_size", 1024)),
        num_labels=int(cfg.get("num_labels", 3)),
    )
    state = torch.load(checkpoint_dir / "nli_classifier.pt", map_location="cpu", weights_only=True)
    model.load_state_dict(state)
    tokenizer = AutoTokenizer.from_pretrained(str(checkpoint_dir), trust_remote_code=True)
    model.to(device)
    meta = NliCheckpointMeta(base_model=base_model, hidden_size=int(cfg.get("hidden_size", 1024)))
    return model, tokenizer, meta


def save_nli_checkpoint(out_dir: Path, model, tokenizer, meta: NliCheckpointMeta, extra: dict | None = None):
    out_dir.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), out_dir / "nli_classifier.pt")
    tokenizer.save_pretrained(out_dir)
    payload = {
        "base_model": meta.base_model,
        "hidden_size": meta.hidden_size,
        "num_labels": meta.num_labels,
        "label_order": list(meta.label_order),
        "architecture": "lfm2_nli_classifier_v1",
    }
    if extra:
        payload.update(extra)
    (out_dir / "nli_config.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def domain_rows_to_examples(rows: list[dict[str, Any]], bidirectional_equivalent: bool) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows:
        label_name = row["label"]
        label_id = DOMAIN_LABEL_TO_ID[label_name]
        out.append({"premise": row["a"], "hypothesis": row["b"], "labels": label_id, "id": row.get("id", "")})
        if bidirectional_equivalent and label_name == "equivalent":
            out.append(
                {
                    "premise": row["b"],
                    "hypothesis": row["a"],
                    "labels": label_id,
                    "id": f"{row.get('id', '')}:rev",
                }
            )
    return out


def load_snli_subset(max_samples: int, seed: int = 42) -> list[dict[str, Any]]:
    from datasets import load_dataset

    ds = load_dataset("stanfordnlp/snli", split="train")
    ds = ds.filter(lambda x: x["label"] != -1)
    if len(ds) > max_samples:
        ds = ds.shuffle(seed=seed).select(range(max_samples))
    rows: list[dict[str, Any]] = []
    for ex in ds:
        rows.append(
            {
                "premise": ex["premise"],
                "hypothesis": ex["hypothesis"],
                "labels": _SNLI_TO_NLI[int(ex["label"])],
                "id": f"snli-{len(rows)}",
            }
        )
    return rows


def mix_datasets(domain: list[dict[str, Any]], snli: list[dict[str, Any]], snli_fraction: float, seed: int):
    rng = random.Random(seed)
    n_snli = int(round(len(domain) * snli_fraction / max(1e-9, (1.0 - snli_fraction))))
    n_snli = min(n_snli, len(snli))
    picked = rng.sample(snli, n_snli) if n_snli else []
    merged = domain + picked
    rng.shuffle(merged)
    return merged


def macro_f1(y_true: list[int], y_pred: list[int]) -> dict[str, float]:
    f1s: list[float] = []
    per: dict[str, float] = {}
    for idx, name in enumerate(LABEL_NAMES):
        tp = sum(1 for t, p in zip(y_true, y_pred) if t == idx and p == idx)
        fp = sum(1 for t, p in zip(y_true, y_pred) if t != idx and p == idx)
        fn = sum(1 for t, p in zip(y_true, y_pred) if t == idx and p != idx)
        prec = tp / (tp + fp) if (tp + fp) else 0.0
        rec = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
        per[f"f1_{name}"] = f1
        f1s.append(f1)
    per["macro_f1"] = float(np.mean(f1s)) if f1s else 0.0
    return per


def rows_to_dataset(rows, tokenizer, max_length):
    from datasets import Dataset

    def tokenize(batch):
        enc = tokenizer(batch["premise"], batch["hypothesis"], truncation=True, max_length=max_length)
        enc["labels"] = batch["labels"]
        return enc

    ds = Dataset.from_dict(
        {
            "premise": [r["premise"] for r in rows],
            "hypothesis": [r["hypothesis"] for r in rows],
            "labels": [r["labels"] for r in rows],
        }
    )
    return ds.map(tokenize, batched=True, remove_columns=ds.column_names)


class WeightedTrainer(Trainer):
    def __init__(self, *a, class_weights=None, **kw):
        super().__init__(*a, **kw)
        self.class_weights = class_weights

    def compute_loss(self, model, inputs, return_outputs=False, **kwargs):
        labels = inputs.pop("labels")
        outputs = model(**inputs)
        loss_fct = CrossEntropyLoss(weight=self.class_weights)
        loss = loss_fct(outputs.logits.view(-1, 3), labels.view(-1))
        return (loss, outputs) if return_outputs else loss


def build_trainer(model, tokenizer, train_rows, eval_rows, args: dict[str, Any], device: str):
    train_dataset = rows_to_dataset(train_rows, tokenizer, args["max_length"])
    eval_dataset = rows_to_dataset(eval_rows, tokenizer, args["max_length"])
    weights = torch.tensor([2.0, 1.0, 1.5], dtype=torch.float32, device=device)

    total_steps = max(1, (len(train_rows) // (args["batch_size"] * args["grad_accum"])) * args["epochs"])
    warmup_steps = max(0, int(total_steps * args.get("warmup_ratio", 0.0)))

    training_args = TrainingArguments(
        output_dir=str(Path(args["out"]) / "runs"),
        num_train_epochs=args["epochs"],
        per_device_train_batch_size=args["batch_size"],
        per_device_eval_batch_size=args["batch_size"],
        gradient_accumulation_steps=args["grad_accum"],
        learning_rate=args["lr"],
        weight_decay=args["weight_decay"],
        warmup_steps=warmup_steps,
        adam_beta2=args.get("adam_beta2", 0.999),
        eval_strategy="epoch",
        save_strategy="no",
        logging_steps=25,
        report_to=[],
        fp16=True,
        dataloader_num_workers=2,
    )

    def compute_metrics(eval_pred):
        logits, labels = eval_pred
        preds = np.argmax(logits, axis=-1)
        metrics = macro_f1(labels.tolist(), preds.tolist())
        metrics["accuracy"] = float((preds == labels).mean())
        return metrics

    return WeightedTrainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        processing_class=tokenizer,
        compute_metrics=compute_metrics,
        class_weights=weights,
    )


def run_probe(model_id: str, device: str, out_dir: Path, max_samples: int, batch: int, grad_accum: int):
    from datasets import load_dataset

    print(f"== Stage 1: MNLI probe ({max_samples} samples) ==")
    model, tokenizer, meta = build_nli_model(model_id, device)
    ds = load_dataset("nyu-mll/glue", "mnli", split="train")
    eval_ds = load_dataset("nyu-mll/glue", "mnli", split="validation_matched")
    ds = ds.filter(lambda x: x["label"] != -1)
    eval_ds = eval_ds.filter(lambda x: x["label"] != -1)
    if len(ds) > max_samples:
        ds = ds.shuffle(seed=42).select(range(max_samples))
    eval_cap = max(500, max_samples // 5)
    if len(eval_ds) > eval_cap:
        eval_ds = eval_ds.shuffle(seed=42).select(range(eval_cap))

    def map_labels(example):
        example["labels"] = _SNLI_TO_NLI[int(example["label"])]
        return example

    ds = ds.map(map_labels)
    eval_ds = eval_ds.map(map_labels)

    def tokenize(batch):
        enc = tokenizer(batch["premise"], batch["hypothesis"], truncation=True, max_length=512)
        enc["labels"] = batch["labels"]
        return enc

    tokenized = ds.map(tokenize, batched=True, remove_columns=ds.column_names)
    tokenized_eval = eval_ds.map(tokenize, batched=True, remove_columns=eval_ds.column_names)

    total_steps = max(1, (len(tokenized) // (batch * grad_accum)) * 2)
    warmup_steps = max(1, int(total_steps * 0.1))

    training_args = TrainingArguments(
        output_dir=str(out_dir / "runs"),
        num_train_epochs=2,
        per_device_train_batch_size=batch,
        per_device_eval_batch_size=batch,
        gradient_accumulation_steps=grad_accum,
        learning_rate=2e-5,
        weight_decay=0.1,
        warmup_steps=warmup_steps,
        adam_beta2=0.95,
        eval_strategy="epoch",
        save_strategy="no",
        logging_steps=50,
        report_to=[],
        fp16=True,
        dataloader_num_workers=2,
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized,
        eval_dataset=tokenized_eval,
        processing_class=tokenizer,
        compute_metrics=lambda ep: {"accuracy": float((np.argmax(ep.predictions, axis=-1) == ep.label_ids).mean())},
    )
    trainer.train()
    metrics = trainer.evaluate()
    print("Stage 1 eval:", metrics)
    save_nli_checkpoint(out_dir, model, tokenizer, meta, extra={"stage": "mnli-probe-350m-l4", "metrics": metrics})
    return out_dir


def run_domain(model_id: str, device: str, probe_dir: Path, train_path: Path, eval_path: Path, out_dir: Path, batch: int, grad_accum: int):
    print("== Stage 2: domain adaptation ==")
    model, tokenizer, meta = load_nli_checkpoint(probe_dir, device)
    train_raw = load_jsonl(train_path)
    eval_raw = load_jsonl(eval_path)
    train_domain = domain_rows_to_examples(train_raw, bidirectional_equivalent=True)
    eval_domain = domain_rows_to_examples(eval_raw, bidirectional_equivalent=False)
    snli_rows = load_snli_subset(int(os.environ.get("LIQUID_SNLI_CAP", "2000")), seed=42)
    snli_fraction = float(os.environ.get("LIQUID_SNLI_MIX", "0.15"))
    train_mixed = mix_datasets(train_domain, snli_rows, snli_fraction, 42)
    print(f"Train examples: {len(train_mixed)}  Eval: {len(eval_domain)}")

    domain_lr = float(os.environ.get("LIQUID_DOMAIN_LR", "2e-5"))
    trainer = build_trainer(
        model,
        tokenizer,
        train_mixed,
        eval_domain,
        {
            "out": str(out_dir),
            "epochs": 3,
            "batch_size": batch,
            "grad_accum": grad_accum,
            "lr": domain_lr,
            "weight_decay": 0.1,
            "warmup_ratio": 0.1,
            "adam_beta2": 0.95,
            "max_length": 512,
        },
        device,
    )
    trainer.train()
    metrics = trainer.evaluate()
    print("Stage 2 eval:", metrics)
    save_nli_checkpoint(out_dir, model, tokenizer, meta, extra={"stage": "domain-350m-liquid-l4", "metrics": metrics})
    return out_dir


def run_refine(model_id: str, device: str, domain_dir: Path, train_path: Path, eval_path: Path, out_dir: Path, batch: int, grad_accum: int):
    print("== Stage 3: hard-negative refine ==")
    model, tokenizer, meta = load_nli_checkpoint(domain_dir, device)
    train_raw = [r for r in load_jsonl(train_path) if r["label"] in ("contradiction", "neutral")]
    eval_raw = load_jsonl(eval_path)
    train_rows = domain_rows_to_examples(train_raw, bidirectional_equivalent=True)
    eval_rows = domain_rows_to_examples(eval_raw, bidirectional_equivalent=False)
    print(f"Refine train examples: {len(train_rows)}  Eval: {len(eval_rows)}")

    refine_wd = float(os.environ.get("LIQUID_REFINE_WD", "0.01"))
    refine_lr = float(os.environ.get("LIQUID_REFINE_LR", "5e-6"))
    trainer = build_trainer(
        model,
        tokenizer,
        train_rows,
        eval_rows,
        {
            "out": str(out_dir),
            "epochs": 1,
            "batch_size": batch,
            "grad_accum": grad_accum,
            "lr": refine_lr,
            "weight_decay": refine_wd,
            "warmup_ratio": 0.0,
            "adam_beta2": 0.999,
            "max_length": 512,
        },
        device,
    )
    trainer.train()
    metrics = trainer.evaluate()
    print("Stage 3 eval:", metrics)
    save_nli_checkpoint(out_dir, model, tokenizer, meta, extra={"stage": "refine-350m-calibrated-l4", "metrics": metrics})
    (out_dir / "train_meta.json").write_text(
        json.dumps({"pipeline": "liquid-nli-350m-l4", "metrics": metrics}, indent=2) + "\n",
        encoding="utf-8",
    )
    return out_dir, metrics


def download_hub_checkpoint(repo_id: str, out_dir: Path) -> Path:
    from huggingface_hub import snapshot_download

    out_dir.mkdir(parents=True, exist_ok=True)
    snapshot_download(repo_id=repo_id, local_dir=str(out_dir))
    if not (out_dir / "nli_config.json").exists():
        raise FileNotFoundError(f"Checkpoint missing nli_config.json under {out_dir}")
    print(f"Loaded Hub checkpoint from {repo_id} -> {out_dir}")
    return out_dir


def main() -> None:
    model_id = os.environ.get("LIQUID_NLI_MODEL", "LiquidAI/LFM2.5-Encoder-350M")
    hub_model_id = os.environ.get("HF_HUB_MODEL", "").strip()
    data_repo = os.environ.get("HF_DATA_REPO", "jeanbaptdzd/liquid-nli-domain-1k")
    max_samples = int(os.environ.get("LIQUID_PROBE_SAMPLES", "15000"))
    batch_size = int(os.environ.get("LIQUID_TRAIN_BATCH", "8"))
    grad_accum = int(os.environ.get("LIQUID_GRAD_ACCUM", "4"))
    refine_only_repo = os.environ.get("HF_DOMAIN_CKPT_REPO", "").strip()
    skip_probe = os.environ.get("LIQUID_SKIP_PROBE", "").strip() in ("1", "true", "yes")
    probe_repo = os.environ.get("HF_PROBE_REPO", "").strip()
    recipe = os.environ.get("LIQUID_RECIPE", "l4-default")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    work = Path("/tmp/liquid-nli-350m-l4")
    probe_dir = work / "probe"
    domain_dir = work / "domain"
    refine_dir = work / "refine"
    work.mkdir(parents=True, exist_ok=True)

    print(f"Device: {device}  model: {model_id}  recipe: {recipe}")
    print(f"Data repo: {data_repo}  Hub output: {hub_model_id or '(local only)'}")

    train_path = Path(hf_hub_download(repo_id=data_repo, filename="train.jsonl", repo_type="dataset"))
    eval_path = Path(hf_hub_download(repo_id=data_repo, filename="eval.jsonl", repo_type="dataset"))
    print(f"Downloaded train={train_path} eval={eval_path}")

    if refine_only_repo:
        print(f"== Refine-only from Hub domain checkpoint: {refine_only_repo} ==")
        download_hub_checkpoint(refine_only_repo, domain_dir)
        _, metrics = run_refine(model_id, device, domain_dir, train_path, eval_path, refine_dir, batch_size, grad_accum)
    else:
        if skip_probe and probe_repo:
            download_hub_checkpoint(probe_repo, probe_dir)
        elif skip_probe:
            raise ValueError("LIQUID_SKIP_PROBE=1 requires HF_PROBE_REPO")
        else:
            run_probe(model_id, device, probe_dir, max_samples, batch_size, grad_accum)
        run_domain(model_id, device, probe_dir, train_path, eval_path, domain_dir, batch_size, grad_accum)
        _, metrics = run_refine(model_id, device, domain_dir, train_path, eval_path, refine_dir, batch_size, grad_accum)

    refine_wd = os.environ.get("LIQUID_REFINE_WD", "0.01")
    domain_lr = os.environ.get("LIQUID_DOMAIN_LR", "2e-5")

    if hub_model_id:
        print(f"Pushing checkpoint to Hub: {hub_model_id}")
        api = HfApi()
        api.create_repo(hub_model_id, repo_type="model", exist_ok=True)
        api.upload_folder(folder_path=str(refine_dir), repo_id=hub_model_id, repo_type="model")
        readme = (
            f"# LFM2.5-Encoder-350M NLI (Liquid recipe, L4, 1k domain corpus)\n\n"
            f"Base model: `{model_id}`\n\n"
            f"Recipe: `{recipe}`\n\n"
            f"Pipeline: MNLI probe → domain (lr={domain_lr}, wd=0.1) → refine (wd={refine_wd})\n\n"
            f"Domain dataset: `{data_repo}`\n\n"
            f"Eval macro-F1 (domain eval.jsonl): **{metrics.get('eval_macro_f1', metrics.get('macro_f1', 'n/a'))}**\n"
        )
        api.upload_file(
            path_or_fileobj=readme.encode("utf-8"),
            path_in_repo="README.md",
            repo_id=hub_model_id,
            repo_type="model",
        )
        print(f"VERDICT: pushed {hub_model_id}")
    else:
        print("VERDICT: complete (set HF_HUB_MODEL to push)")


if __name__ == "__main__":
    main()
