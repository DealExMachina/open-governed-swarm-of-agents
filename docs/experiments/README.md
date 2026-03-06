# Experiment protocols (assertion validation)

Reproducible experiments that validate formal claims and assumptions. Each uses the **document-driven driver** (`scripts/drive-experiment.ts`). For **domain demos** (M&A, Financial consolidation, Insurance), see [docs/demos/](../demos/README.md).

**Formal experiment program (E1–E5):** See [docs/formal-hardening.md](../formal-hardening.md) Section 7. Mapping: E1 (scalar vs vector) → exp1/exp3; E2 (Tier-3 reachability) → exp7; E3 (discretization) → exp6; E4 (confluence boundary) → exp9; E5 (adversarial compensation) → exp8.

| Experiment | Goal | Rounds | Key metric |
|------------|------|--------|------------|
| [Exp 1: Convergence Dynamics](exp1/README.md) | V(t) trajectory under varying contradiction density | 7 | V(t), alpha(t), gate satisfaction |
| [Exp 2: Scalability](exp2/README.md) | Scaling with claim count and contradiction rate | 10 | Wall-clock time, LLM tokens |
| [Exp 3: Finality Robustness](exp3/README.md) | Gate mechanism prevents false finality | 3–5 | False finality rate, gate triggers |
| [Exp 4: Multi-Level Governance](exp4/README.md) | Decision distribution across L1/L2/L3 | 7 | governance_path distribution |
| [Exp 5: Coverage-Autonomy](exp5/README.md) | YOLO vs MITL vs MASTER | 7 x 3 | alpha by mode |
| [Exp 6: Monotonic progress](exp6/README.md) | Assumptions A1, A3; discretization | 7 | dimension progress, resolver |
| [Exp 7: Tier 2/3](exp7/README.md) | Tier-3 reachability; Assumption A7 | 3 x 7 | tier coverage |
| [Exp 8: Adversarial](exp8/README.md) | Assumption A5; cooperative model | 3 sub-runs | false finality, compensation |
| [Exp 9: Local confluence](exp9/README.md) | Assumption A2; CRDT + kernel determinism | 6 sub-tests | commutativity, eventual consistency |
| demo-baseline | M&A baseline (no auto-approve) | 7 | V(t) spike, recovery |

## Quick start

```bash
bash scripts/run-experiment.sh exp1 --contradictions=3 --rounds=7 --resolve-at=5
bash scripts/run-experiment.sh exp7   # Tier 2/3 (requires OPENAI_API_KEY for Tier 3)
bash scripts/run-experiment.sh exp5 --rounds=7
```

Domain demos: `financial`, `insurance`, `demo-baseline` — see [docs/demos/](../demos/README.md) and run e.g. `bash scripts/run-experiment.sh financial --rounds=8`.

## Prerequisites

Docker stack (postgres, s3, nats, facts-worker), `.env` with DATABASE_URL, NATS_URL. For Tier 3: OPENAI_API_KEY and optionally OVERSEE_MODEL=gpt-4o (see [exp7/README.md](exp7/README.md)).

## Results

Results in `docs/experiments/<exp>/results/<timestamp>/` (gitignored). Experiments run under **per-dimension (vector) finality** when enabled in `finality.yaml`; see [docs/formal-hardening.md](../formal-hardening.md).

To run the full suite: start Docker and the swarm, then run each experiment (e.g. `bash scripts/run-experiment.sh exp1 --contradictions=3 --rounds=7`, exp2–exp9, and optionally financial/insurance). For Tier 3 (A7), use OPENAI_API_KEY and OVERSEE_MODEL=gpt-4o; see [exp7/TIER3-RUNBOOK.md](exp7/TIER3-RUNBOOK.md).
