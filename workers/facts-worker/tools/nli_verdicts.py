#!/usr/bin/env python3
"""Generate NLI verdicts for the frozen gold set (offline model evaluation).

Backends:
  deberta   — production cross-encoder (cross-encoder/nli-deberta-v3-base)
  lfm-cosine — zero-shot mean-pooled cosine similarity (no contradiction class)
  lfm-head  — fine-tuned 3-class sequence classifier checkpoint

Usage:
  python workers/facts-worker/tools/nli_verdicts.py --backend=deberta
  python workers/facts-worker/tools/nli_verdicts.py --backend=lfm-cosine --model=LiquidAI/LFM2.5-Encoder-230M
  python workers/facts-worker/tools/nli_verdicts.py --backend=lfm-head --checkpoint=model_evals/nli/lfm-head-230m
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml

# Repo root: workers/facts-worker/tools -> ../../../
REPO_ROOT = Path(__file__).resolve().parents[3]
WORKER_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_GOLD = REPO_ROOT / "test" / "fixtures" / "nli-gold-set.yaml"
DEFAULT_OUT_DIR = REPO_ROOT / "model_evals" / "nli"

# Allow importing rlm_facts when run from repo root or worker dir
if str(WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKER_ROOT))


def load_gold(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if not data or not data.get("pairs"):
        raise ValueError(f"Invalid or empty gold set: {path}")
    return data


def _softmax3(vals: List[float]) -> List[float]:
    import math

    m = max(vals)
    exps = [math.exp(v - m) for v in vals]
    tot = sum(exps) or 1.0
    return [e / tot for e in exps]


def _label_from_probs(
    fwd: List[float], bwd: List[float]
) -> Tuple[str, float]:
    """Mirror rlm_facts.nli_entailment label selection."""
    contradiction = max(fwd[0], bwd[0])
    entail = min(fwd[1], bwd[1])
    neutral = max(fwd[2], bwd[2])

    if (
        contradiction > 0.5
        and contradiction >= fwd[1]
        and contradiction >= bwd[1]
    ):
        return "contradiction", contradiction
    if entail > 0.5 and entail >= fwd[0] and entail >= bwd[0]:
        return "equivalent", entail
    return "neutral", neutral


class DebertaBackend:
    def __init__(self, model_id: str) -> None:
        os.environ["SKIP_NLI"] = "0"
        os.environ["NLI_MODEL"] = model_id
        import rlm_facts

        self._rlm = rlm_facts
        self.model_id = model_id
        if rlm_facts._get_nli() is None:
            raise RuntimeError(
                f"Failed to load CrossEncoder for {model_id}. "
                "Install requirements-full.txt (torch, sentence-transformers)."
            )

    def predict(self, prior: str, nxt: str) -> Dict[str, Any]:
        t0 = time.perf_counter()
        result = self._rlm.nli_entailment(prior, nxt)
        ms = (time.perf_counter() - t0) * 1000
        if result is None:
            return {
                "label": "neutral",
                "confidence": 0.0,
                "available": False,
                "latency_ms": round(ms, 2),
            }
        return {
            "label": result["label"],
            "confidence": result["confidence"],
            "available": True,
            "latency_ms": round(ms, 2),
            "forward": result.get("forward"),
            "backward": result.get("backward"),
        }


class LfmCosineBackend:
    """Zero-shot similarity: cannot emit contradiction."""

    def __init__(self, model_id: str, threshold: float = 0.85) -> None:
        import torch
        from transformers import AutoModelForMaskedLM, AutoTokenizer

        self.threshold = threshold
        self.model_id = model_id
        token = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_HUB_TOKEN")
        kwargs: Dict[str, Any] = {"trust_remote_code": True}
        if token:
            kwargs["token"] = token
        self.tokenizer = AutoTokenizer.from_pretrained(model_id, **kwargs)
        # AutoModelForMaskedLM loads the lfm2.* weights correctly (AutoModel mis-maps keys).
        self.model = AutoModelForMaskedLM.from_pretrained(model_id, **kwargs)
        self.model.eval()
        self.torch = torch

    def _hidden(self, text: str):
        enc = self.tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            max_length=512,
            padding=True,
        )
        with self.torch.no_grad():
            out = self.model(**enc, output_hidden_states=True)
        if out.hidden_states:
            return out.hidden_states[-1], enc["attention_mask"]
        if hasattr(self.model, "lfm2"):
            inner = self.model.lfm2(**enc)
            return inner.last_hidden_state, enc["attention_mask"]
        raise RuntimeError("Could not obtain hidden states from LFM encoder")

    def _embed(self, text: str):
        hidden, mask = self._hidden(text)
        mask_f = mask.unsqueeze(-1).float()
        pooled = (hidden * mask_f).sum(dim=1) / mask_f.sum(dim=1).clamp(min=1e-9)
        return pooled[0]

    @staticmethod
    def _cosine(a, b) -> float:
        import torch

        sim = torch.nn.functional.cosine_similarity(a.unsqueeze(0), b.unsqueeze(0))
        return float(sim.item())

    def predict(self, prior: str, nxt: str) -> Dict[str, Any]:
        t0 = time.perf_counter()
        ea = self._embed(prior)
        eb = self._embed(nxt)
        sim = self._cosine(ea, eb)
        ms = (time.perf_counter() - t0) * 1000
        if sim >= self.threshold:
            return {
                "label": "equivalent",
                "confidence": round(sim, 4),
                "available": True,
                "latency_ms": round(ms, 2),
                "cosine_similarity": round(sim, 4),
            }
        return {
            "label": "neutral",
            "confidence": round(max(0.0, 1.0 - sim), 4),
            "available": True,
            "latency_ms": round(ms, 2),
            "cosine_similarity": round(sim, 4),
        }


class LfmHeadBackend:
    """3-class cross-encoder head trained via train_nli_head.py."""

    def __init__(self, checkpoint: Path) -> None:
        import torch

        # Import custom classifier saved by train_nli_head.py
        training_dir = WORKER_ROOT / "training"
        if str(training_dir) not in sys.path:
            sys.path.insert(0, str(training_dir))
        from train_nli_head import LfmNliClassifier, ID2LABEL  # noqa: WPS433
        from transformers import AutoTokenizer

        self.torch = torch
        self.model = LfmNliClassifier.load_pretrained(checkpoint, token=os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_HUB_TOKEN"))
        self.tokenizer = AutoTokenizer.from_pretrained(
            str(checkpoint), trust_remote_code=True
        )
        self.model.eval()
        self.checkpoint = str(checkpoint)
        self.id2label = ID2LABEL

    def _probs(self, prior: str, nxt: str) -> List[float]:
        enc = self.tokenizer(
            prior,
            nxt,
            return_tensors="pt",
            truncation=True,
            max_length=512,
            padding=True,
        )
        with self.torch.no_grad():
            logits = self.model(enc["input_ids"], enc["attention_mask"])["logits"][0]
        probs = self.torch.softmax(logits, dim=-1).tolist()
        return probs[:3]

    def predict(self, prior: str, nxt: str) -> Dict[str, Any]:
        t0 = time.perf_counter()
        fwd = self._probs(prior, nxt)
        bwd = self._probs(nxt, prior)
        label, confidence = _label_from_probs(fwd, bwd)
        ms = (time.perf_counter() - t0) * 1000
        return {
            "label": label,
            "confidence": round(confidence, 4),
            "available": True,
            "latency_ms": round(ms, 2),
            "forward": [round(x, 4) for x in fwd],
            "backward": [round(x, 4) for x in bwd],
        }


def build_backend(args: argparse.Namespace):
    if args.backend == "deberta":
        model_id = args.model or "cross-encoder/nli-deberta-v3-base"
        return DebertaBackend(model_id), model_id
    if args.backend == "lfm-cosine":
        model_id = args.model or "LiquidAI/LFM2.5-Encoder-230M"
        return LfmCosineBackend(model_id, threshold=args.cosine_threshold), model_id
    if args.backend == "lfm-head":
        ckpt = Path(args.checkpoint or "")
        if not ckpt.is_dir():
            raise ValueError(f"--checkpoint required for lfm-head (dir not found: {ckpt})")
        backend = LfmHeadBackend(ckpt)
        return backend, backend.checkpoint
    raise ValueError(f"Unknown backend: {args.backend}")


def main() -> None:
    parser = argparse.ArgumentParser(description="NLI gold-set verdict generator")
    parser.add_argument(
        "--backend",
        choices=("deberta", "lfm-cosine", "lfm-head"),
        required=True,
    )
    parser.add_argument("--gold", type=Path, default=DEFAULT_GOLD)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--model", type=str, default=None)
    parser.add_argument("--checkpoint", type=str, default=None)
    parser.add_argument("--cosine-threshold", type=float, default=0.85)
    args = parser.parse_args()

    gold = load_gold(args.gold)
    backend, model_ref = build_backend(args)

    results: List[Dict[str, Any]] = []
    latencies: List[float] = []

    for pair in gold["pairs"]:
        prior = pair["prior"]
        nxt = pair["next"]
        verdict = backend.predict(prior, nxt)
        latencies.append(float(verdict.get("latency_ms") or 0))
        results.append(
            {
                "id": pair["id"],
                "scenario": pair.get("scenario"),
                "dimension": pair.get("dimension"),
                "category": pair.get("category"),
                "prior": prior,
                "next": nxt,
                **verdict,
            }
        )

    out_path = args.out or (DEFAULT_OUT_DIR / f"verdicts-{args.backend}.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "backend": args.backend,
        "model": model_ref,
        "gold_path": str(args.gold.relative_to(REPO_ROOT) if args.gold.is_relative_to(REPO_ROOT) else args.gold),
        "pair_count": len(results),
        "latency_ms": {
            "mean": round(sum(latencies) / len(latencies), 2) if latencies else 0,
            "p50": round(sorted(latencies)[len(latencies) // 2], 2) if latencies else 0,
            "max": round(max(latencies), 2) if latencies else 0,
        },
        "verdicts": results,
    }

    with out_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    print(f"Wrote {len(results)} verdicts -> {out_path}")
    print(
        f"Latency ms: mean={payload['latency_ms']['mean']} "
        f"p50={payload['latency_ms']['p50']} max={payload['latency_ms']['max']}"
    )


if __name__ == "__main__":
    main()
