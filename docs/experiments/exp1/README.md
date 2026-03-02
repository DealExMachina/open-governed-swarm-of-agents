# Experiment 1: Multi-Iteration Convergence Dynamics

**Goal:** Demonstrate multi-iteration convergence behavior with characteristic V(t) trajectories under varying contradiction density.

## Protocol

The experiment driver injects M&A due diligence documents one at a time through the full pipeline (context_doc -> facts-worker -> semantic graph -> drift -> governance -> finality evaluation). Each document injection triggers a complete agent cycle, producing one convergence point.

**Independent variable:** Contradiction density c in {0, 1, 3, 5} -- controlled by selecting how many contradicting documents to include from the M&A corpus.

**Dependent variables:** V(t) trajectory, alpha(t) convergence rate, gate satisfaction per round, rounds to RESOLVED.

**Resolution injection:** At round 5 (configurable), the driver injects "resolves" edges for unresolved contradictions, simulating human or agent-driven resolution. This should produce a visible V(t) drop.

### Document corpus

7 M&A documents from `demo/scenario/docs/`:
- Docs 1-5: analyst briefing, financial DD, technical DD (introduces contradictions), market intelligence, legal review
- Docs 6-7: resolution documents (talent retention, compliance remediation)

c=0: doc 1 only (no contradictions). c=1: docs 1-2. c=3: docs 1-4. c=5: all 5 + resolutions.

## Setup

1. Docker stack running: postgres, s3, nats, facts-worker
2. `DATABASE_URL`, `NATS_URL` configured
3. Migrations applied (run-experiment.sh handles this)

## Run

```bash
# Default: c=3, 7 rounds, resolve at round 5
bash scripts/run-experiment.sh exp1

# Vary contradiction density
bash scripts/run-experiment.sh exp1 --contradictions=0 --rounds=5
bash scripts/run-experiment.sh exp1 --contradictions=1 --rounds=5
bash scripts/run-experiment.sh exp1 --contradictions=3 --rounds=7 --resolve-at=5
bash scripts/run-experiment.sh exp1 --contradictions=5 --rounds=7 --resolve-at=5
```

## Recording

Results collected to `docs/experiments/exp1/results/<timestamp>/`:

- `convergence_history.json` -- one row per evaluation cycle: epoch (from swarm_state), goal_score, lyapunov_v, pressure, gate columns (A-E), finality_state, trajectory_quality, unresolved_contradictions
- `decision_records.json` -- governance decisions with governance_path, scope_id, scope_mode
- `context_events_sample.json` -- pipeline events
- `metadata.json` -- run parameters and counts

OTEL metrics: `swarm.agent.latency_ms`, `swarm.pressure_directed.activation`, `swarm.llm.tokens`, `swarm.semantic_graph.query_ms`.

## Expected trajectory shapes

- **c=0 (no contradictions):** V(t) should decrease monotonically as claims accumulate. Goal score rises toward RESOLVED threshold. Expected shape: exponential decay.
- **c=1-3 (moderate contradictions):** V(t) decreases initially as claims arrive, then rises when contradicting documents appear (V increases = divergence). After resolution injection at round 5, V should drop sharply. Expected shape: plateau-then-resolution.
- **c=5 (heavy contradictions):** V(t) may oscillate or remain high until resolution. Gate C (trajectory quality) should detect oscillation. Expected shape: oscillation-then-escalation or resolution.

## Replication

1. Full replication: run all 4 contradiction densities
2. Each run takes ~3 minutes (7 rounds x 20s interval + startup)
3. Compare V(t) curves and gate satisfaction across runs
