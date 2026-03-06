# M&A (Project Horizon)

**Use case:** Strategic buyer evaluates acquisition of NovaTech AG. Documents reveal facts, contradictions, and risks; the swarm enforces policy and escalates at the right moment.

**Corpus:** `demo/scenario/docs/` (7 documents: analyst briefing, financial DD, technical DD, market intelligence, legal review, resolution talent, resolution compliance).

**Run:**

```bash
# Demo UI (recommended)
pnpm run demo
# or shell walkthrough
./demo/run-demo.sh --fast

# Experiment-style run (no auto-approve; baseline for comparison)
bash scripts/run-experiment.sh demo-baseline
```

Full walkthrough: [docs/demo.md](../demo.md). Step-by-step guide: [demo/DEMO.md](../../demo/DEMO.md).
