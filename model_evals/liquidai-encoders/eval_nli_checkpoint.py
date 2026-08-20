#!/usr/bin/env python3
"""Evaluate a fine-tuned Liquid NLI checkpoint on domain eval.jsonl (macro-F1)."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from nli_train_utils import LABEL_NAMES, domain_rows_to_examples, load_jsonl, macro_f1, resolve_device


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("checkpoint", help="Checkpoint directory")
    parser.add_argument("--eval-jsonl", default=str(Path(__file__).parent / "dataset" / "eval.jsonl"))
    parser.add_argument("--device", default="auto")
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--out", default="")
    args = parser.parse_args()

    import torch
    from lfm2_nli_classifier import load_nli_model_for_training

    device = resolve_device(args.device)
    ckpt = Path(args.checkpoint)
    eval_raw = load_jsonl(Path(args.eval_jsonl))
    examples = domain_rows_to_examples(eval_raw, bidirectional_equivalent=False)

    model, tokenizer, _meta = load_nli_model_for_training(ckpt, "LiquidAI/LFM2.5-Encoder-230M", device)
    model.eval()

    y_true: list[int] = []
    y_pred: list[int] = []
    with torch.no_grad():
        for ex in examples:
            enc = tokenizer(
                ex["premise"],
                ex["hypothesis"],
                truncation=True,
                max_length=args.max_length,
                return_tensors="pt",
            )
            enc = {k: v.to(device) for k, v in enc.items()}
            logits = model(**enc).logits[0]
            pred = int(logits.argmax().item())
            y_true.append(int(ex["labels"]))
            y_pred.append(pred)

    metrics = macro_f1(y_true, y_pred)
    metrics["accuracy"] = sum(t == p for t, p in zip(y_true, y_pred)) / len(y_true)
    metrics["checkpoint"] = str(ckpt)
    metrics["eval_rows"] = len(examples)
    metrics["device"] = device

    print(json.dumps(metrics, indent=2))
    per_class = {LABEL_NAMES[i]: metrics[f"f1_{LABEL_NAMES[i]}"] for i in range(3)}
    print("Per-class F1:", per_class)

    if args.out:
        Path(args.out).write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
