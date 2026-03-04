# Experiment 7: Tier 2/3 Governance Routing

**Assumption #4**: The multi-tier governance architecture (Tier 1: deterministic,
Tier 2: MITL, Tier 3: LLM) is never fully exercised — only Tier 1 decisions
(`acceptDeterministic`) have been observed.

## Root Cause

Two bugs prevented Tier 2/3 from being exercised:

1. **Drift schema gap**: The default `governance.yaml` blocks transitions on
   `drift_level: [critical]`, but the drift agent's Zod schema only allowed
   `none | low | medium | high`. The `critical` threshold was unreachable.
   **Fix**: Added `"critical"` to the drift agent schema.

2. **Mode propagation bug**: `agentLoop.ts` hardcoded `mode: "YOLO"` on all
   proposals (line 155). The governance agent routes based on `proposal.mode`,
   so MITL/MASTER modes were never seen by the kernel.
   **Fix**: Read effective governance mode from config (respects `GOVERNANCE_MODE` env var).

## Experiment Design

Uses `governance-exp7.yaml` with a lowered threshold: `block_when: drift_level: [high]`.
Since the drift agent produces `high` when contradictions are detected, this makes
the transition block reachable.

Runs 3 sub-experiments with the same exp6 corpus:

| Sub-run | Mode | Expected Tier Coverage |
|---------|------|----------------------|
| exp7-YOLO | YOLO | Tier 1 (deterministic). Tier 3 if `OPENAI_API_KEY` set (oversight → escalateToLLM) |
| exp7-MITL | MITL | Tier 1 + Tier 2 (kernel escalates with `mitl_required` on high drift) |
| exp7-MASTER | MASTER | Tier 1 (kernel rejects blocked transitions; MASTER is most restrictive) |

### Tier Trigger Conditions

- **Tier 1**: Always. Kernel evaluates transition rules deterministically.
- **Tier 2**: MITL mode + high drift blocks `DriftChecked → ContextIngested`.
  Kernel returns `escalate` + `mitl_required`. `simulate-mitl` auto-approves.
- **Tier 3**: YOLO mode + oversight LLM. Oversight agent sees obligations from
  high drift and may choose `escalateToLLM` for full LLM governance.

## Running

```bash
bash scripts/run-experiment.sh exp7
```

Runs ~15 minutes (3 × 7 rounds × 20s intervals).

## Analysis

```bash
pnpm tsx scripts/analyze-tier-coverage.ts docs/experiments/exp7/results/
```

Reports:
- Per-run tier distribution
- Aggregate coverage across all 3 modes
- Obligation triggering frequency
- `governance_path` breakdown

## Results

**Assumption #4 VALIDATED**: All governance tiers (1, 2, 3) exercised.

### Per-mode results (301 decisions total)

| Mode | Decisions | Tier 1 | Tier 2 | Tier 3 | Rejected |
|------|-----------|--------|--------|--------|----------|
| YOLO | 215 | 187 (87%) | 0 | 28 (13%) | 8 |
| MITL | 46 | 3 (6.5%) | 43 (93.5%) | 0 | 0 |
| MASTER | 40 | 40 (100%) | 0 | 0 | 18 |

### Aggregate tier distribution

| Tier | Count | Percentage |
|------|-------|-----------|
| Tier 1: Deterministic | 230 | 76.4% |
| Tier 2: MITL escalation | 43 | 14.3% |
| Tier 3: LLM governance | 28 | 9.3% |

### Key observations

- **MASTER correctly rejects**: 18/40 proposals denied (45%) due to high drift blocking transitions
- **MITL kernel escalation works**: 93.5% of MITL decisions escalated with `mitl_required`
- **Oversight LLM routing works**: 28 proposals routed through `processProposalWithAgent` (Tier 3)
- All three modes correctly propagate `scope_mode` in decision records

## Bugs Fixed

| Bug | File | Description |
|-----|------|-------------|
| Hardcoded YOLO mode | `src/agentLoop.ts:155` | Proposals always sent with `mode: "YOLO"` regardless of governance config |
| Missing "critical" drift level | `src/agents/driftAgent.ts:39` | Zod schema only allowed `none\|low\|medium\|high`; default governance.yaml referenced unreachable `critical` |
| Missing governance path for MITL | `src/agents/governanceAgent.ts` | `processProposal()` used default path "processProposal" even for MITL escalation; added `processProposal_mitlEscalation` path |

## Success Criteria

- [x] Tier 1 exercised in all 3 modes (baseline)
- [x] Tier 2 exercised in MITL mode (kernel escalation → MITL server)
- [x] Tier 3 exercised in YOLO mode with LLM (oversight → escalateToLLM)
- [x] All 3 tiers observed across the aggregate

## Key Files

- `governance-exp7.yaml` — Custom policy with `block_when: [high]`
- `demo/scenario/docs-exp6/` — Shared corpus (produces contradictions → high drift)
- `scripts/analyze-tier-coverage.ts` — Post-processing tier coverage analysis
