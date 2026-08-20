# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "torch>=2.2",
#   "transformers>=4.48",
#   "datasets>=3.0",
#   "accelerate>=1.0",
#   "numpy>=1.26",
#   "huggingface_hub>=0.27",
# ]
# ///
"""Stage 1 SNLI probe on Hugging Face Jobs (L40). Self-contained UV script.

Submit (after uploading this file to the Hub or a public raw URL):
  hf jobs uv run \\
    --flavor l40sx1 \\
    --timeout 2h \\
    --secrets HF_TOKEN \\
    --env HF_HUB_MODEL=YOUR_USER/lfm25-nli-mnli-probe-l40 \\
    "https://huggingface.co/YOUR_USER/scripts/resolve/main/train_mnli_probe_l40.py"

Requires:
  - HF Pro/Team/Enterprise (Jobs are paid; l40sx1 ~$1.80/hr)
  - HF_TOKEN with write access (hf auth login)
  - No Space — Jobs run on managed GPU, not a Gradio Space
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import numpy as np
import torch
import torch.nn as nn
from transformers import AutoModelForMaskedLM, AutoTokenizer, Trainer, TrainingArguments
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
    def __init__(self, backbone: nn.Module, hidden_size: int, num_labels: int = 3) -> None:
        super().__init__()
        self.backbone = backbone
        self.dropout = nn.Dropout(0.1)
        self.classifier = nn.Linear(hidden_size, num_labels)

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


def build_nli_model(model_id: str, device: str):
    mlm = AutoModelForMaskedLM.from_pretrained(model_id, trust_remote_code=True)
    hidden_size = int(getattr(mlm.config, "hidden_size", 1024))
    model = Lfm2NliClassifier(mlm.lfm2, hidden_size=hidden_size, num_labels=3)
    tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)
    model.to(device)
    meta = NliCheckpointMeta(base_model=model_id, hidden_size=hidden_size)
    return model, tokenizer, meta


def save_nli_checkpoint(out_dir: Path, model, tokenizer, meta: NliCheckpointMeta, extra: dict | None = None):
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


_SNLI_TO_NLI = {0: 1, 1: 2, 2: 0}


def main() -> None:
    from datasets import load_dataset
    from huggingface_hub import HfApi

    model_id = os.environ.get("LIQUID_NLI_MODEL", "LiquidAI/LFM2.5-Encoder-230M")
    hub_model_id = os.environ.get("HF_HUB_MODEL", "").strip()
    max_samples = int(os.environ.get("LIQUID_TRAIN_SAMPLES", "8000"))
    epochs = int(os.environ.get("LIQUID_TRAIN_EPOCHS", "1"))
    batch_size = int(os.environ.get("LIQUID_TRAIN_BATCH", "16"))
    grad_accum = int(os.environ.get("LIQUID_GRAD_ACCUM", "2"))
    lr = float(os.environ.get("LIQUID_LR", "2e-5"))

    device = "cuda" if torch.cuda.is_available() else "cpu"
    out_dir = Path("/tmp/nli-mnli-probe-l40")
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Device: {device}  model: {model_id}  samples: {max_samples}  hub: {hub_model_id or '(local only)'}")

    model, tokenizer, meta = build_nli_model(model_id, device)

    ds = load_dataset("stanfordnlp/snli", split="train")
    ds = ds.filter(lambda x: x["label"] != -1)
    if len(ds) > max_samples:
        ds = ds.shuffle(seed=42).select(range(max_samples))

    eval_ds = load_dataset("stanfordnlp/snli", split="validation")
    eval_ds = eval_ds.filter(lambda x: x["label"] != -1)
    eval_cap = max(500, max_samples // 5)
    if len(eval_ds) > eval_cap:
        eval_ds = eval_ds.shuffle(seed=42).select(range(eval_cap))

    def map_labels(example):
        example["labels"] = _SNLI_TO_NLI[int(example["label"])]
        return example

    ds = ds.map(map_labels)
    eval_ds = eval_ds.map(map_labels)

    def tokenize(batch):
        enc = tokenizer(batch["premise"], batch["hypothesis"], truncation=True, max_length=512)
        enc["labels"] = batch["labels"]
        return enc

    tokenized = ds.map(tokenize, batched=True, remove_columns=ds.column_names)
    tokenized_eval = eval_ds.map(tokenize, batched=True, remove_columns=eval_ds.column_names)

    training_args = TrainingArguments(
        output_dir=str(out_dir / "runs"),
        num_train_epochs=epochs,
        per_device_train_batch_size=batch_size,
        per_device_eval_batch_size=batch_size,
        gradient_accumulation_steps=grad_accum,
        learning_rate=lr,
        eval_strategy="epoch",
        save_strategy="no",
        logging_steps=50,
        report_to=[],
        fp16=device == "cuda",
        dataloader_num_workers=2,
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized,
        eval_dataset=tokenized_eval,
        processing_class=tokenizer,
        compute_metrics=lambda ep: {"accuracy": float((np.argmax(ep.predictions, axis=-1) == ep.label_ids).mean())},
    )

    print(f"Training on {len(tokenized)} samples …")
    trainer.train()
    metrics = trainer.evaluate()
    print("Eval metrics:", metrics)

    save_nli_checkpoint(out_dir, model, tokenizer, meta, extra={"stage": "mnli-probe-l40", "metrics": metrics})
    (out_dir / "train_meta.json").write_text(
        json.dumps(
            {
                "stage": "mnli-probe-l40",
                "base_model": model_id,
                "device": device,
                "train_samples": len(tokenized),
                "eval_samples": len(tokenized_eval),
                "metrics": metrics,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    if hub_model_id:
        print(f"Pushing checkpoint to Hub: {hub_model_id}")
        api = HfApi()
        api.create_repo(hub_model_id, repo_type="model", exist_ok=True)
        api.upload_folder(folder_path=str(out_dir), repo_id=hub_model_id, repo_type="model")
        print(f"VERDICT: pushed {hub_model_id}")
    else:
        print("VERDICT: complete (set HF_HUB_MODEL to push checkpoint to Hub)")


if __name__ == "__main__":
    main()
