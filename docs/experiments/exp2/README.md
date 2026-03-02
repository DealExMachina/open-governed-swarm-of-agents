# Experiment 2: Scalability

**Goal:** First empirical data on how governed agent coordination scales with claim count and contradiction rate.

## Protocol

The driver generates N synthetic documents with controlled contradiction rate rho, injecting them one at a time through the full pipeline. Each document produces ~5 claims via the facts-worker.

**Independent variables:**
- Claim count proxy: N documents in {10, 50, 100} (producing ~50, ~250, ~500 claims)
- Contradiction rate: rho in {0.1, 0.3, 0.5}

**Dependent variables:** Rounds to convergence, wall-clock time per round, LLM token consumption, semantic graph query latency, audit event count.

**Fixed:** Governance mode YOLO, default finality thresholds.

## Run

```bash
# Default: 50 docs, rho=0.3
bash scripts/run-experiment.sh exp2

# Vary scale
bash scripts/run-experiment.sh exp2 --claims=10 --rho=0.1 --rounds=10
bash scripts/run-experiment.sh exp2 --claims=50 --rho=0.3 --rounds=10
bash scripts/run-experiment.sh exp2 --claims=100 --rho=0.5 --rounds=10 --interval=25
```

## Recording

- `convergence_history.json` -- trajectory with distinct epochs (one per agent cycle)
- `swarm.semantic_graph.query_ms` -- histogram; expect latency to grow with |N|
- `swarm.llm.tokens` -- token consumption by role; expect linear growth with |N|
- `swarm.agent.latency_ms` -- per-agent cycle latency

## Expected results

- Rounds to convergence should grow sub-linearly with N (most cycles process similar-sized batches)
- The scaling bottleneck is likely contradiction resolution (O(c^2) edge checks), not claim extraction
- Pressure-directed activation should show value at higher N: agents concentrate on the highest-pressure dimension
- Graph query latency (`loadFinalitySnapshot`) should grow with node count

## Replication

Full matrix: 3 x 3 = 9 runs. Each takes ~4 minutes at N=50. Budget ~40 minutes for the full matrix.
