#!/usr/bin/env python3
"""Phase 1 B4 probe: fine-tune LFM2.5-Encoder-230M 3-class NLI head on SNLI subset.

Label order (matches CrossEncoder / rlm_facts): 0=contradiction, 1=entailment, 2=neutral.

Usage (from repo root):
  python model_evals/liquidai-encoders/train_mnli_probe.py
  python model_evals/liquidai-encoders/train_mnli_probe.py --max-samples 2000 --epochs 1 --device mps
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from nli_train_utils import LABEL_NAMES, _SNLI_TO_NLI, resolve_device, save_training_meta


def main() -> None:
    parser = argparse.ArgumentParser(description="MNLI/SNLI probe fine-tune for Liquid encoder NLI")
    parser.add_argument("--model-id", default="LiquidAI/LFM2.5-Encoder-230M")
    parser.add_argument("--max-samples", type=int, default=8000, help="Train cap")
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--grad-accum", type=int, default=4)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--device", default="auto")
    parser.add_argument(
        "--out",
        default=str(
            Path(__file__).resolve().parents[2]
            / "workers"
            / "facts-worker"
            / "checkpoints"
            / "nli-mnli-probe"
        ),
    )
    args = parser.parse_args()

    import numpy as np
    from datasets import load_dataset
    from transformers import AutoModelForSequenceClassification, AutoTokenizer, Trainer, TrainingArguments

    device = resolve_device(args.device)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading base model {args.model_id} on {device} …")
    tokenizer = AutoTokenizer.from_pretrained(args.model_id, trust_remote_code=True)
    model = AutoModelForSequenceClassification.from_pretrained(
        args.model_id,
        num_labels=3,
        trust_remote_code=True,
    )
    model.to(device)

    print("Loading snli …")
    ds = load_dataset("snli", split="train")
    ds = ds.filter(lambda x: x["label"] != -1)
    if len(ds) > args.max_samples:
        ds = ds.shuffle(seed=42).select(range(args.max_samples))

    eval_ds = load_dataset("snli", split="validation")
    eval_ds = eval_ds.filter(lambda x: x["label"] != -1)
    eval_cap = max(500, args.max_samples // 5)
    if len(eval_ds) > eval_cap:
        eval_ds = eval_ds.shuffle(seed=42).select(range(eval_cap))

    def map_labels(example):
        example["labels"] = _SNLI_TO_NLI[int(example["label"])]
        return example

    ds = ds.map(map_labels)
    eval_ds = eval_ds.map(map_labels)

    def tokenize(batch):
        enc = tokenizer(
            batch["premise"],
            batch["hypothesis"],
            truncation=True,
            max_length=512,
        )
        enc["labels"] = batch["labels"]
        return enc

    tokenized = ds.map(tokenize, batched=True, remove_columns=ds.column_names)
    tokenized_eval = eval_ds.map(tokenize, batched=True, remove_columns=eval_ds.column_names)

    def compute_metrics(eval_pred):
        logits, labels = eval_pred
        preds = np.argmax(logits, axis=-1)
        acc = (preds == labels).mean()
        return {"accuracy": float(acc)}

    use_cpu = device == "cpu"
    training_args = TrainingArguments(
        output_dir=str(out_dir / "runs"),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        eval_strategy="epoch",
        save_strategy="no",
        logging_steps=50,
        report_to=[],
        use_cpu=use_cpu,
        fp16=device == "cuda",
        dataloader_num_workers=0,
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized,
        eval_dataset=tokenized_eval,
        processing_class=tokenizer,
        compute_metrics=compute_metrics,
    )

    print(f"Training on {len(tokenized)} samples (effective batch {args.batch_size * args.grad_accum}) …")
    trainer.train()
    metrics = trainer.evaluate()
    print("Eval:", metrics)

    print(f"Saving checkpoint to {out_dir} …")
    model.save_pretrained(out_dir)
    tokenizer.save_pretrained(out_dir)

    meta = {
        "stage": "mnli-probe",
        "base_model": args.model_id,
        "device": device,
        "train_samples": len(tokenized),
        "eval_samples": len(tokenized_eval),
        "label_order": list(LABEL_NAMES),
        "snli_map": _SNLI_TO_NLI,
        "metrics": metrics,
    }
    save_training_meta(out_dir, meta)
    (out_dir / "probe_meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print("Done.", meta)


if __name__ == "__main__":
    main()
