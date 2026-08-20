#!/usr/bin/env python3
"""Build Issue 01 domain NLI dataset from hand-labeled seeds.

Reads:
  dataset/seeds/domain-pairs.yaml
  dataset/seeds/gold-failures-mined.yaml  (optional, train-only hard negatives)

Writes:
  dataset/pairs.jsonl       — full labeled corpus
  dataset/train.jsonl       — 70% stratified by label
  dataset/eval.jsonl        — 30% stratified by label
  dataset/split_manifest.json
  dataset/spot-check-sample.jsonl — 20% review sample

Excludes exact (a, b) text matches present in frozen regression fixtures:
  test/fixtures/nli-gold-set.yaml
  test/fixtures/nli-held-out.yaml

Usage (repo root):
  python model_evals/liquidai-encoders/build_domain_dataset.py
  python model_evals/liquidai-encoders/build_domain_dataset.py --check-only
"""

from __future__ import annotations

import argparse
import json
import random
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:
    yaml = None  # type: ignore

LABELS = frozenset({"equivalent", "contradiction", "neutral"})
SPLIT_SEED = 42
SPOT_CHECK_FRACTION = 0.20


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def dataset_dir() -> Path:
    return Path(__file__).resolve().parent / "dataset"


def normalize_pair(a: str, b: str) -> tuple[str, str]:
    def norm(s: str) -> str:
        return re.sub(r"\s+", " ", s.strip().lower())

    return norm(a), norm(b)


def load_yaml(path: Path) -> dict[str, Any]:
    if yaml is None:
        raise SystemExit("PyYAML required: pip install pyyaml")
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def load_regression_pairs(root: Path) -> set[tuple[str, str]]:
    excluded: set[tuple[str, str]] = set()
    for rel in (
        "test/fixtures/nli-gold-set.yaml",
        "test/fixtures/nli-held-out.yaml",
    ):
        data = load_yaml(root / rel)
        for pair in data.get("pairs", []):
            a = pair.get("prior") or pair.get("a", "")
            b = pair.get("next") or pair.get("b", "")
            if a and b:
                excluded.add(normalize_pair(str(a), str(b)))
    return excluded


def load_seeds(seeds_path: Path) -> list[dict[str, Any]]:
    data = load_yaml(seeds_path)
    rows: list[dict[str, Any]] = []
    for raw in data.get("pairs", []):
        label = str(raw["label"]).strip()
        if label not in LABELS:
            raise ValueError(f"Invalid label {label!r} on {raw.get('id')}")
        row = {
            "id": raw["id"],
            "a": raw["a"].strip(),
            "b": raw["b"].strip(),
            "dimension": raw.get("dimension", ""),
            "label": label,
            "source_scenario": raw.get("source_scenario", ""),
            "source_doc": raw.get("source_doc", ""),
            "lang": raw.get("lang", "en"),
        }
        if raw.get("train_only") or raw.get("source") == "gold_failure_mined":
            row["train_only"] = True
            row["source"] = raw.get("source", "gold_failure_mined")
            if raw.get("gold_pair_id"):
                row["gold_pair_id"] = raw["gold_pair_id"]
            if raw.get("failure_kind"):
                row["failure_kind"] = raw["failure_kind"]
        rows.append(row)
    return rows


def default_seed_paths(seeds_path: Path) -> list[Path]:
    paths = [seeds_path]
    for extra in (
        dataset_dir() / "seeds" / "synthetic-domain-pairs.yaml",
        dataset_dir() / "seeds" / "gold-failures-mined.yaml",
    ):
        if extra.exists() and extra not in paths and extra != seeds_path:
            paths.append(extra)
    return paths


def stratified_split(
    rows: list[dict[str, Any]], train_ratio: float, seed: int
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    by_label: dict[str, list[dict[str, Any]]] = {l: [] for l in sorted(LABELS)}
    for row in rows:
        by_label[row["label"]].append(row)

    train: list[dict[str, Any]] = []
    eval_rows: list[dict[str, Any]] = []
    rng = random.Random(seed)

    for label in sorted(LABELS):
        bucket = by_label[label][:]
        rng.shuffle(bucket)
        if len(bucket) < 2:
            raise ValueError(f"Need at least 2 rows per label for split; {label} has {len(bucket)}")
        n_train = max(1, int(round(len(bucket) * train_ratio)))
        n_train = min(n_train, len(bucket) - 1)  # keep ≥1 in eval
        train.extend(bucket[:n_train])
        eval_rows.extend(bucket[n_train:])

    rng.shuffle(train)
    rng.shuffle(eval_rows)
    return train, eval_rows


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def spot_check_sample(rows: list[dict[str, Any]], fraction: float, seed: int) -> list[dict[str, Any]]:
    rng = random.Random(seed + 1)
    shuffled = rows[:]
    rng.shuffle(shuffled)
    n = max(1, int(round(len(shuffled) * fraction)))
    sample = shuffled[:n]
    for row in sample:
        row = dict(row)
    return sorted(sample, key=lambda r: r["id"])


def validate_counts(
    rows: list[dict[str, Any]],
    *,
    min_total: int = 150,
    min_per_label: int = 30,
    min_multilingual: int = 20,
) -> dict[str, Any]:
    label_counts = Counter(r["label"] for r in rows)
    lang_counts = Counter(r.get("lang", "en") for r in rows)
    ml_count = sum(1 for r in rows if r.get("lang", "en") != "en")
    fr_count = lang_counts.get("fr", 0)
    issues: list[str] = []
    if len(rows) < min_total:
        issues.append(f"total pairs {len(rows)} < {min_total} minimum")
    for label in sorted(LABELS):
        if label_counts[label] < min_per_label:
            issues.append(f"{label} count {label_counts[label]} < {min_per_label} minimum")
    if ml_count < min_multilingual:
        issues.append(f"multilingual pairs {ml_count} < {min_multilingual} minimum")
    return {
        "total": len(rows),
        "by_label": dict(label_counts),
        "by_lang": dict(lang_counts),
        "multilingual": ml_count,
        "french": fr_count,
        "issues": issues,
        "ok": len(issues) == 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Issue 01 domain NLI dataset")
    parser.add_argument(
        "--seeds",
        default=str(dataset_dir() / "seeds" / "domain-pairs.yaml"),
        help="Seed YAML path",
    )
    parser.add_argument("--train-ratio", type=float, default=0.7)
    parser.add_argument("--seed", type=int, default=SPLIT_SEED)
    parser.add_argument("--check-only", action="store_true", help="Validate without writing")
    parser.add_argument("--min-total", type=int, default=150, help="Minimum corpus size (use 1000 for expanded track)")
    parser.add_argument("--min-per-label", type=int, default=30)
    parser.add_argument("--min-multilingual", type=int, default=20)
    args = parser.parse_args()

    root = repo_root()
    seeds_path = Path(args.seeds)
    out_dir = dataset_dir()

    excluded = load_regression_pairs(root)
    seed_paths = default_seed_paths(seeds_path)
    seeds: list[dict[str, Any]] = []
    for path in seed_paths:
        seeds.extend(load_seeds(path))

    kept: list[dict[str, Any]] = []
    train_only: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    for row in seeds:
        key = normalize_pair(row["a"], row["b"])
        if key in excluded and not row.get("train_only"):
            skipped.append({"id": row["id"], "reason": "matches frozen regression fixture"})
            continue
        if row.get("train_only"):
            train_only.append(row)
        else:
            kept.append(row)

    corpus = kept + train_only
    stats = validate_counts(
        corpus,
        min_total=args.min_total,
        min_per_label=args.min_per_label,
        min_multilingual=args.min_multilingual,
    )
    train, eval_rows = stratified_split(kept, args.train_ratio, args.seed)
    train.extend(train_only)
    sample = spot_check_sample(corpus, SPOT_CHECK_FRACTION, args.seed)

    manifest = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "issue": "liquidai-01-dataset",
        "schema": {
            "fields": ["id", "a", "b", "dimension", "label", "source_scenario", "source_doc", "lang"],
            "label_values": sorted(LABELS),
        },
        "seeds_files": [
            str(p.relative_to(root)) if p.is_relative_to(root) else str(p) for p in seed_paths
        ],
        "split_seed": args.seed,
        "train_ratio": args.train_ratio,
        "excluded_regression_pairs": len(excluded),
        "skipped_seed_rows": skipped,
        "train_only_rows": len(train_only),
        "train_only_by_failure_kind": dict(Counter(r.get("failure_kind", "unknown") for r in train_only)),
        "counts": stats,
        "split": {
            "train": len(train),
            "eval": len(eval_rows),
            "train_by_label": dict(Counter(r["label"] for r in train)),
            "eval_by_label": dict(Counter(r["label"] for r in eval_rows)),
        },
        "spot_check_fraction": SPOT_CHECK_FRACTION,
        "spot_check_count": len(sample),
    }

    print(json.dumps(manifest, indent=2))
    if not stats["ok"]:
        print("\nWARNING: acceptance criteria not met:")
        for issue in stats["issues"]:
            print(f"  - {issue}")

    if args.check_only:
        return

    write_jsonl(out_dir / "pairs.jsonl", corpus)
    write_jsonl(out_dir / "train.jsonl", train)
    write_jsonl(out_dir / "eval.jsonl", eval_rows)
    write_jsonl(out_dir / "spot-check-sample.jsonl", sample)
    (out_dir / "split_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"\nWrote {out_dir}/pairs.jsonl ({len(corpus)} rows, {len(train_only)} train-only)")
    print(f"Wrote {out_dir}/train.jsonl ({len(train)} rows)")
    print(f"Wrote {out_dir}/eval.jsonl ({len(eval_rows)} rows)")


if __name__ == "__main__":
    main()
