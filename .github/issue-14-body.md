## Goal
Demonstrate that the 5-gate mechanism prevents false finality under adversarial conditions.

## Protocol
Inject adversarial evidence patterns:
- Spike-and-drop: sudden high confidence followed by contradiction
- Oscillating claims: alternating contradictory evidence
- Stale evidence: exceeds max_age_days during convergence
- Empty scope: trivial initialization

Measure: false finality rate (RESOLVED despite unresolved contradictions), gate trigger frequency, ESCALATED rate.

## Expected outcome
Gate C (oscillation detection) catches patterns simple thresholds miss; Gate B (evidence freshness) blocks finality on stale data.

## Implementation
Extend `scripts/benchmark-convergence.ts` or create `scripts/experiment-finality-robustness.ts`

See paper Section 9, docs/experiments.md

---

## Latest results (2026-03-04)

Run: spike-and-drop pattern, 4 rounds.

| Metric | Value |
|--------|--------|
| Finality | 0 |
| Final epoch | 10 |
| Last node | FactsExtracted |

**Outcome:** Pipeline reached FactsExtracted; no false finality. Gates correctly block finality after contradiction arrival; spike-and-drop mechanism validated. Oscillating and stale patterns not run in this batch (see protocol for full matrix).

**Result dir:** `docs/experiments/exp3/results/2026-03-04T11-57-45`

---

## Outstanding / Close recommendation

**Core goal achieved for spike-and-drop:** No false finality; gates blocked correctly; pipeline reached FactsExtracted.

**Outstanding:** Protocol specifies four adversarial patterns: spike-and-drop (done), **oscillating**, **stale**, **empty scope**. Oscillating and stale test Gate C and Gate B explicitly; empty scope tests trivial init. Run `--pattern=oscillating` and `--pattern=stale` (and optional empty-scope) to complete protocol.

**Recommendation:** Leave open until oscillating and stale patterns are run and documented.
