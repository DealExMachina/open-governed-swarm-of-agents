# Demo Scenarios and Benchmarks

> Back to [README](../README.md) | See also [validation.md](validation.md) and [demos/README.md](demos/README.md).

This page documents the demo scenarios shipped with the public snapshot and the load/convergence benchmarks used to validate the reference implementation. For the formal experimental protocols that accompany the paper, refer to the publication and its companion research surface.

All demo scenarios are **designed to be reproducible** with the reference implementation via `./scripts/run-experiment.sh <name>` or `./scripts/run-experiment-batch.sh`. They run under **per-dimension (vector) finality** when `per_dimension_finality.enabled: true` in `finality.yaml`.

---

## Domain demos

| Demo | Documents | What it exercises | Command |
|------|-----------|-------------------|---------|
| **M&A** (Project Horizon) | 5 | ARR contradiction, HITL escalation, approval modes | `pnpm run demo` |
| **Financial consolidation** | 8 | Bitemporal restatements, dual temporality | `./scripts/run-experiment.sh financial --rounds=8` |
| **Insurance onboarding** | 22 | Long-horizon convergence, iterative resolution | `./scripts/run-experiment.sh insurance` |
| **European Green Bond (EUGBS)** | 38 | Full bond lifecycle, regulatory transition, allocation | `./scripts/run-experiment.sh green-bond` |
| **Clinical trial** | 18 | Phase progression, protocol drift | `demo/scenario/docs-clinical-trial/` |
| **Solvency II** | -- | Regulatory stress testing | `demo/scenario/docs-solvency2/` |

Detailed protocols per demo: [docs/demos/](demos/README.md).

### Green Bond demo (EUGBS lifecycle)

A 38-document corpus simulating the full lifecycle of a EUR 250M European Green Bond (EuroVert Capital Green Bond Fund I): SPV incorporation, framework publication, SPO, investor roadshow, pricing, project onboarding (solar, wind, agrivoltaic, building retrofit, EV charging, battery storage), EUGBS regulatory transition, factsheet, CSSF designation, annual reporting, performance issues, and full allocation.

Run: `./scripts/run-experiment.sh green-bond`. Results in `docs/experiments/green-bond/results/`.

**Drain phase.** The driver uses `--drain=300` (5 minutes). After all 38 documents are injected, it keeps polling `swarm_state` until the target epoch is reached or the drain timeout fires. This allows the pipeline to finish backlog processing before the run terminates.

---

## Troubleshooting

### Why the state machine might not advance (epoch stays 0, lastNode=ContextIngested)

The pipeline advances only when agents successfully process events and the executor applies approved transitions. If you see **Final state: epoch=0, lastNode=ContextIngested** after a run:

1. **Facts agent cannot reach the facts-worker.**
   The facts agent is the first step: it consumes `context_doc` events, calls `FACTS_WORKER_URL/extract`, and on success proposes `ContextIngested -> FactsExtracted`. If `FACTS_WORKER_URL` is unset or the worker is unreachable (e.g. wrong host/port when hatchery runs on host and worker in Docker), the agent throws, NAKs the message, and the cycle never advances. **Fix:** Set `FACTS_WORKER_URL` (e.g. `http://127.0.0.1:8010`) in `.env` and ensure the facts-worker container (or process) is running. `./scripts/run-experiment.sh` runs `check-services` before the driver; if it fails, fix the reported service before re-running.

2. **Facts-worker returns 5xx or times out.**
   If the worker responds with 500 or the request times out, the facts agent NAKs the message. After `max_deliver` (3) redeliveries NATS discards the message and the pipeline stalls. **Fix:** Check facts-worker logs and LLM config (OpenAI/Ollama); increase `FACTS_WORKER_TIMEOUT_MS` if needed.

3. **Hatchery log.**
   Errors (e.g. "FACTS_WORKER_URL is required", "fetch failed", "message handler failed") are written to the hatchery log. For experiments this is `$LOG_DIR/swarm-exp-hatchery.log` (default `/tmp/swarm-exp-hatchery.log`). Inspect it after a run to see why the facts agent (or later agents) failed.

---

## Noisy corpus, Financial

- **noisy:** Ambiguous/hedging documents; `./scripts/run-experiment.sh noisy`.
- **financial:** Bitemporal reconciliation, restatements; `./scripts/run-experiment.sh financial --rounds=8`. See [demos/financial/README.md](demos/financial/README.md).

---

## Convergence benchmarks

The **convergence benchmark scenarios** in `scripts/benchmark-convergence.ts` validate the tracker with pure math (no Docker, no LLM):

| Scenario | Outcome |
|----------|---------|
| Steady convergence (~5%/round) | Monotonic, converging |
| Plateau at 0.70 | Stagnation detected |
| Spike-and-drop | Monotonicity gate blocks premature finality |
| Divergence | Negative alpha, zero forward progress |
| One-dimension bottleneck | Pressure identifies blocker |
| Fast convergence | No false plateau |
| Empty graph | Safe defaults |

Run: `pnpm tsx scripts/benchmark-convergence.ts`. Use `--runs=N` (N >= 2) to verify determinism across identical inputs.

### sgrs load benchmark (unified governance)

**Goal:** Show that multiple concurrent instances can share a single governance config and that the sgrs (Rust) kernel sustains high throughput with deterministic decisions.

**Protocol.**

- Load one governance config (e.g. `governance.yaml`) once; run N concurrent workers (instances).
- Each worker repeatedly calls sgrs: kernel, transition, rules, gates, convergence (mix configurable).
- Measure: throughput (ops/s), latency (p50/p95/p99) per operation, and consistency (same input yields same output across all instances).

**Run:**

```bash
npx tsx scripts/benchmark-sgrs-load.ts
npx tsx scripts/benchmark-sgrs-load.ts --instances=8 --duration=10 --mix=both
npx tsx scripts/benchmark-sgrs-load.ts --instances=4 --ops=50000
```

**Options:** `--instances=N`, `--duration=N`, `--ops=N`, `--mix=governance|finality|both`.

**Expected outcome:** High throughput (order of 10^5 ops/s depending on hardware), sub-millisecond latencies, and "Unified governance: all instances produced identical outputs for same inputs."

---

## Load and variational experiment (exp-load)

**Goal:** Stress-test state graph, progression, and finality under load with factorial variation.

**Protocol.**

- Vary context injection rate: baseline (20s), fast (5s), stress (2s), burst.
- Vary graph size: small (50 claims, rho=0.1), medium (200, 0.2), large (500, 0.3).
- Vary agent scaling: default vs scaled (2x workers).
- Measure: CAS rejections, state transitions/min, bootstrap-to-first-transition, V(t) monotonicity.

**Scripts:** `scripts/loadgen-inject.ts`, `scripts/run-load-experiment.sh`. See [docs/experiments/exp-load/README.md](experiments/exp-load/README.md).
