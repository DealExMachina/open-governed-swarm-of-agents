#!/usr/bin/env python3
"""Evaluate production CrossEncoder DeBERTa on domain eval.jsonl (Issue 05 B4 baseline)."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from nli_train_utils import LABEL_NAMES, domain_rows_to_examples, load_jsonl, macro_f1


def main() -> None:
    parser = argparse.ArgumentParser(description="DeBERTa macro-F1 on domain eval split")
    parser.add_argument(
        "--model-id",
        default="cross-encoder/nli-deberta-v3-large",
        help="CrossEncoder model id (production reference)",
    )
    parser.add_argument("--eval-jsonl", default=str(Path(__file__).parent / "dataset" / "eval.jsonl"))
    parser.add_argument("--out", default=str(Path(__file__).parent / "baseline-deberta-v3-large-eval-metrics.json"))
    args = parser.parse_args()

    from sentence_transformers import CrossEncoder

    eval_raw = load_jsonl(Path(args.eval_jsonl))
    examples = domain_rows_to_examples(eval_raw, bidirectional_equivalent=False)

    print(f"Loading {args.model_id} …")
    model = CrossEncoder(args.model_id)

    pairs = [(ex["premise"], ex["hypothesis"]) for ex in examples]
    logits = model.predict(pairs, convert_to_numpy=True, show_progress_bar=True)

    y_true = [int(ex["labels"]) for ex in examples]
    y_pred = [int(row.argmax()) for row in logits]

    metrics = macro_f1(y_true, y_pred)
    metrics["accuracy"] = sum(t == p for t, p in zip(y_true, y_pred)) / len(y_true)
    metrics["model_id"] = args.model_id
    metrics["eval_rows"] = len(examples)
    metrics["eval_jsonl"] = str(Path(args.eval_jsonl).resolve())
    metrics["label_order"] = list(LABEL_NAMES)
    metrics["direction"] = "single (premise→hypothesis)"

    print(json.dumps(metrics, indent=2))
    per_class = {LABEL_NAMES[i]: metrics[f"f1_{LABEL_NAMES[i]}"] for i in range(3)}
    print("Per-class F1:", per_class)

    out_path = Path(args.out)
    out_path.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
