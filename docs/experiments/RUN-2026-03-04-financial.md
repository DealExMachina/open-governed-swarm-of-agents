# Experiment Run: Financial Consolidation (2026-03-04)

> Corpus: `demo/scenario/docs-financial/` (8 documents) | Mode: YOLO, no auto-approve

## Run parameters

- Experiment: `financial`
- Rounds: 8, interval: 30s
- Governance: YOLO mode (deterministic accept)
- HITL auto-approve: **disabled** (no simulate-mitl)
- Resolution injection: rounds 7, 8 (0 edges/nodes found to resolve)
- Results: `docs/experiments/financial/results/2026-03-04T09-55-34/`

## Pipeline execution

| Round | Document | Seq | Epoch | Chars |
|-------|----------|-----|-------|-------|
| 1 | Consolidated Q1 summary | 1 | 0 | 1,599 |
| 2 | Alpha Industrials Q1 | 13 | 4 | 2,400 |
| 3 | Beta Services Q1 | 27 | 10 | 2,773 |
| 4 | Gamma Digital Q1 | 32 | 12 | 2,517 |
| 5 | Alpha Q1 restated | 45 | 18 | 2,698 |
| 6 | Q2 preliminary + Q1 comparatives | 56 | 22 | 3,707 |
| 7 | EY interim review | 60 | 23 | 5,886 |
| 8 | Management response | 76 | 30 | 7,098 |

Final state: epoch 42, 44 governance decisions (all allow), 48 convergence points.

## Semantic graph

| Type | Active | Irrelevant | Total |
|------|--------|------------|-------|
| claim | 5 | 36 | 41 |
| contradiction | 0 | 1 | 1 |
| goal | 2 | 0 | 2 |
| risk | 4 | 10 | 14 |

Active claims at final state: restated Q1 revenue (EUR 125.8M), Alpha restated margin (36.5%), Q2 preliminary revenue (EUR 134.1M), Gamma Daimler discount, methodology inconsistencies.

Active risks: revenue discrepancy confusion, revenue recognition restatement risk, equity vs. loan classification, reporting delay from policy standardization.

Active goals: EUR 520M full-year revenue, 14-15% EBITDA margin.

## V(t) convergence trajectory

The trajectory shows a clear **spike-and-recovery** pattern centered on the Alpha Q1 restatement (round 5):

```
Epoch  V(t)  Goal   Gate-A  Gate-B  Finality  Contradictions  Context
 1-2   0.25  0.75   F       T       HITL      0               seq=1   (doc 1: consolidated Q1)
 3-10  0.25  0.75   T       T       HITL      0               seq=13  (doc 2: Alpha Q1)
11-12  0.25  0.75   T       T       HITL      0               seq=27  (doc 3: Beta Q1)
13-18  0.25  0.75   T       T       HITL      0               seq=32  (doc 4: Gamma Q1)
19-20  0.25  0.75   T       T       HITL      0               seq=45  (doc 5: Alpha restated, pre-drift)
21-22  0.55  0.45   F       F       ESCALATED 1               seq=45  (doc 5: contradiction detected!)
23     0.25  0.75   T       T       HITL      0               seq=56  (doc 6: Q2 preliminary)
24-30  0.25  0.75   T       T       HITL      0               seq=60  (doc 7: EY review)
31-42  0.25  0.75   T       T       HITL      0               seq=76  (doc 8: mgmt response)
```

## Key findings

### 1. Contradiction detected on restatement (epochs 21-22)

The Alpha Q1 restated document (doc 5) triggered a contradiction:

> "The initial consolidated revenue report of EUR 127.4M is now contradicted by an adjustment to EUR 126.6M, affecting the overall financial outlook."

This caused:
- V(t) to spike from 0.25 to 0.55 (+120%)
- Goal score to drop from 0.75 to 0.45
- Gate A (monotonicity) to fail
- Gate B (evidence coverage) to fail
- Finality state to escalate from HITL to ESCALATED
- 1 unresolved contradiction registered

### 2. Recovery after Q2 document (epoch 23)

The contradiction was resolved by epoch 23 (after doc 6, Q2 preliminary with restated Q1 comparatives). The facts agent's next extraction cycle replaced the contradicting claims with a consistent set incorporating the restated figures. V(t) returned to 0.25.

### 3. Auditor and management response (epochs 24-42)

Despite the EY interim review (doc 7) identifying five observations with hedging language and ranges, and the management response (doc 8) partially disagreeing with auditor estimates, no further contradictions were detected. The drift agent classified these as "none" drift, likely because:
- The auditor's range-based observations (e.g., "39-41% gross margin") are compatible with the existing claim set
- The management response's disagreements are framed as forward-looking actions rather than factual contradictions

### 4. Gate behavior

- **Gate A (monotonicity)**: Failed at epochs 1-2 (initial, no prior point) and 21-22 (V jumped upward). Behaved as designed.
- **Gate B (evidence coverage)**: Failed at epochs 21-22 during contradiction. Evidence was incomplete while facts were being re-extracted.
- **Gates C, D, E**: Passed throughout. No oscillation detected (Gate C), system was quiescent between injections (Gate D), and content was always present (Gate E).

### 5. Finality lifecycle

No auto-approve was active, so finality remained HITL throughout (except ESCALATED at epochs 21-22). This matches expectation: without human approval, the system cannot reach RESOLVED. The single ESCALATED episode demonstrates that the five-gate mechanism correctly blocks finality during active contradiction.

## Comparison with previous run (auto-approve)

| Metric | Run 1 (auto-approve) | Run 2 (no auto-approve) |
|--------|---------------------|------------------------|
| Convergence points | 1 | 48 |
| Contradictions detected | 0 | 1 |
| V(t) range | 0.25 (flat) | 0.25-0.55 (spike) |
| ESCALATED episodes | 0 | 1 (epochs 21-22) |
| Gate failures | A only (epoch 1) | A + B (epochs 21-22) |
| Finality | Approved (round 1) | HITL (unresolved) |
| Total nodes | 88 | 58 |
| Governance decisions | 53 | 44 |

## Interpretation

The financial consolidation scenario successfully demonstrates:

1. **Contradiction detection on temporal restatement**: The Alpha restated figures (same valid period Q1, later transaction time) triggered a contradiction with the original figures, causing V(t) to spike and finality to escalate.

2. **Gate mechanism working**: Gates A and B correctly blocked finality during the contradiction episode. The system escalated rather than approving on inconsistent data.

3. **Recovery dynamics**: The contradiction was resolved within one document injection cycle, showing the system's self-healing property through facts re-extraction.

4. **Ambiguity tolerance**: The auditor's hedged observations and the management response's partial disagreements did not trigger false contradictions, suggesting the LLM-based drift detection correctly distinguishes methodological ambiguity from factual contradiction.

The scenario would benefit from running under MITL and MASTER modes (exp5-style) to observe how governance routing affects the contradiction resolution pathway.
