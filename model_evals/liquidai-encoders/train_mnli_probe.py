#!/usr/bin/env python3
"""Phase 1 B4 probe: fine-tune LFM2.5-Encoder-230M 3-class NLI head on SNLI subset."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from lfm2_nli_classifier import build_nli_model, save_nli_checkpoint, NliCheckpointMeta
from nli_train_utils import LABEL_NAMES, _SNLI_TO_NLI, resolve_device, save_training_meta


def main() -> None:
    parser = argparse.ArgumentParser(description="MNLI/SNLI probe fine-tune for Liquid encoder NLI")
    parser.add_argument("--model-id", default="LiquidAI/LFM2.5-Encoder-230M")
    parser.add_argument("--dataset", choices=("snli", "mnli"), default="snli")
    parser.add_argument("--max-samples", type=int, default=8000)
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--grad-accum", type=int, default=4)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument("--warmup-ratio", type=float, default=0.0)
    parser.add_argument("--adam-beta2", type=float, default=0.999)
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
    from transformers import Trainer, TrainingArguments

    device = resolve_device(args.device)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading base model {args.model_id} on {device} …")
    model, tokenizer, meta = build_nli_model(args.model_id, device)

    print(f"Loading {args.dataset} …")
    if args.dataset == "mnli":
        # `glue` hub id breaks on recent huggingface_hub; nyu-mll/glue is equivalent.
        ds = load_dataset("nyu-mll/glue", "mnli", split="train")
        eval_ds = load_dataset("nyu-mll/glue", "mnli", split="validation_matched")
        label_key = "label"
    else:
        ds = load_dataset("stanfordnlp/snli", split="train")
        eval_ds = load_dataset("stanfordnlp/snli", split="validation")
        label_key = "label"

    ds = ds.filter(lambda x: x[label_key] != -1)
    eval_ds = eval_ds.filter(lambda x: x[label_key] != -1)
    if len(ds) > args.max_samples:
        ds = ds.shuffle(seed=42).select(range(args.max_samples))

    eval_cap = max(500, args.max_samples // 5)
    if len(eval_ds) > eval_cap:
        eval_ds = eval_ds.shuffle(seed=42).select(range(eval_cap))

    def map_labels(example):
        example["labels"] = _SNLI_TO_NLI[int(example[label_key])]
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
        return {"accuracy": float((preds == labels).mean())}

    total_steps = max(1, (len(tokenized) // (args.batch_size * args.grad_accum)) * args.epochs)
    warmup_steps = max(0, int(total_steps * args.warmup_ratio))

    training_args = TrainingArguments(
        output_dir=str(out_dir / "runs"),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        weight_decay=args.weight_decay,
        warmup_steps=warmup_steps,
        adam_beta2=args.adam_beta2,
        eval_strategy="epoch",
        save_strategy="no",
        logging_steps=50,
        report_to=[],
        use_cpu=device == "cpu",
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

    save_nli_checkpoint(out_dir, model, tokenizer, meta, extra={"stage": "mnli-probe", "metrics": metrics})
    save_training_meta(
        out_dir,
        {
            "stage": "mnli-probe",
            "dataset": args.dataset,
            "base_model": args.model_id,
            "device": device,
            "train_samples": len(tokenized),
            "eval_samples": len(tokenized_eval),
            "weight_decay": args.weight_decay,
            "warmup_ratio": args.warmup_ratio,
            "adam_beta2": args.adam_beta2,
            "label_order": list(LABEL_NAMES),
            "metrics": metrics,
        },
    )
    (out_dir / "probe_meta.json").write_text(
        json.dumps({"base_model": args.model_id, "metrics": metrics}, indent=2) + "\n"
    )
    print(f"Saved checkpoint to {out_dir}")


if __name__ == "__main__":
    main()
