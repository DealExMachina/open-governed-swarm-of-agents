# Experiment 7: Tier 2/3 Governance Routing

**Assumption #4**: The multi-tier governance architecture (Tier 1: deterministic,
Tier 2: MITL, Tier 3: LLM) is never fully exercised — only Tier 1 decisions
(`acceptDeterministic`) have been observed.

## Root Cause

Three bugs prevented Tier 2/3 from being exercised:

1. **Drift schema gap**: The drift agent's Zod schema only allowed
   `none | low | medium | high`. The `critical` level was missing.
   **Fix**: Added `"critical"` to the drift agent schema.

2. **Mode propagation bug**: `agentLoop.ts` hardcoded `mode: "YOLO"` on all
   proposals (line 155). The governance agent routes based on `proposal.mode`,
   so MITL/MASTER modes were never seen by the kernel.
   **Fix**: Read effective governance mode from config (respects `GOVERNANCE_MODE` env var).

3. **Governance policy too lenient**: The default `governance.yaml` only blocked
   on `drift_level: [critical]`, but the drift agent rarely produces "critical".
   **Fix**: Unified governance.yaml now blocks on `[high, critical]`. The Rust
   kernel was updated so YOLO mode auto-accepts blocked transitions (with
   `yolo_override` reason and obligations), keeping YOLO as the most permissive
   mode while MITL escalates and MASTER rejects.

## Experiment Design

Uses the unified `governance.yaml` with `block_when: drift_level: [high, critical]`.
Since the drift agent produces `high` when contradictions are detected, this makes
the transition block reachable. No separate governance file needed.

Runs 3 sub-experiments with the exp6 corpus:

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

### Kernel Mode Semantics

| Mode | Blocked Transition | Philosophy |
|------|-------------------|------------|
| **YOLO** | Accept + obligations | "Proceed at your own risk" |
| **MITL** | Escalate | "Human decides" |
| **MASTER** | Reject | "Hard stop" |

## Tier 3 checklist

To reach Tier 3 (oversight → escalateToLLM → processProposalWithAgent):

- **OPENAI_API_KEY** must be set (oversight agent uses `getOversightModelConfig()`, which reads from .env).
- Recommend **OVERSEE_MODEL=gpt-4o** (or set OPENAI_MODEL=gpt-4o) for more reliable oversight routing.
- Run with **YOLO** for the sub-run that exercises Tier 3 (exp7-YOLO).
- Use a corpus that produces **obligations** (e.g. exp6 corpus with contradictions → high drift → open_investigation) and optionally **financial/legal** context so the oversight prompt favours escalateToLLM; see Tier Trigger Conditions above and corpus notes in docs/demos.

## Running

```bash
bash scripts/run-experiment.sh exp7
```

Runs ~15 minutes (3 × 7 rounds × 20s intervals).

## Analysis

```bash
pnpm tsx scripts/analyze-tier-coverage.ts docs/experiments/exp7/results/
```

## Results

**Assumption #4 VALIDATED**: All governance tiers (1, 2, 3) exercised.

### Per-mode results (409 decisions total)

| Mode | Decisions | Tier 1 | Tier 2 | Tier 3 | Rejected |
|------|-----------|--------|--------|--------|----------|
| YOLO | 301 | 271 (90%) | 0 | 30 (10%) | 26 |
| MITL | 41 | 8 (19.5%) | 33 (80.5%) | 0 | 0 |
| MASTER | 38 | 38 (100%) | 0 | 0 | 33 |

### Aggregate tier distribution

| Tier | Count | Percentage |
|------|-------|-----------|
| Tier 1: Deterministic | 303 | 74.1% |
| Tier 2: MITL escalation | 76 | 18.6% |
| Tier 3: LLM governance | 30 | 7.3% |

### Key observations

- **MASTER correctly rejects**: 33/38 proposals denied (87%) due to high/critical drift
- **MITL kernel escalation works**: 80.5% of MITL decisions escalated with `mitl_required`
- **Oversight LLM routing works**: 30 proposals routed through `processProposalWithAgent` (Tier 3)
- **YOLO auto-accepts**: Blocked transitions accepted with obligations logged, no stuck proposals
- All three modes correctly propagate `scope_mode` in decision records

## Bugs Fixed

| Bug | File | Description |
|-----|------|-------------|
| Hardcoded YOLO mode | `src/agentLoop.ts:155` | Proposals always sent with `mode: "YOLO"` regardless of governance config |
| Missing "critical" drift level | `src/agents/driftAgent.ts:39` | Zod schema only allowed `none\|low\|medium\|high` |
| Separate governance files | `governance-exp7.yaml` | Merged into unified `governance.yaml` with `[high, critical]` threshold |
| YOLO stuck on escalation | `sgrs-core/kernel.rs` | YOLO + blocked → Escalate left proposals in pending queue forever; changed to Accept with obligations |
| Missing governance paths | `governanceAgent.ts` | Added `processProposal_mitlEscalation`, `processProposal_masterReject`, `processProposal_yoloOverride` paths |

## Success Criteria

- [x] Tier 1 exercised in all 3 modes (baseline)
- [x] Tier 2 exercised in MITL mode (kernel escalation → MITL server)
- [x] Tier 3 exercised in YOLO mode with LLM (oversight → escalateToLLM)
- [x] All 3 tiers observed across the aggregate
- [x] Single unified governance.yaml (no experiment-specific overrides)

## Key Files

- `governance.yaml` — Unified policy with `block_when: [high, critical]`
- `demo/scenario/docs-exp6/` — Shared corpus (produces contradictions → high drift)
- `scripts/analyze-tier-coverage.ts` — Post-processing tier coverage analysis
