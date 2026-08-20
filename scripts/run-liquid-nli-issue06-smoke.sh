#!/usr/bin/env bash
# Issue 06 acceptance smoke: v3-calibrated Liquid NLI via live /nli endpoint.
#
# Verifies response schema and expected labels for one paraphrase + one contradiction
# pair from test/fixtures/nli-gold-set.yaml (Issue 01).
#
# Usage:
#   ./scripts/run-liquid-nli-issue06-smoke.sh
#   LIQUID_GOLD_EVAL_LOCAL=1 ./scripts/run-liquid-nli-issue06-smoke.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/wait-for-facts-worker-nli.sh
source "$ROOT/scripts/wait-for-facts-worker-nli.sh"

CHECKPOINT="${LIQUID_NLI_CHECKPOINT:-workers/facts-worker/checkpoints/nli-domain-v3-calibrated}"
PORT="${LIQUID_SMOKE_PORT:-8017}"
USE_LOCAL="${LIQUID_GOLD_EVAL_LOCAL:-1}"

cd "$ROOT"

if [[ ! -d "$ROOT/$CHECKPOINT" && ! -d "$CHECKPOINT" ]]; then
  echo "ERROR: checkpoint missing at $CHECKPOINT" >&2
  echo "Pull with: hf download jeanbaptdzd/lfm25-nli-v3-calibrated-l4 --local-dir $ROOT/workers/facts-worker/checkpoints/nli-domain-v3-calibrated" >&2
  exit 1
fi

CKPT_ABS="$ROOT/workers/facts-worker/${CHECKPOINT#workers/facts-worker/}"
if [[ "$CHECKPOINT" = /* ]]; then CKPT_ABS="$CHECKPOINT"; fi

if [[ "$USE_LOCAL" == "1" ]]; then
  VENV="${ROOT}/model_evals/liquidai-encoders/.venv"
  if [[ ! -x "$VENV/bin/python" ]]; then
    echo "ERROR: LIQUID_GOLD_EVAL_LOCAL=1 but $VENV missing (run stage2 recipe setup first)" >&2
    exit 1
  fi
  echo "Starting local Liquid v3 worker on port ${PORT} …"
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
else
  CONTAINER="${LIQUID_SMOKE_CONTAINER:-asg-facts-liquid-smoke}"
  rel="${CKPT_ABS#"$ROOT/workers/facts-worker"}"
  CKPT_CONTAINER="/app${rel}"
  docker rm -f "$CONTAINER" 2>/dev/null || true
  docker compose run -d --name "$CONTAINER" --no-deps \
    -p "${PORT}:8010" \
    -v "$ROOT/workers/facts-worker:/app" \
    -v "${HOME}/.cache/huggingface:/root/.cache/huggingface" \
    -e SKIP_NLI=0 \
    -e NLI_BACKEND=liquidai \
    -e LIQUID_NLI_MODE=finetuned \
    -e "LIQUID_NLI_CHECKPOINT=${CKPT_CONTAINER}" \
    -e LIQUID_NLI_DEVICE=cpu \
    -e "OPENAI_API_KEY=${OPENAI_API_KEY:-sk-dummy}" \
    -e PYTHONUNBUFFERED=1 \
    facts-worker \
    sh -c "pip install -q fastapi uvicorn pydantic torch transformers sentence-transformers openai python-dotenv && uvicorn app:app --host 0.0.0.0 --port 8010"
  trap 'docker rm -f "$CONTAINER" 2>/dev/null || true' EXIT
  WORKER_URL="http://127.0.0.1:${PORT}"
fi

wait_for_facts_worker_nli "$WORKER_URL" 120 3

python3 <<PY
import json
import sys
import urllib.request

base = "${WORKER_URL}".rstrip("/")
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

failures = []
for p in pairs:
    out = call_nli(p["a"], p["b"])
    if out.get("available") is not True:
        failures.append(f"{p['id']}: available=false")
        continue
    for key in ("label", "confidence"):
        if key not in out:
            failures.append(f"{p['id']}: missing {key}")
    if out.get("label") != p["expect"]:
        failures.append(f"{p['id']}: got {out.get('label')} expected {p['expect']} (conf={out.get('confidence')})")
    else:
        print(f"PASS {p['id']}: {out['label']} @ {out.get('confidence', 0):.3f}")

if failures:
    print("Issue 06 smoke FAILED:", file=sys.stderr)
    for f in failures:
        print(f"  - {f}", file=sys.stderr)
    sys.exit(1)

print("Issue 06 smoke PASSED (v3-calibrated Liquid NLI wired)")
PY
