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

Each demo scenario has a dedicated Studio catalog scope (see `src/scenarioScopes.ts`):

| Scenario | Scope id |
|---|---|
| M&A | `deal-horizon` |
| Financial | `meridian-holdings` |
| Insurance | `insurance-review` |
| Green bond | `green-bond-2026` |

Basic Example / scratch in Studio uses `default` — not a demo scenario scope.

- Demo UI: pick a scenario → that scope is reset, hatchery bound, docs fed there.
- Shell walkthrough (`./demo/run-demo.sh`) is M&A-only; default `DEMO_SCOPE_ID=deal-horizon`.
- **Runtime:** one hatchery, one active processing scope — see [issue #21](https://github.com/DealExMachina/open-governed-swarm-of-agents/issues/21).
