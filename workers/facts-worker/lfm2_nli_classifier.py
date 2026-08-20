"""LFM2.5-Encoder + 3-class NLI head (AutoModelForSequenceClassification unsupported)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import torch
import torch.nn as nn
from transformers import AutoModelForMaskedLM, AutoTokenizer
from transformers.modeling_outputs import SequenceClassifierOutput


def mean_pool(last_hidden: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
    mask = attention_mask.unsqueeze(-1).expand(last_hidden.size()).float()
    summed = torch.sum(last_hidden * mask, dim=1)
    counts = torch.clamp(mask.sum(dim=1), min=1e-9)
    return summed / counts


@dataclass
class NliCheckpointMeta:
    base_model: str
    hidden_size: int
    num_labels: int = 3
    label_order: tuple[str, ...] = ("contradiction", "entailment", "neutral")


class Lfm2NliClassifier(nn.Module):
    """Bidirectional LFM2 encoder backbone + linear NLI head."""

    def __init__(self, backbone: nn.Module, hidden_size: int, num_labels: int = 3) -> None:
        super().__init__()
        self.backbone = backbone
        self.dropout = nn.Dropout(0.1)
        self.classifier = nn.Linear(hidden_size, num_labels)
        self.num_labels = num_labels

    def forward(
        self,
        input_ids: torch.Tensor,
        attention_mask: Optional[torch.Tensor] = None,
        labels: Optional[torch.Tensor] = None,
        **_: Any,
    ) -> SequenceClassifierOutput:
        out = self.backbone(input_ids=input_ids, attention_mask=attention_mask)
        hidden = out.last_hidden_state if hasattr(out, "last_hidden_state") else out[0]
        pooled = mean_pool(hidden, attention_mask)
        logits = self.classifier(self.dropout(pooled))
        loss = None
        if labels is not None:
            loss = nn.functional.cross_entropy(logits, labels)
        return SequenceClassifierOutput(loss=loss, logits=logits)


class Lfm2NliPredictor:
    """CrossEncoder-compatible wrapper for inference (rlm_facts / eval)."""

    def __init__(self, model: Lfm2NliClassifier, tokenizer: Any, device: str) -> None:
        self._model = model
        self._tokenizer = tokenizer
        self._device = device
        self._model.eval()

    def predict(self, pairs: list[tuple[str, str]]) -> "np.ndarray":
        import numpy as np

        rows: list[np.ndarray] = []
        for a, b in pairs:
            enc = self._tokenizer(
                a,
                b,
                truncation=True,
                max_length=512,
                return_tensors="pt",
            )
            enc = {k: v.to(self._device) for k, v in enc.items()}
            with torch.no_grad():
                logits = self._model(**enc).logits[0].detach().cpu().numpy()
            rows.append(logits.astype("float64"))
        return np.stack(rows, axis=0) if rows else np.zeros((0, 3))


def build_nli_model(model_id: str, device: str) -> tuple[Lfm2NliClassifier, Any, NliCheckpointMeta]:
    mlm = AutoModelForMaskedLM.from_pretrained(model_id, trust_remote_code=True)
    hidden_size = int(getattr(mlm.config, "hidden_size", 1024))
    model = Lfm2NliClassifier(mlm.lfm2, hidden_size=hidden_size, num_labels=3)
    tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)
    model.to(device)
    meta = NliCheckpointMeta(base_model=model_id, hidden_size=hidden_size)
    return model, tokenizer, meta


def save_nli_checkpoint(
    out_dir: Path,
    model: Lfm2NliClassifier,
    tokenizer: Any,
    meta: NliCheckpointMeta,
    extra: Optional[dict[str, Any]] = None,
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), out_dir / "nli_classifier.pt")
    tokenizer.save_pretrained(out_dir)
    payload = {
        "base_model": meta.base_model,
        "hidden_size": meta.hidden_size,
        "num_labels": meta.num_labels,
        "label_order": list(meta.label_order),
        "architecture": "lfm2_nli_classifier_v1",
    }
    if extra:
        payload.update(extra)
    (out_dir / "nli_config.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _load_tokenizer(checkpoint_dir: Path | None, base_model: str):
    if checkpoint_dir and (checkpoint_dir / "tokenizer_config.json").exists():
        try:
            return AutoTokenizer.from_pretrained(str(checkpoint_dir), trust_remote_code=True)
        except Exception:
            pass
    return AutoTokenizer.from_pretrained(base_model, trust_remote_code=True)


def load_nli_model_for_training(
    checkpoint_dir: Path | None, model_id: str, device: str
) -> tuple[Lfm2NliClassifier, Any, NliCheckpointMeta]:
    if checkpoint_dir and (checkpoint_dir / "nli_config.json").exists():
        cfg = json.loads((checkpoint_dir / "nli_config.json").read_text(encoding="utf-8"))
        base_model = cfg.get("base_model", model_id)
        mlm = AutoModelForMaskedLM.from_pretrained(base_model, trust_remote_code=True)
        model = Lfm2NliClassifier(
            mlm.lfm2,
            hidden_size=int(cfg.get("hidden_size", 1024)),
            num_labels=int(cfg.get("num_labels", 3)),
        )
        state = torch.load(checkpoint_dir / "nli_classifier.pt", map_location="cpu", weights_only=True)
        model.load_state_dict(state)
        tokenizer = _load_tokenizer(checkpoint_dir, base_model)
        meta = NliCheckpointMeta(
            base_model=base_model,
            hidden_size=int(cfg.get("hidden_size", 1024)),
        )
        model.to(device)
        return model, tokenizer, meta
    return build_nli_model(model_id, device)


def load_nli_checkpoint(checkpoint_dir: Path, device: str) -> tuple[Lfm2NliPredictor, dict[str, Any]]:
    cfg = json.loads((checkpoint_dir / "nli_config.json").read_text(encoding="utf-8"))
    base_model = cfg["base_model"]
    mlm = AutoModelForMaskedLM.from_pretrained(base_model, trust_remote_code=True)
    model = Lfm2NliClassifier(
        mlm.lfm2,
        hidden_size=int(cfg.get("hidden_size", 1024)),
        num_labels=int(cfg.get("num_labels", 3)),
    )
    state = torch.load(checkpoint_dir / "nli_classifier.pt", map_location="cpu", weights_only=True)
    model.load_state_dict(state)
    model.to(device)
    model.eval()
    tokenizer = _load_tokenizer(checkpoint_dir, base_model)
    return Lfm2NliPredictor(model, tokenizer, device), cfg
