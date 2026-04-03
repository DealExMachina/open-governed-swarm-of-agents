# Proposed Experimental Protocol

> Back to [README](../README.md) | See also [publications/publication_1/swarm-governed-agents.tex](../publications/publication_1/swarm-governed-agents.tex) Section 9 and [validation.md](validation.md).

The paper defines five experimental protocols designed to address open questions in the literature---particularly those identified by de la Chica Rodriguez and Vera Diaz (SECP). These experiments are **designed to be reproducible** using the reference implementation.

**Implementation:** Seed scripts, drivers, result collection, and analysis are in place. Run via `./scripts/run-experiment.sh exp<N>` or batch with `./scripts/run-experiment-batch.sh`. Experiments run under **per-dimension (vector) finality** when `per_dimension_finality.enabled: true` in `finality.yaml`.

| Experiment | GitHub Issue |
|------------|--------------|
| 1. Convergence dynamics | [#12](https://github.com/DealExMachina/swarm-of-governed-agents/issues/12) |
| 2. Scalability | [#13](https://github.com/DealExMachina/swarm-of-governed-agents/issues/13) |
| 3. Finality robustness | [#14](https://github.com/DealExMachina/swarm-of-governed-agents/issues/14) |
| 4. Multi-level governance | [#15](https://github.com/DealExMachina/swarm-of-governed-agents/issues/15) |
| 5. Coverage-autonomy trade-off | [#16](https://github.com/DealExMachina/swarm-of-governed-agents/issues/16) (closed) |
| 6. Monotonic progress + discretization (Assumptions 3, 1) | [#20](https://github.com/DealExMachina/swarm-of-governed-agents/issues/20) |
| 7. Tier 2/3 governance (Assumption 4), Tier-3 reachability | [#21](https://github.com/DealExMachina/swarm-of-governed-agents/issues/21) |
| 8. Cooperative agent model (Assumption 5) | [#22](https://github.com/DealExMachina/swarm-of-governed-agents/issues/22) |
| 9. Local confluence (Assumption 2) | [#23](https://github.com/DealExMachina/swarm-of-governed-agents/issues/23) |

**Domain demos (use cases):** M&A (Project Horizon), Financial consolidation, Insurance onboarding and pricing, and European Green Bond Standard (EUGBS) lifecycle are documented in [docs/demos/](demos/README.md). They use the same driver and run via `run-experiment.sh financial`, `insurance`, `demo-baseline`, `green-bond`.

### Stage 2 evidence diffusion results

All four domain demos now produce real evidence diffusion trajectories through the sheaf propagation engine. The propagation agent fires at `DriftChecked`, builds perturbation vectors from convergence dimension scores, runs one sheaf diffusion step, and publishes evidence along sheaf edges via the evidence bus.

| Demo | Rounds | Prop. epochs | Omega(0) | Omega(final) | Reduction | rho range | ISS |
|------|--------|-------------|----------|-------------|-----------|-----------|-----|
| M&A baseline | 14 | 2 | 6.86 | 3.16 | 53.9% | 0.46 | satisfied |
| Financial | 16 | 3 | 6.86 | 1.72 | 74.9% | 0.46-0.54 | satisfied |
| Insurance | 22 | 3 | 6.86 | 0.50 | 92.8% | 0.26-0.28 | satisfied |
| Green Bond (EUGBS) | 38 | 8 | 6.86 | 0.20 | 97.1% | 0.20-0.31 (contraction), 38.2 (divergence) | satisfied |

Key observations:
- Contraction ratio rho < 1 at every step (Theorem 1 holds empirically).
- ISS small-gain condition satisfied throughout (Theorem 2).
- Spectral gap = 7.0 (7-node complete graph, maximum for this topology).
- Evidence bus publishes 14-28 objects per epoch along the 7 sheaf edges.
- Insurance shows strongest contraction: more documents build richer convergence signal.
- Scalability: propagation runs proportional to state machine cycles (not NATS events). 22 docs produce 3 propagation epochs and 21 evidence_states rows (previously 37K+ epochs and 263K rows).

### Green Bond demo (European Green Bond Standard lifecycle)

The green-bond demo is a 38-document corpus simulating the full lifecycle of a EUR 250M European Green Bond (EuroVert Capital Green Bond Fund I): SPV incorporation, framework publication, SPO, investor roadshow, pricing, project onboarding (solar, wind, agrivoltaic, building retrofit, EV charging, battery storage), EUGBS regulatory transition, factsheet, CSSF designation, annual reporting, performance issues, and full allocation.

Run: `./scripts/run-experiment.sh green-bond`. Results in `docs/experiments/green-bond/results/`.

**Drain phase:** The driver uses `--drain=300` (5 minutes). After all 38 documents are injected, it keeps polling `swarm_state` until the target epoch is reached or the drain timeout fires. This allows the pipeline to finish backlog processing and yields more propagation epochs (8 instead of ~5 without drain).

Propagation trajectory (8 epochs with drain):

| Epoch | Omega | rho | Narrative |
|-------|-------|------|-----------|
| 0-4 | 6.86 -> 0.15 | 0.26-0.31 | Contraction -- projects onboarded, EUGBS gap analysis, designation |
| 5 | 38.2 | 38.2 | Divergence -- regulatory shock (TSC amendment, construction delay, underperformance) |
| 6-7 | 0.20 | 0.20 | Re-contraction -- system settles after perturbation |

Key observations:
- Geometric contraction (epochs 0-4) reduces disagreement by 97.9%.
- Epoch 5 demonstrates correct ISS behavior: new contradictions (TSC reclassification, EolienSud delay, ChargeNet underperformance) inject fresh evidence that temporarily increases disagreement.
- Epochs 6-7 show re-contraction; the system settles after the regulatory shock.
- `cascade_stable = true` throughout: the ISS small-gain condition holds even during the divergent epoch, meaning the system is bounded.
- Evidence bus published 14-28 objects per epoch along 7 sheaf edges.

### Why the state machine might not advance (epoch stays 0, lastNode=ContextIngested)

The pipeline advances only when agents successfully process events and the executor applies approved transitions. If you see **Final state: epoch=0, lastNode=ContextIngested** after a run:

1. **Facts agent cannot reach the facts-worker**  
   The facts agent is the first step: it consumes `context_doc` events, calls `FACTS_WORKER_URL/extract`, and on success proposes `ContextIngested -> FactsExtracted`. If `FACTS_WORKER_URL` is unset or the worker is unreachable (e.g. wrong host/port when hatchery runs on host and worker in Docker), the agent throws, NAKs the message, and the cycle never advances. **Fix:** Set `FACTS_WORKER_URL` (e.g. `http://127.0.0.1:8010`) in `.env` and ensure the facts-worker container (or process) is running. `./scripts/run-experiment.sh` now runs `check-services` before the driver; if it fails, fix the reported service before re-running.

2. **Facts-worker returns 5xx or times out**  
   If the worker responds with 500 or the request times out, the facts agent NAKs the message. After `max_deliver` (3) redeliveries NATS discards the message and the pipeline stalls. **Fix:** Check facts-worker logs and LLM config (OpenAI/Ollama); increase `FACTS_WORKER_TIMEOUT_MS` if needed.

3. **Hatchery log**  
   Errors (e.g. "FACTS_WORKER_URL is required", "fetch failed", "message handler failed") are written to the hatchery log. For experiments this is `$LOG_DIR/swarm-exp-hatchery.log` (default `/tmp/swarm-exp-hatchery.log`). Inspect it after a run to see why the facts agent (or later agents) failed.

---

## Proposed experiments (1–5)

Experiments 1–5 (convergence dynamics, scalability, finality robustness, multi-level governance, coverage-autonomy) are defined in the paper and linked to GitHub issues above. Per-experiment setup, run commands, and result locations: [experiments/README.md](experiments/README.md). Stage 2 propagation experiments E1–E7: [stage-2-status-and-experiments.md](stage-2-status-and-experiments.md). Formal assumption validation (E1–E5 program): [formal-hardening.md](formal-hardening.md) Section 7.

---

## Experiment 8: Adversarial Agent Defense (exp8)

**Goal:** Validate Assumption #5 (cooperative agent model) by demonstrating that adversarial agents can cause false finality when the cooperative assumption is violated.

**Protocol:**

- Run 3 sub-experiments using the exp6 corpus (M&A due diligence with genuine contradictions):
  - **baseline**: Normal pipeline, no adversarial injection (ground truth)
  - **inflate**: After each cycle, inject adversarial mutations (confidence inflation, fake contradiction resolution, goal completion)
  - **collude**: Same as inflate + overwrite drift to "none" (simulates compromised drift agent)
- All runs use YOLO governance (most permissive, giving adversary best chance)
- Measure: V(t) trajectory, false finality rate, gate trigger profile, dimension inflation

**Expected outcome:** Baseline stays ESCALATED. Inflate is caught by honest drift agent. Collude achieves false finality (RESOLVED with fake scores), confirming the cooperative model is structurally necessary.

**Run:** `./scripts/run-experiment.sh exp8`. See [experiments/exp8/README.md](experiments/exp8/README.md).

---

## Experiment 9 (exp9)

Local confluence (Assumption A2): CRDT commutativity, eventual consistency, monotonic confidence ratchet, idempotency, kernel determinism, cross-epoch convergence. No LLM or Docker.

**Run:** `./scripts/run-experiment.sh exp9`. See [experiments/exp9/README.md](experiments/exp9/README.md).

---

## Noisy corpus, Financial

- **noisy:** Ambiguous/hedging documents; `./scripts/run-experiment.sh noisy`.
- **financial:** Bitemporal reconciliation, restatements; `./scripts/run-experiment.sh financial --rounds=8`. See [demos/financial/README.md](demos/financial/README.md).

---

## Relationship to Existing Benchmarks

The **7 convergence benchmark scenarios** in `scripts/benchmark-convergence.ts` validate mathematical properties with pure math (no Docker, no LLM):

| Scenario | Outcome |
|----------|---------|
| Steady convergence (~5%/round) | Monotonic, converging |
| Plateau at 0.70 | Stagnation detected |
| Spike-and-drop | Monotonicity gate blocks premature finality |
| Divergence | Negative alpha, zero forward progress |
| One-dimension bottleneck | Pressure identifies blocker |
| Fast convergence | No false plateau |
| Empty graph | Safe defaults |

These benchmarks are a prerequisite for Experiments 1 and 3. The full experiments require Docker, LLM, and end-to-end pipeline execution.

### sgrs load benchmark (unified governance)

**Goal:** Show that multiple concurrent instances can share a single governance config and that the sgrs (Rust) kernel sustains high throughput with deterministic decisions.

**Protocol:**

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

## Load and Variational Experiment (exp-load)

**Goal:** Stress-test state graph, progression, and finality under load with factorial variation.

**Protocol:**

- Vary context injection rate: baseline (20s), fast (5s), stress (2s), burst
- Vary graph size: small (50 claims, rho=0.1), medium (200, 0.2), large (500, 0.3)
- Vary agent scaling: default vs scaled (2x workers)
- Measure: CAS rejections, state transitions/min, bootstrap-to-first-transition, V(t) monotonicity

**Scripts:** `scripts/loadgen-inject.ts`, `scripts/run-load-experiment.sh`. See [docs/experiments/exp-load/README.md](experiments/exp-load/README.md).
