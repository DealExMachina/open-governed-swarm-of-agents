#!/usr/bin/env python3
"""Fine-tune LFM2.5-Encoder with a 3-class NLI head (MNLI).

Produces a checkpoint loadable by:
  workers/facts-worker/tools/nli_verdicts.py --backend=lfm-head

The frozen gold set (test/fixtures/nli-gold-set.yaml) must NEVER be used for training.

Usage:
  python workers/facts-worker/training/train_nli_head.py \\
    --base-model LiquidAI/LFM2.5-Encoder-230M \\
    --output-dir model_evals/nli/lfm-head-230m \\
    --max-train-samples 5000 --epochs 1
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset
from transformers import AutoModelForMaskedLM, AutoTokenizer

REPO_ROOT = Path(__file__).resolve().parents[3]

MNLI_TO_CANONICAL = {
    "contradiction": "contradiction",
    "entailment": "entailment",
    "neutral": "neutral",
}

CANONICAL_LABELS = ("contradiction", "entailment", "neutral")
LABEL2ID = {name: i for i, name in enumerate(CANONICAL_LABELS)}
ID2LABEL = {i: name for i, name in enumerate(CANONICAL_LABELS)}


class NliPairDataset(Dataset):
    def __init__(
        self,
        rows: List[Dict[str, Any]],
        tokenizer,
        max_length: int = 512,
    ) -> None:
        self.rows = rows
        self.tokenizer = tokenizer
        self.max_length = max_length

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, idx: int) -> Dict[str, torch.Tensor]:
        row = self.rows[idx]
        enc = self.tokenizer(
            row["premise"],
            row["hypothesis"],
            truncation=True,
            max_length=self.max_length,
            padding="max_length",
        )
        return {
            "input_ids": torch.tensor(enc["input_ids"], dtype=torch.long),
            "attention_mask": torch.tensor(enc["attention_mask"], dtype=torch.long),
            "labels": torch.tensor(row["label"], dtype=torch.long),
        }


class LfmNliClassifier(nn.Module):
    """Encoder backbone + mean pool + linear 3-way NLI head."""

    def __init__(
        self,
        backbone: nn.Module,
        hidden_size: int,
        num_labels: int = 3,
        dropout: float = 0.1,
        base_model_id: str = "",
    ) -> None:
        super().__init__()
        self.backbone = backbone
        self.dropout = nn.Dropout(dropout)
        self.classifier = nn.Linear(hidden_size, num_labels)
        self.base_model_id = base_model_id
        self.hidden_size = hidden_size
        self.num_labels = num_labels

    @classmethod
    def from_base(cls, model_id: str, token: Optional[str] = None) -> "LfmNliClassifier":
        kwargs: Dict[str, Any] = {"trust_remote_code": True, "attn_implementation": "eager"}
        if token:
            kwargs["token"] = token
        mlm = AutoModelForMaskedLM.from_pretrained(model_id, **kwargs)
        backbone = getattr(mlm, "lfm2", mlm)
        hidden = getattr(mlm.config, "hidden_size", 1024)
        return cls(backbone=backbone, hidden_size=hidden, base_model_id=model_id)

    def forward(
        self,
        input_ids: torch.Tensor,
        attention_mask: torch.Tensor,
        labels: Optional[torch.Tensor] = None,
    ) -> Dict[str, torch.Tensor]:
        out = self.backbone(input_ids=input_ids, attention_mask=attention_mask)
        hidden = getattr(out, "last_hidden_state", None)
        if hidden is None and isinstance(out, (tuple, list)):
            hidden = out[0]
        mask_f = attention_mask.unsqueeze(-1).float()
        pooled = (hidden * mask_f).sum(dim=1) / mask_f.sum(dim=1).clamp(min=1e-9)
        pooled = self.dropout(pooled)
        logits = self.classifier(pooled)
        if logits.dim() > 2:
            logits = logits.squeeze()
        result: Dict[str, torch.Tensor] = {"logits": logits}
        if labels is not None:
            result["loss"] = nn.functional.cross_entropy(logits, labels)
        return result

    def save_pretrained(self, directory: Path) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        torch.save(self.state_dict(), directory / "pytorch_model.bin")
        meta = {
            "architectures": ["LfmNliClassifier"],
            "base_model_id": self.base_model_id,
            "hidden_size": self.hidden_size,
            "num_labels": self.num_labels,
            "id2label": ID2LABEL,
            "label2id": LABEL2ID,
        }
        (directory / "config.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    @classmethod
    def load_pretrained(cls, directory: Path, token: Optional[str] = None) -> "LfmNliClassifier":
        meta = json.loads((directory / "config.json").read_text(encoding="utf-8"))
        model = cls.from_base(meta["base_model_id"], token=token)
        state = torch.load(directory / "pytorch_model.bin", map_location="cpu", weights_only=True)
        model.load_state_dict(state)
        model.eval()
        return model


def load_mnli_rows(max_samples: Optional[int] = None) -> List[Dict[str, Any]]:
    from datasets import load_dataset

    ds = load_dataset("nyu-mll/glue", "mnli", split="train")
    rows: List[Dict[str, Any]] = []
    for ex in ds:
        label = ex.get("label")
        if label is None or label < 0:
            continue
        label_name = ds.features["label"].names[label]
        canon = MNLI_TO_CANONICAL.get(label_name)
        if canon is None:
            continue
        rows.append(
            {
                "premise": ex["premise"],
                "hypothesis": ex["hypothesis"],
                "label": LABEL2ID[canon],
            }
        )
        if max_samples and len(rows) >= max_samples:
            break
    return rows


def load_mnli_validation(max_samples: Optional[int] = 2000) -> List[Dict[str, Any]]:
    from datasets import load_dataset

    ds = load_dataset("nyu-mll/glue", "mnli", split="validation_matched")
    rows: List[Dict[str, Any]] = []
    for ex in ds:
        label = ex.get("label")
        if label is None or label < 0:
            continue
        label_name = ds.features["label"].names[label]
        canon = MNLI_TO_CANONICAL.get(label_name)
        if canon is None:
            continue
        rows.append(
            {
                "premise": ex["premise"],
                "hypothesis": ex["hypothesis"],
                "label": LABEL2ID[canon],
            }
        )
        if max_samples and len(rows) >= max_samples:
            break
    return rows


def evaluate(model: LfmNliClassifier, loader: DataLoader, device: torch.device) -> float:
    model.eval()
    correct = 0
    total = 0
    with torch.no_grad():
        for batch in loader:
            batch = {k: v.to(device) for k, v in batch.items()}
            logits = model(batch["input_ids"], batch["attention_mask"])["logits"]
            preds = logits.argmax(dim=-1)
            correct += (preds == batch["labels"]).sum().item()
            total += batch["labels"].numel()
    return correct / total if total else 0.0


def train_epoch(
    model: LfmNliClassifier,
    loader: DataLoader,
    optimizer: torch.optim.Optimizer,
    device: torch.device,
) -> float:
    model.train()
    total_loss = 0.0
    steps = 0
    for batch in loader:
        batch = {k: v.to(device) for k, v in batch.items()}
        optimizer.zero_grad()
        out = model(batch["input_ids"], batch["attention_mask"], labels=batch["labels"])
        loss = out["loss"]
        loss.backward()
        optimizer.step()
        total_loss += float(loss.item())
        steps += 1
        if steps % 25 == 0:
            print(f"    step {steps}/{len(loader)} loss={total_loss/steps:.4f}", flush=True)
    return total_loss / max(steps, 1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-model", default="LiquidAI/LFM2.5-Encoder-230M")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=REPO_ROOT / "model_evals" / "nli" / "lfm-head-230m",
    )
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--max-train-samples", type=int, default=None)
    parser.add_argument("--max-eval-samples", type=int, default=2000)
    parser.add_argument("--max-length", type=int, default=512)
    args = parser.parse_args()

    token = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_HUB_TOKEN")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    print(f"Loading MNLI (max_train={args.max_train_samples})...")
    train_rows = load_mnli_rows(args.max_train_samples)
    eval_rows = load_mnli_validation(args.max_eval_samples)
    print(f"  train={len(train_rows)} eval={len(eval_rows)}")

    tok_kwargs: Dict[str, Any] = {"trust_remote_code": True}
    if token:
        tok_kwargs["token"] = token
    tokenizer = AutoTokenizer.from_pretrained(args.base_model, **tok_kwargs)
    model = LfmNliClassifier.from_base(args.base_model, token=token).to(device)

    train_loader = DataLoader(
        NliPairDataset(train_rows, tokenizer, args.max_length),
        batch_size=args.batch_size,
        shuffle=True,
    )
    eval_loader = DataLoader(
        NliPairDataset(eval_rows, tokenizer, args.max_length),
        batch_size=args.batch_size,
    )

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.1)
    best_acc = 0.0
    best_state: Optional[Dict[str, torch.Tensor]] = None

    print(f"Training on {device} -> {args.output_dir}")
    for epoch in range(1, args.epochs + 1):
        loss = train_epoch(model, train_loader, optimizer, device)
        acc = evaluate(model, eval_loader, device)
        print(f"  epoch {epoch}/{args.epochs} loss={loss:.4f} eval_acc={acc:.4f}")
        if acc >= best_acc:
            best_acc = acc
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}

    if best_state is not None:
        model.load_state_dict(best_state)
    model.save_pretrained(args.output_dir)
    tokenizer.save_pretrained(str(args.output_dir))
    print(f"Saved checkpoint to {args.output_dir} (best eval_acc={best_acc:.4f})")


if __name__ == "__main__":
    main()
