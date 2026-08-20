"""Shared helpers for Liquid NLI head training (MPS / CUDA / CPU)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import numpy as np

# Runtime / CrossEncoder order: 0=contradiction, 1=entailment, 2=neutral
LABEL_NAMES = ("contradiction", "entailment", "neutral")
DOMAIN_LABEL_TO_ID = {
    "contradiction": 0,
    "equivalent": 1,
    "neutral": 2,
}
# SNLI: entailment=0, neutral=1, contradiction=2
_SNLI_TO_NLI = {0: 1, 1: 2, 2: 0}


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def default_probe_ckpt() -> Path:
    return repo_root() / "workers" / "facts-worker" / "checkpoints" / "nli-mnli-probe"


def default_domain_ckpt() -> Path:
    return repo_root() / "workers" / "facts-worker" / "checkpoints" / "nli-domain-v1"


def default_refine_ckpt() -> Path:
    return repo_root() / "workers" / "facts-worker" / "checkpoints" / "nli-domain-v1-calibrated"


def resolve_device(explicit: str | None = None) -> str:
    if explicit and explicit != "auto":
        return explicit
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def domain_rows_to_examples(rows: list[dict[str, Any]], bidirectional_equivalent: bool = True) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows:
        label_name = row["label"]
        if label_name not in DOMAIN_LABEL_TO_ID:
            raise ValueError(f"Unknown label {label_name!r} in {row.get('id')}")
        label_id = DOMAIN_LABEL_TO_ID[label_name]
        out.append(
            {
                "premise": row["a"],
                "hypothesis": row["b"],
                "labels": label_id,
                "id": row.get("id", ""),
            }
        )
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

    ds = load_dataset("snli", split="train")
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


def mix_datasets(domain: list[dict[str, Any]], snli: list[dict[str, Any]], snli_fraction: float, seed: int) -> list[dict[str, Any]]:
    import random

    rng = random.Random(seed)
    n_snli = int(round(len(domain) * snli_fraction / max(1e-9, (1.0 - snli_fraction))))
    n_snli = min(n_snli, len(snli))
    picked = rng.sample(snli, n_snli) if n_snli else []
    merged = domain + picked
    rng.shuffle(merged)
    return merged


def class_weights_tensor(device: str):
    import torch

    # [contradiction, entailment, neutral]
    w = torch.tensor([2.0, 1.0, 1.5], dtype=torch.float32, device=device)
    return w


def macro_f1(y_true: list[int], y_pred: list[int]) -> dict[str, float]:
    from collections import defaultdict

    labels = list(range(3))
    per: dict[str, float] = {}
    f1s: list[float] = []
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


def save_training_meta(out_dir: Path, meta: dict[str, Any]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "train_meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
