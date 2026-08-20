#!/usr/bin/env python3
"""Stage 2–3: domain NLI fine-tune on LFM2.5-Encoder-230M (MPS-friendly)."""

from __future__ import annotations

import argparse
from pathlib import Path

from nli_train_utils import (
    LABEL_NAMES,
    class_weights_tensor,
    default_domain_ckpt,
    default_probe_ckpt,
    default_refine_ckpt,
    domain_rows_to_examples,
    load_jsonl,
    load_snli_subset,
    macro_f1,
    mix_datasets,
    resolve_device,
    save_training_meta,
)


def rows_to_dataset(rows, tokenizer, max_length):
    from datasets import Dataset

    def tokenize(batch):
        enc = tokenizer(
            batch["premise"],
            batch["hypothesis"],
            truncation=True,
            max_length=max_length,
        )
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


def build_trainer(model, tokenizer, train_rows, eval_rows, args, device: str):
    import numpy as np
    import torch
    from torch.nn import CrossEntropyLoss
    from transformers import Trainer, TrainingArguments

    train_dataset = rows_to_dataset(train_rows, tokenizer, args.max_length)
    eval_dataset = rows_to_dataset(eval_rows, tokenizer, args.max_length)

    weights = class_weights_tensor("cpu")
    if device == "mps":
        weights = weights.to("mps")
    elif device == "cuda":
        weights = weights.to("cuda")

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

    total_steps = max(1, (len(train_rows) // (args.batch_size * args.grad_accum)) * args.epochs)
    if args.warmup_ratio > 0:
        warmup_steps = max(1, int(total_steps * args.warmup_ratio))
    else:
        warmup_steps = 0

    training_args = TrainingArguments(
        output_dir=str(Path(args.out) / "runs"),
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
        logging_steps=10,
        report_to=[],
        use_cpu=device == "cpu",
        fp16=device == "cuda",
        dataloader_num_workers=0,
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


def load_model_and_tokenizer(model_id: str, init_checkpoint: Path | None, device: str):
    from lfm2_nli_classifier import load_nli_model_for_training
    from nli_train_utils import repo_root

    if init_checkpoint is not None and not init_checkpoint.is_absolute():
        candidate = (Path.cwd() / init_checkpoint).resolve()
        if not (candidate / "nli_config.json").exists():
            candidate = (repo_root() / init_checkpoint).resolve()
        init_checkpoint = candidate

    model, tokenizer, _meta = load_nli_model_for_training(init_checkpoint, model_id, device)
    if init_checkpoint and (init_checkpoint / "nli_config.json").exists():
        print(f"Loaded checkpoint {init_checkpoint}")
    else:
        print(f"Initialized from base model {model_id}")
    return model, tokenizer


def main() -> None:
    parser = argparse.ArgumentParser(description="Liquid encoder domain NLI fine-tune")
    parser.add_argument("--stage", choices=("domain", "refine"), default="domain")
    parser.add_argument("--model-id", default="LiquidAI/LFM2.5-Encoder-230M")
    parser.add_argument("--init-checkpoint", default="")
    parser.add_argument("--train-jsonl", default=str(Path(__file__).parent / "dataset" / "train.jsonl"))
    parser.add_argument("--eval-jsonl", default=str(Path(__file__).parent / "dataset" / "eval.jsonl"))
    parser.add_argument("--out", default="")
    parser.add_argument("--epochs", type=int, default=0)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--grad-accum", type=int, default=4)
    parser.add_argument("--lr", type=float, default=0.0)
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--snli-mix", type=float, default=0.2)
    parser.add_argument("--snli-cap", type=int, default=500)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--weight-decay",
        type=float,
        default=0.01,
        help="Default 0.01. Liquid recipe wd=0.1 applies to Stage 2 domain (full tri-class); avoid on refine.",
    )
    parser.add_argument(
        "--warmup-ratio",
        type=float,
        default=-1.0,
        help="Linear warmup fraction of total steps; default 0.05 for domain, 0 for refine",
    )
    parser.add_argument(
        "--adam-beta2",
        type=float,
        default=0.999,
        help="AdamW beta2; Liquid encoder_eval uses 0.95",
    )
    args = parser.parse_args()

    if args.warmup_ratio < 0:
        args.warmup_ratio = 0.05 if args.stage == "domain" else 0.0

    if not args.out:
        args.out = str(default_refine_ckpt() if args.stage == "refine" else default_domain_ckpt())
    if args.epochs == 0:
        args.epochs = 1 if args.stage == "refine" else 3
    if args.lr == 0.0:
        args.lr = 5e-6 if args.stage == "refine" else 1e-5

    init_ckpt = Path(args.init_checkpoint) if args.init_checkpoint else None
    if init_ckpt is None:
        init_ckpt = default_domain_ckpt() if args.stage == "refine" else default_probe_ckpt()
        if args.stage == "domain" and not (init_ckpt / "nli_config.json").exists():
            init_ckpt = None

    device = resolve_device(args.device)
    print(f"Device: {device}  stage={args.stage}  out={args.out}")

    train_raw = load_jsonl(Path(args.train_jsonl))
    eval_raw = load_jsonl(Path(args.eval_jsonl))
    if args.stage == "refine":
        train_raw = [r for r in train_raw if r["label"] in ("contradiction", "neutral")]

    train_domain = domain_rows_to_examples(train_raw, bidirectional_equivalent=True)
    eval_domain = domain_rows_to_examples(eval_raw, bidirectional_equivalent=False)

    if args.stage == "domain" and args.snli_mix > 0:
        print(f"Loading SNLI subset (cap={args.snli_cap}) …")
        snli_rows = load_snli_subset(args.snli_cap, seed=args.seed)
        train_mixed = mix_datasets(train_domain, snli_rows, args.snli_mix, args.seed)
    else:
        train_mixed = train_domain

    print(f"Train examples: {len(train_mixed)}  Eval examples: {len(eval_domain)}")

    model, tokenizer = load_model_and_tokenizer(args.model_id, init_ckpt, device)
    trainer = build_trainer(model, tokenizer, train_mixed, eval_domain, args, device)

    print("Training …")
    trainer.train()
    metrics = trainer.evaluate()
    print("Eval:", metrics)

    out_dir = Path(args.out)
    from lfm2_nli_classifier import NliCheckpointMeta, save_nli_checkpoint

    hidden = int(model.classifier.in_features)
    save_nli_checkpoint(
        out_dir,
        model,
        tokenizer,
        NliCheckpointMeta(base_model=args.model_id, hidden_size=hidden),
        extra={"stage": args.stage, "metrics": metrics},
    )

    save_training_meta(
        out_dir,
        {
            "stage": args.stage,
            "base_model": args.model_id,
            "init_checkpoint": str(init_ckpt) if init_ckpt else None,
            "device": device,
            "train_examples": len(train_mixed),
            "eval_examples": len(eval_domain),
            "epochs": args.epochs,
            "batch_size": args.batch_size,
            "grad_accum": args.grad_accum,
            "effective_batch": args.batch_size * args.grad_accum,
            "lr": args.lr,
            "weight_decay": args.weight_decay,
            "warmup_ratio": args.warmup_ratio,
            "adam_beta2": args.adam_beta2,
            "label_order": list(LABEL_NAMES),
            "metrics": metrics,
        },
    )
    print(f"Saved checkpoint to {out_dir}")


if __name__ == "__main__":
    main()
