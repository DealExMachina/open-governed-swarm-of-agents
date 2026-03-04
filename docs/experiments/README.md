# Experiment Protocols

Five reproducible experiments defined in the paper (Section 9) and implemented in this repository. Each experiment uses the **document-driven driver** (`scripts/drive-experiment.ts`) which injects documents through the full agent pipeline, producing multi-point convergence trajectories.

| Experiment | Goal | Rounds | Key metric |
|------------|------|--------|------------|
| [Exp 1: Convergence Dynamics](exp1/README.md) | V(t) trajectory shapes under varying contradiction density | 7 | V(t), alpha(t), gate satisfaction |
| [Exp 2: Scalability](exp2/README.md) | Scaling behavior with claim count and contradiction rate | 10 | Wall-clock time, LLM tokens, query latency |
| [Exp 3: Finality Robustness](exp3/README.md) | Gate mechanism prevents false finality under adversarial patterns | 3-5 | False finality rate, gate triggers |
| [Exp 4: Multi-Level Governance](exp4/README.md) | Decision distribution across L1/L2/L3 governance levels | 7 | governance_path distribution |
| [Exp 5: Coverage-Autonomy](exp5/README.md) | YOLO vs MITL vs MASTER convergence rate comparison | 7 x 3 | alpha by mode |
| [Financial: Dual Temporality](financial/README.md) | Bitemporal consolidation with restatements and ambiguity | 8 | V(t) under temporal supersession |
| demo-baseline | M&A (Project Horizon) without auto-approve; baseline for comparison | 7 | V(t) spike on doc 2, recovery |

See [COMPARISON-financial-vs-ma.md](COMPARISON-financial-vs-ma.md) for consistency check (financial vs M&A).

## Quick Start

```bash
# Run a single experiment (resets DB, starts hatchery, drives docs, collects)
bash scripts/run-experiment.sh exp1 --contradictions=3 --rounds=7 --resolve-at=5

# Run the scalability matrix
for n in 10 50 100; do
  for rho in 0.1 0.3 0.5; do
    bash scripts/run-experiment.sh exp2 --claims=$n --rho=$rho --rounds=10
  done
done

# Run exp5 (3 governance modes, automated)
bash scripts/run-experiment.sh exp5 --rounds=7

# Run financial consolidation (dual temporality, 8 docs)
bash scripts/run-experiment.sh financial --rounds=8
```

## Multiple runs and various scenarios

To check consistency across runs and across scenario variants:

- **Multiple runs, one scenario:** run the same experiment config N times and aggregate (mean/std, gate frequencies, finality distribution). Use `run-experiment-batch.sh`:

  ```bash
  bash scripts/run-experiment-batch.sh exp1 3 --contradictions=3 --rounds=7 --resolve-at=5
  ```

  Results go to `docs/experiments/<exp_id>/results/<batch_ts>/run-1..run-N` and `summary.json`. The analysis script (`scripts/analyze-experiment.ts`) computes trajectory stats and gate satisfaction across runs.

- **Multiple runs on various scenarios:** run several scenario configs (e.g. exp1 with different contradiction counts, exp3 with different patterns), each with N runs, and get a single summary. Use `run-scenarios-batch.sh`:

  ```bash
  bash scripts/run-scenarios-batch.sh [n_runs]
  ```

  Default `n_runs=2`. Scenarios (hardcoded): exp1 with contradictions=0, 1, 3, 5; exp3 with pattern=spike-and-drop, oscillating, stale. Output: `docs/experiments/_batch_<timestamp>/<label>/` (e.g. `exp1-contradictions0/`, `exp3-spike-and-drop/`) with run-1..run-N and `summary.json` per scenario. The script prints a short consistency summary (finality_state distribution, n_runs) per scenario; use each scenario’s `summary.json` for full mean/std and gate frequencies.

## Prerequisites

- Docker stack: postgres, s3, nats, facts-worker (via `docker compose up -d`)
- `.env` with DATABASE_URL, NATS_URL, OPENAI_API_KEY (or local Ollama)
- The experiment runner handles: kill stale agents, reset DB, apply migrations, start hatchery, drive documents, collect results

## How the driver works

Unlike seed-then-wait, `drive-experiment.ts` actively injects documents one at a time through the full pipeline:

1. Inject document via context_events + NATS publish
2. Wait for agent cycle (facts extraction -> drift -> governance -> finality)
3. Record convergence point with correct epoch from swarm_state
4. Optionally inject resolutions at a configurable round
5. Repeat for N rounds

This produces multi-point V(t) trajectories with distinct epochs, pressure evolution, and gate state progression.

## Results

Results in `docs/experiments/<exp>/results/<timestamp>/` (gitignored). OTEL metrics via Prometheus/Grafana for additional observability.
