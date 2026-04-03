# M&A (Project Horizon)

**Use case:** Strategic buyer evaluates acquisition of NovaTech AG. Documents reveal facts, contradictions, and risks; the swarm enforces policy and escalates at the right moment.

**Corpus:** `demo/scenario/docs/` — 5 core documents (analyst briefing, financial DD, technical, market intelligence, legal review); plus 2 optional resolution documents (talent, compliance) for experiment-style runs.

**Run:**

```bash
# Demo UI (recommended)
pnpm run demo
# or shell walkthrough
./demo/run-demo.sh --fast

# Experiment-style run (no auto-approve; baseline for comparison)
bash scripts/run-experiment.sh demo-baseline
```

Archived overview: [docs/archive/demo.md](../archive/demo.md). Step-by-step guide: [demo/DEMO.md](../../demo/DEMO.md).

## Scope isolation

- Demo routes use strict scope/session isolation.
- Shell walkthroughs require explicit scope: `DEMO_SCOPE_ID=default ./demo/run-demo.sh --fast`.
