#!/usr/bin/env bash
# Issue 06/07 pipeline: start v3 Liquid worker, smoke /nli, then B5 HITL NLI replay.
#
# Usage:
#   ./scripts/run-liquid-nli-b5-hitl-replay.sh
#   BASELINE_WORKER_URL=http://127.0.0.1:8010 ./scripts/run-liquid-nli-b5-hitl-replay.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/wait-for-facts-worker-nli.sh
source "$ROOT/scripts/wait-for-facts-worker-nli.sh"

OUT="${1:-model_evals/liquidai-encoders/b5-hitl-nli-replay-v3.json}"
PORT="${LIQUID_B5_PORT:-8018}"
CHECKPOINT="${LIQUID_NLI_CHECKPOINT:-workers/facts-worker/checkpoints/nli-domain-v3-calibrated}"
CKPT_ABS="$ROOT/workers/facts-worker/${CHECKPOINT#workers/facts-worker/}"
if [[ "$CHECKPOINT" = /* ]]; then CKPT_ABS="$CHECKPOINT"; fi

cd "$ROOT"

if [[ ! -d "$CKPT_ABS" ]]; then
  echo "ERROR: checkpoint missing at $CKPT_ABS" >&2
  exit 1
fi

VENV="${ROOT}/model_evals/liquidai-encoders/.venv"
if [[ ! -x "$VENV/bin/python" ]]; then
  echo "ERROR: $VENV missing" >&2
  exit 1
fi

echo "Starting Liquid v3 worker on port ${PORT} …"
# shellcheck disable=SC1091
source "$VENV/bin/activate"
pip install -q fastapi uvicorn pydantic openai python-dotenv 2>/dev/null || true
SKIP_NLI=0 NLI_BACKEND=liquidai LIQUID_NLI_MODE=finetuned \
  LIQUID_NLI_CHECKPOINT="$CKPT_ABS" LIQUID_NLI_DEVICE=cpu \
  OPENAI_API_KEY="${OPENAI_API_KEY:-sk-dummy}" \
  uvicorn app:app --host 127.0.0.1 --port "$PORT" \
  --app-dir "$ROOT/workers/facts-worker" &
UV_PID=$!
trap 'kill "$UV_PID" 2>/dev/null || true' EXIT

WORKER_URL="http://127.0.0.1:${PORT}"
wait_for_facts_worker_nli "$WORKER_URL" 120 3

echo ""
echo "== Issue 06 smoke =="
WORKER_URL="$WORKER_URL" python3 <<'PY'
import json
import os
import sys
import urllib.request

base = os.environ["WORKER_URL"].rstrip("/")
pairs = [
    {
        "id": "s1-arr-paraphrase-01",
        "expect": "equivalent",
        "a": "ARR €50M (FY 2024, self-reported)",
        "b": "annual recurring revenue of approximately fifty million euros",
    },
    {
        "id": "s1-arr-contradiction-01",
        "expect": "contradiction",
        "a": "Revenue grew by 10 percent year over year",
        "b": "Revenue fell by 10 percent year over year",
    },
]

def call_nli(a, b):
    req = urllib.request.Request(
        f"{base}/nli",
        data=json.dumps({"a": a, "b": b}).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)

for p in pairs:
    out = call_nli(p["a"], p["b"])
    if out.get("available") is not True or out.get("label") != p["expect"]:
        print(f"FAIL {p['id']}: {out}", file=sys.stderr)
        sys.exit(1)
    print(f"PASS {p['id']}: {out['label']} @ {out.get('confidence', 0):.3f}")
print("Issue 06 smoke PASSED")
PY

echo ""
echo "== B5 HITL NLI replay =="
FACTS_WORKER_URL="$WORKER_URL" \
  npx tsx scripts/replay-hitl-nli-b5.ts --out="$OUT"

echo ""
echo "Pipeline smoke + B5 replay complete."
