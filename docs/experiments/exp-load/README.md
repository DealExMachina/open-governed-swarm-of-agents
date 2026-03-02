# Load and Variational Experiment: State Graph, Progression, Finality

**Goal:** Stress-test the three core design features under load with factorial variation of key parameters. Exploit local headroom to identify bottlenecks and validate behavior at scale.

## Design Features Under Test

| Feature | What we measure | Stress vectors |
|---------|------------------|----------------|
| **State graph** | CAS success rate, epoch advancement, transition throughput | Concurrent proposals, fast injection |
| **Progression** | Epochs/min, cycle completion rate, bootstrap-to-first-transition | Graph size, injection rate |
| **Finality** | Convergence time, V(t) monotonicity, gate triggers (plateau, oscillation) | Contradiction density, adversarial patterns |

## Factorial Design

### Dimension 1: Context injection rate

| Level | Delay (ms) | Docs/min | Description |
|-------|------------|----------|-------------|
| baseline | 20000 | 3 | Current demo pace |
| fast | 5000 | 12 | 4x faster |
| stress | 2000 | 30 | Near-saturation |
| burst | 0 | N/A | All docs at once (burst mode) |

Env: `LOAD_INJECT_DELAY_MS`, `LOAD_BURST=1` for burst.

### Dimension 2: Graph complexity

| Level | Claims | rho | Seed script |
|-------|--------|-----|-------------|
| small | 50 | 0.1 | seed-exp2 --claims=50 --rho=0.1 |
| medium | 200 | 0.2 | seed-exp2 --claims=200 --rho=0.2 |
| large | 500 | 0.3 | seed-exp2 --claims=500 --rho=0.3 |

### Dimension 3: Agent scaling

| Level | Facts | Drift | Planner | Status |
|-------|-------|-------|---------|--------|
| default | 1-4 | 1-4 | 1-4 | 1-2 |
| scaled | 2-6 | 2-6 | 2-6 | 2-4 |

Env: `HATCHERY_FACTS_MIN=2 HATCHERY_FACTS_MAX=6` etc.

### Dimension 4: Contradiction density (optional, exp1-style)

| Level | c | Description |
|-------|---|-------------|
| none | 0 | Trivial convergence |
| low | 1 | Single contradiction |
| medium | 3 | Typical |
| high | 5 | Heavy resolution load |

Use exp1 seed for this dimension; exp2 for graph size.

## Reduced Design (recommended first pass)

Run a 2^3 design to find main effects:

1. **Injection**: baseline (20s) vs stress (2s)
2. **Graph**: small (50, 0.1) vs large (500, 0.3)
3. **Agent scaling**: default vs scaled

Total: 8 runs. Duration per run: 180s (3 min).

## Metrics

Results include `load_metrics.json` with:

### State graph

- `cas_rejections`: count of proposals rejected due to epoch mismatch
- `state_transitions_count`: from context_events (type=state_transition)
- `proposals_approved`, `proposals_rejected`
- `epoch_max`: highest epoch reached

### Progression

- `bootstrap_to_first_transition_ms`: wall-clock latency
- `cycles_completed`: full 3-node cycles
- `cycles_per_min`: when duration known

### Finality

- `v_monotonicity_violations`: count of V(t) > V(t-1) in convergence_history
- `final_decision`: RESOLVED | ESCALATED | BLOCKED | EXPIRED

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/loadgen-inject.ts` | Configurable context injection (rate, burst) |
| `scripts/run-load-experiment.sh` | Orchestrate reset, seed, loadgen, hatchery, collect |
| `scripts/collect-experiment-results.ts` | Extended for load metrics (exp-load) |

## Usage

```bash
# Single run: stress injection + large graph
./scripts/run-load-experiment.sh \
  --injection=stress \
  --graph=large \
  --scaling=default \
  --duration=180

# Full 2^3 sweep (8 runs)
./scripts/run-load-experiment.sh --sweep

# Custom env override
LOAD_INJECT_DELAY_MS=2000 CLAIMS=500 RHO=0.3 ./scripts/run-load-experiment.sh --duration=180
```

## Expected Outcomes

- **State graph:** CAS rejections should increase under stress (many concurrent proposals). Throughput should plateau when facts worker is saturated.
- **Progression:** Cycles/min should decrease with graph size (O(n) claim processing). Bootstrap latency should be stable.
- **Finality:** Convergence time should grow with contradiction density. V(t) monotonicity preserved; plateau/oscillation gates fire under adversarial conditions.

## Demo Expansion

The demo seed supports faster injection:

```bash
DEMO_DELAY_MS=2000 npm run seed:demo   # stress pace (2s between docs)
```

For programmable injection (burst, repeat, custom delay), use loadgen:

```bash
LOAD_INJECT_DELAY_MS=2000 pnpm seed:loadgen   # stress
LOAD_BURST=1 pnpm seed:loadgen               # all 5 docs at once
LOAD_REPEAT=3 pnpm seed:loadgen              # 3 batches
```

Run loadgen after the swarm is up. Use `pnpm seed:loadgen`.
