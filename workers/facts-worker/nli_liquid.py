"""Liquid LFM2.5-Encoder NLI backend — zero-shot probe or fine-tuned checkpoint.

Output label order matches CrossEncoder / rlm_facts:
  0 = contradiction, 1 = entailment, 2 = neutral
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

_liquid_nli_model = None

# Per-direction zero-shot anchors (natural-language class prototypes)
_ANCHOR_TEXTS = (
    "The two statements clearly contradict each other.",
    "The first statement entails the second; they mean the same fact.",
    "The relationship is neutral, unclear, or only partially related.",
)


def _liquid_mode() -> str:
    return os.getenv("LIQUID_NLI_MODE", "zero_shot").strip().lower()


def _mean_pool(last_hidden: Any, attention_mask: Any) -> Any:
    import torch

    mask = attention_mask.unsqueeze(-1).expand(last_hidden.size()).float()
    summed = torch.sum(last_hidden * mask, dim=1)
    counts = torch.clamp(mask.sum(dim=1), min=1e-9)
    return summed / counts


def _normalize(v: Any) -> Any:
    import torch

    return torch.nn.functional.normalize(v, p=2, dim=-1)


class LiquidZeroShotNliModel:
    """Zero-shot 3-way NLI via encoder embeddings + class anchor similarity."""

    def __init__(self, model: Any, tokenizer: Any, device: str, anchor_matrix: np.ndarray) -> None:
        self._model = model
        self._tokenizer = tokenizer
        self._device = device
        self._anchor_matrix = anchor_matrix  # (3, hidden)
        self._model.eval()

    def _encode_pair(self, a: str, b: str) -> np.ndarray:
        import torch

        text = f"Statement A: {a} Statement B: {b}"
        enc = self._tokenizer(
            text,
            truncation=True,
            max_length=int(os.getenv("LIQUID_NLI_MAX_LENGTH", "512")),
            return_tensors="pt",
        )
        enc = {k: v.to(self._device) for k, v in enc.items()}
        with torch.no_grad():
            out = self._model(**enc)
            hidden = out.last_hidden_state if hasattr(out, "last_hidden_state") else out[0]
            pooled = _mean_pool(hidden, enc["attention_mask"])
            pooled = _normalize(pooled)[0].detach().cpu().numpy()
        return pooled

    def _scores_for_direction(self, a: str, b: str) -> np.ndarray:
        emb = self._encode_pair(a, b)
        # Cosine vs each anchor → pseudo-logits (scaled for softmax in rlm_facts)
        sims = self._anchor_matrix @ emb
        temperature = float(os.getenv("LIQUID_NLI_ZERO_SHOT_TEMP", "20"))
        return (sims * temperature).astype(np.float64)

    def predict(self, pairs: List[Tuple[str, str]]) -> np.ndarray:
        rows = [self._scores_for_direction(a, b) for a, b in pairs]
        return np.stack(rows, axis=0) if rows else np.zeros((0, 3))


class LiquidNliModel:
    """CrossEncoder-compatible wrapper for a fine-tuned 3-class sequence classifier."""

    def __init__(self, model: Any, tokenizer: Any, device: str) -> None:
        self._model = model
        self._tokenizer = tokenizer
        self._device = device
        self._model.eval()

    def predict(self, pairs: List[Tuple[str, str]]) -> np.ndarray:
        rows: List[np.ndarray] = []
        for a, b in pairs:
            enc = self._tokenizer(
                a,
                b,
                truncation=True,
                max_length=int(os.getenv("LIQUID_NLI_MAX_LENGTH", "512")),
                return_tensors="pt",
            )
            enc = {k: v.to(self._device) for k, v in enc.items()}
            import torch

            with torch.no_grad():
                logits = self._model(**enc).logits[0].detach().cpu().numpy()
            rows.append(logits.astype(np.float64))
        return np.stack(rows, axis=0) if rows else np.zeros((0, 3))


def _resolve_checkpoint() -> Optional[str]:
    ckpt = os.getenv("LIQUID_NLI_CHECKPOINT", "").strip()
    if ckpt and os.path.isdir(ckpt):
        return ckpt
    base = os.path.join(os.path.dirname(__file__), "checkpoints")
    for name in ("nli-domain-v3-calibrated", "nli-mnli-probe"):
        candidate = os.path.join(base, name)
        if os.path.isdir(candidate) and os.path.isfile(os.path.join(candidate, "nli_config.json")):
            return candidate
    return None


def _load_zero_shot_model() -> Optional[LiquidZeroShotNliModel]:
    import torch
    from transformers import AutoModel, AutoTokenizer

    model_id = os.getenv("LIQUID_NLI_MODEL", "LiquidAI/LFM2.5-Encoder-230M").strip()
    device = os.getenv("LIQUID_NLI_DEVICE", "cpu")
    logger.info("Loading Liquid zero-shot NLI encoder: %s on %s", model_id, device)
    tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)
    model = AutoModel.from_pretrained(model_id, trust_remote_code=True)
    model.to(device)
    model.eval()

    anchor_rows: List[np.ndarray] = []
    with torch.no_grad():
        for anchor in _ANCHOR_TEXTS:
            enc = tokenizer(anchor, return_tensors="pt", truncation=True, max_length=256)
            enc = {k: v.to(device) for k, v in enc.items()}
            out = model(**enc)
            hidden = out.last_hidden_state if hasattr(out, "last_hidden_state") else out[0]
            pooled = _mean_pool(hidden, enc["attention_mask"])
            pooled = _normalize(pooled)[0].detach().cpu().numpy()
            anchor_rows.append(pooled)
    anchor_matrix = np.stack(anchor_rows, axis=0)
    return LiquidZeroShotNliModel(model, tokenizer, device, anchor_matrix)


def _load_finetuned_model() -> Optional[LiquidNliModel]:
    ckpt = _resolve_checkpoint()
    if not ckpt:
        logger.warning("LIQUID_NLI_MODE=finetuned but no checkpoint found")
        return None

    from lfm2_nli_classifier import load_nli_checkpoint

    device = os.getenv("LIQUID_NLI_DEVICE", "cpu")
    base_id = os.getenv("LIQUID_NLI_MODEL", "LiquidAI/LFM2.5-Encoder-230M").strip()
    logger.info("Loading Liquid fine-tuned NLI checkpoint from %s (base=%s)", ckpt, base_id)
    predictor, _cfg = load_nli_checkpoint(Path(ckpt), device)
    # LiquidNliModel and Lfm2NliPredictor share the same predict() contract
    return predictor  # type: ignore[return-value]


def get_liquid_nli_model() -> Optional[LiquidZeroShotNliModel | LiquidNliModel]:
    global _liquid_nli_model
    if _liquid_nli_model is not None:
        return _liquid_nli_model

    mode = _liquid_mode()
    try:
        if mode == "finetuned":
            _liquid_nli_model = _load_finetuned_model()
        else:
            _liquid_nli_model = _load_zero_shot_model()
        return _liquid_nli_model
    except Exception as exc:
        logger.error("Failed to load Liquid NLI model (mode=%s): %s", mode, exc)
        return None


def nli_backend_name() -> str:
    return os.getenv("NLI_BACKEND", "crossencoder").strip().lower() or "crossencoder"
