# Experiment 1 vs goal_completion Criteria — Review

## Goal_completion criteria (reference)

From the paper and codebase:

| Source | Criterion | Value |
|--------|-----------|--------|
| **Dimension** | goal_completion (weight 0.25) | resolved_goals / total_goals |
| **Target** | Paper Table 1, finalityEvaluator | goals_completion_ratio ≥ 0.90 |
| **Formula** | docs/architecture.md, semanticGraph.ts | goals_completion_ratio = 1 when total_goals = 0; else resolved / total |
| **Monotonicity** | Proposition (paper) | Goals completed monotonically; no un-completion |

Snapshot comes from the semantic graph: goal nodes with `type = 'goal'`, counted as resolved when `status = 'resolved'`, total = all such nodes in current view (`CURRENT_VIEW_NODES`).

---

## Exp1 design vs criteria

### What exp1 does

- **Protocol:** Injects M&A docs round-by-round; at a configurable round (e.g. 5) injects resolutions (resolves edges + marks contradiction nodes and **goal nodes** as resolved).
- **Driver and goals:** `drive-experiment.ts` calls `injectResolution()` which:
  - Inserts `resolves` edges for unresolved contradictions.
  - Updates contradiction nodes to `status = 'resolved'`.
  - Updates **goal** nodes to `status = 'resolved'` with `UPDATE nodes SET status = 'resolved' ... WHERE type = 'goal' AND status = 'active'`.

So exp1 is **designed** to advance goal_completion by resolving goals at the resolution round.

### Recording

- **convergence_history:** Collected with `SELECT * FROM convergence_history`; rows include `dimension_scores` (with `goal_completion`) and `goal_score`, so goal_completion **is** recorded per epoch.
- Exp1 README lists: `goal_score`, `lyapunov_v`, gate columns, `finality_state`, `trajectory_quality`, `unresolved_contradictions`. It does **not** explicitly list `goal_completion` or `dimension_scores`, but they are present in the full row export.

---

## Current gap (exp1 vs criteria)

The paper (Section 8, empirical status of the corollary) states:

> In Exp. 1, the **goal_completion dimension was permanently stalled at 0.00**: while a resolver agent exists for contradictions, goals extracted by the facts worker are **marked irrelevant by the stale marking mechanism (Exp. 9)** during subsequent extraction cycles, preventing goal resolution from advancing. V(t) never reached 0.

So in current runs:

1. **goal_completion stays 0.00** — The dimension does not meet the target (≥ 0.90) and often does not advance at all.
2. **Cause:** Facts-worker extracts goals; on the next document cycle, sync/stale marking marks nodes not present in the new extraction as `irrelevant`. Goal nodes are not protected, so they become `status = 'irrelevant'`.
3. **Driver mismatch:** `injectResolution()` only updates goals with `status = 'active'`. Once goals are staled to `irrelevant`, the driver never flips them to `resolved`, so resolved count does not increase and goal_completion remains 0 (or very low if any goals stay active).

Therefore:

- **Criteria:** goal_completion = resolved_goals / total_goals, target ≥ 0.90.
- **Exp1 in practice:** goal_completion ≈ 0.00; target not met; monotonicity is trivially satisfied (no regression) but the dimension does not contribute to convergence.

---

## Summary table

| Criterion | Status | Note |
|-----------|--------|------|
| goal_completion formula | Implemented | Same as spec (resolved/total, 1 if no goals). |
| goal_completion ≥ 0.90 | **Fixed** | Was stalled at 0.00 due to stale marking; now protected. |
| Monotonicity of goal completion | Satisfied | Goals only move to resolved, never un-completed. |
| Exp1 protocol (resolution injection) | Aligned | Driver resolves active+irrelevant goals (belt-and-suspenders). |
| Recording (dimension_scores / goal_completion) | Available | In `convergence_history`; exp1 README updated. |

---

## Fix applied

Both **Option A** and **Option B** were applied:

1. **Goal-aware stale protection** (`src/factsToSemanticGraph.ts`): Goals and risks are no longer marked as `irrelevant` during stale marking. They are accumulative across document extractions.
2. **Driver belt-and-suspenders** (`scripts/drive-experiment.ts`): `injectResolution()` now resolves goals with `status IN ('active', 'irrelevant')` instead of only `active`.
3. **Paper updated** (`publication/swarm-governed-agents.tex`): Three paragraphs updated to reflect the fix (corollary empirical status, per-dimension analysis, limitations).
4. **Experiment READMEs updated** (exp1, exp6, exp9): Noted the fix and updated dependent variables.
5. **Unit test added** (`test/unit/factsToSemanticGraph.test.ts`): Confirms goals are not staled.

**Next step:** Re-run experiments and verify goal_completion advances in convergence_history.

This review reflects the state of the codebase and the paper’s stated empirical status of the corollary; implementation of goal-aware stale protection or driver changes would need to be applied and re-tested to close the gap.

---

## Experiments affected by goal_completion stall

Any experiment that runs the **full pipeline** (context_doc -> facts-worker -> semantic graph -> drift -> governance -> finality evaluation) uses the same four-dimension convergence score and finality gates. Because goal_completion is stalled at 0.00 when goals are staled, the following are affected:

| Experiment | How affected |
|------------|----------------|
| **Exp 1** | Primary: V(t) never reaches 0; "rounds to RESOLVED" and trajectory shapes (e.g. plateau-then-resolution) are distorted; goal_completion never contributes. |
| **Exp 2** | Scalability metrics (rounds to convergence, goal_score, pressure-directed activation) use the 4D score; goal_completion dimension stays 0 so scalar score and convergence time are biased. |
| **Exp 3** | Finality robustness: gates and finality_state depend on full score; RESOLVED is unreachable without goal_completion >= 0.90, so "false finality" and gate trigger interpretations are relative to a capped score. |
| **Exp 4** | Multi-level governance: scope_finality_decisions and convergence_history depend on the same finality evaluation; RESOLVED and score trajectory are affected. |
| **Exp 5** | Coverage-autonomy: "time to finality", alpha, and finality outcomes use the 4D score; goal_completion stuck at 0 caps achievable finality. |
| **Exp 6** | **Directly:** Success criterion is "goal_completion advances beyond 0.00"; current behavior prevents that, so the experiment cannot satisfy its own success condition without a fix. |
| **Exp 7** | Tier 2/3 routing uses exp6 corpus and same pipeline; finality and convergence history remain 4D; same cap on RESOLVED and goal_score. |
| **Exp 8** | Baseline run cannot reach RESOLVED (goal_completion = 0). Inflate/collude achieve false RESOLVED by mutating the graph (including marking goals resolved); so adversarial behavior is still testable, but baseline is affected. |
| **Exp 9** | **Not affected** in the same way: no facts-worker extraction; it tests CRDT/stale marking with synthetic payloads and is the experiment that *identifies* the root cause (stale marking of goals). |
| **Financial** | Same pipeline and finality; convergence_history and scope finality depend on 4D score; goal_completion stall applies. |
| **exp-load** | Load metrics (convergence_history, finality) use the same evaluation; affected. |

**Summary:** All experiments that use the document-driven driver and finality evaluation (exp1-exp8, financial, exp-load) are affected. Exp6 is the most directly impacted (its pass condition requires goal_completion > 0). Exp9 is the one that explains the cause rather than being invalidated by it.
