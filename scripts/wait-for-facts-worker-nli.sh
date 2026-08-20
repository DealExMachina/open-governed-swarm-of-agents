#!/usr/bin/env bash
# Fail-closed wait until facts-worker /health reports NLI capability.
# Usage: wait_for_facts_worker_nli http://127.0.0.1:8015 [max_tries=180] [sleep_sec=5]
wait_for_facts_worker_nli() {
  local base_url="${1:?worker base URL required}"
  local max_tries="${2:-180}"
  local sleep_sec="${3:-5}"
  base_url="${base_url%/}"

  local i health
  for ((i = 1; i <= max_tries; i++)); do
    health="$(curl -sf "${base_url}/health" 2>/dev/null || true)"
    if [[ -n "$health" ]] && echo "$health" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if 'nli' in d.get('capabilities',[]) else 1)" 2>/dev/null; then
      echo "NLI ready at ${base_url} after $((i * sleep_sec))s"
      echo "$health" | python3 -m json.tool
      return 0
    fi
    sleep "$sleep_sec"
  done

  echo "ERROR: NLI not ready at ${base_url} after $((max_tries * sleep_sec))s" >&2
  return 1
}
