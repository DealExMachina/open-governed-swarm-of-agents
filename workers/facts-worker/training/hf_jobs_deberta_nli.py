# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "sentence-transformers>=3.0.0",
#   "datasets>=2.14.0",
#   "torch>=2.0.0",
#   "accelerate>=0.26.0",
#   "huggingface_hub>=0.20.0",
# ]
# ///

"""HF Jobs entrypoint: full DeBERTa NLI fine-tune on mixed datasets.

Submit via Hugging Face Jobs (requires HF Pro+):
  hf jobs run --config hardware=a10g-small --timeout 4h \\
    workers/facts-worker/training/hf_jobs_deberta_nli.py

Set secrets:
  NLI_HUB_MODEL_ID=your-org/nli-deberta-v3-base-sgrs  (optional Hub push)
  HF_TOKEN=...  (required for Hub push)
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
TRAIN = REPO_ROOT / "workers" / "facts-worker" / "training" / "train_deberta_nli.py"
OUT = REPO_ROOT / "model_evals" / "nli" / "deberta-ft-full"

HUB_ID = os.getenv("NLI_HUB_MODEL_ID", "").strip()


def main() -> None:
    cmd = [
        sys.executable,
        str(TRAIN),
        "--output-dir",
        str(OUT),
        "--full",
        "--epochs",
        os.getenv("NLI_TRAIN_EPOCHS", "1"),
        "--batch-size",
        os.getenv("NLI_TRAIN_BATCH_SIZE", "16"),
        "--lr",
        os.getenv("NLI_TRAIN_LR", "1e-5"),
    ]

    print("Running:", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True, cwd=str(REPO_ROOT))

    if HUB_ID:
        from huggingface_hub import HfApi

        api = HfApi()
        api.create_repo(HUB_ID, exist_ok=True, repo_type="model")
        api.upload_folder(
            folder_path=str(OUT),
            repo_id=HUB_ID,
            repo_type="model",
            commit_message="DeBERTa NLI fine-tune (MNLI+ANLI+WANLI+FEVER+paraphrase)",
        )
        print(f"Pushed to https://huggingface.co/{HUB_ID}", flush=True)


if __name__ == "__main__":
    main()
