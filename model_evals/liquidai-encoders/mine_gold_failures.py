#!/usr/bin/env python3
"""Mine incorrect gold-harness pairs into train-only seed rows.

Reads a gold eval JSON (from scripts/eval-nli-gold-set.ts) and the frozen
fixture YAML for prior/next text. Writes dataset/seeds/gold-failures-mined.yaml.

These rows are train-only hard negatives: same text as the regression harness,
correct NLI labels for Stage 2/3 refinement. Gold harness scores become
optimistic after retraining on them — document in split_manifest.

Usage (repo root):
  python model_evals/liquidai-encoders/mine_gold_failures.py \\
    --gold-json model_evals/liquidai-encoders/phase1b-domain-v1-gold.json
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:
    yaml = None  # type: ignore

CATEGORY_TO_LABEL = {
    "paraphrase": "equivalent",
    "false_positive_trap": "neutral",
    "contradiction": "contradiction",
    "refutation": "contradiction",
    "ambiguous_hitl": "neutral",
}

FALSE_MERGE_EXPECTED = frozenset({"no_merge", "block_contradiction", "hitl"})
BLOCK_EXPECTED = frozenset({"block_contradiction"})


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def dataset_dir() -> Path:
    return Path(__file__).resolve().parent / "dataset"


def load_yaml(path: Path) -> dict[str, Any]:
    if yaml is None:
        raise SystemExit("PyYAML required: pip install pyyaml")
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def failure_kind(result: dict[str, Any]) -> str:
    expected = result["expected"]
    resolved = result["resolved"]
    if expected == "auto_merge" and resolved == "auto_merge":
        return "missed_merge"
    if expected in FALSE_MERGE_EXPECTED and resolved == "auto_merge":
        return "false_merge"
    if expected in BLOCK_EXPECTED and resolved != "block_contradiction":
        return "missed_block"
    return "routing_miss"


def main() -> None:
    parser = argparse.ArgumentParser(description="Mine gold harness failures into train seeds")
    parser.add_argument(
        "--gold-json",
        default=str(Path(__file__).resolve().parent / "phase1b-domain-v1-gold.json"),
        help="Gold eval JSON with per-pair results",
    )
    parser.add_argument(
        "--gold-yaml",
        default=str(repo_root() / "test" / "fixtures" / "nli-gold-set.yaml"),
        help="Frozen gold fixture for prior/next text",
    )
    parser.add_argument(
        "--out",
        default=str(dataset_dir() / "seeds" / "gold-failures-mined.yaml"),
        help="Output seed YAML",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print summary without writing")
    args = parser.parse_args()

    gold_json = json.loads(Path(args.gold_json).read_text(encoding="utf-8"))
    fixture = load_yaml(Path(args.gold_yaml))
    by_id = {p["id"]: p for p in fixture.get("pairs", [])}

    failures = [r for r in gold_json.get("results", []) if not r.get("correct")]
    mined: list[dict[str, Any]] = []
    missing: list[str] = []

    for result in failures:
        pair_id = result["id"]
        fixture_pair = by_id.get(pair_id)
        if not fixture_pair:
            missing.append(pair_id)
            continue
        category = result.get("category") or fixture_pair.get("category", "")
        label = CATEGORY_TO_LABEL.get(category)
        if not label:
            raise SystemExit(f"No label mapping for category {category!r} ({pair_id})")

        nli = result.get("nli") or {}
        mined.append(
            {
                "id": f"gf-{pair_id}",
                "a": str(fixture_pair.get("prior", "")).strip(),
                "b": str(fixture_pair.get("next", "")).strip(),
                "dimension": fixture_pair.get("dimension", result.get("dimension", "")),
                "label": label,
                "source_scenario": fixture_pair.get("scenario", result.get("scenario", "")),
                "source_doc": "test/fixtures/nli-gold-set.yaml",
                "lang": "en",
                "train_only": True,
                "source": "gold_failure_mined",
                "gold_pair_id": pair_id,
                "gold_category": category,
                "failure_kind": failure_kind(result),
                "eval_expected": result.get("expected"),
                "eval_resolved": result.get("resolved"),
                "eval_nli_label": nli.get("label"),
                "eval_nli_confidence": nli.get("confidence"),
            }
        )

    payload = {
        "schemaVersion": "1",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source_gold_json": args.gold_json,
        "note": (
            "Train-only hard negatives from gold harness failures. "
            "Included in train.jsonl only; bypasses regression text exclusion."
        ),
        "pairs": mined,
    }

    summary = {
        "failures_in_json": len(failures),
        "mined_rows": len(mined),
        "missing_fixture_ids": missing,
        "by_failure_kind": {},
        "by_label": {},
    }
    for row in mined:
        summary["by_failure_kind"][row["failure_kind"]] = summary["by_failure_kind"].get(row["failure_kind"], 0) + 1
        summary["by_label"][row["label"]] = summary["by_label"].get(row["label"], 0) + 1

    print(json.dumps(summary, indent=2))
    if missing:
        print(f"\nWARNING: {len(missing)} failure IDs missing from gold fixture")

    if args.dry_run:
        return

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        yaml.safe_dump(payload, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    print(f"\nWrote {out_path} ({len(mined)} rows)")


if __name__ == "__main__":
    main()
