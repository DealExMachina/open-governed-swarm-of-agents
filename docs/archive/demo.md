# Demo guide (archived stub)

**Canonical walkthrough:** [`demo/DEMO.md`](../../demo/DEMO.md)

**Per-domain protocols:** [`docs/demos/README.md`](../demos/README.md)

This file used to duplicate the full demo guide. Use the paths above; only scenario-specific notes belong in `docs/demos/*/README.md`.

---

## Quick preflight

```bash
pnpm run demo:preflight
pnpm run ensure-bucket && pnpm run ensure-schema && pnpm run ensure-stream
export GOVERNANCE_PATH="$(pwd)/demo/scenario/governance-demo.yaml"
pnpm run swarm:start   # terminal 1
pnpm run feed          # terminal 2
pnpm run demo          # terminal 3 — http://localhost:3003
```

- **Grafana:** http://localhost:3004 (needs `otel-collector`, `prometheus`, `grafana` from compose).
- **Skip demo preflight:** `DEMO_SKIP_PREFLIGHT=1 pnpm run demo`.

**Troubleshooting:** Demo stalls on step 1 → run `pnpm run demo:preflight` and use **`swarm:start`**, not facts-only `swarm`. Grafana empty → `docker compose up -d otel-collector` and run swarm activity.

---

## Scope isolation

Demo routes use server-minted sessions; feed APIs expect `scope_id`. For shell scripts, set `DEMO_SCOPE_ID` explicitly. See [`demo/DEMO.md`](../../demo/DEMO.md) for curl examples and governance deep dive.
