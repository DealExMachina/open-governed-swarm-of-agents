# Consistency Check: Financial Consolidation vs M&A (Project Horizon)

> Both runs: YOLO mode, **no** HITL auto-approve, 30s interval.  
> Financial: 8 rounds, corpus `docs-financial`. M&A: 7 rounds, corpus `docs` (demo).

## Summary

**The two scenarios behave consistently.** Both show the same convergence dynamics: a stable baseline V(t) ~ 0.25–0.27, a **spike to V ~ 0.55** when a contradiction is detected (with Gate A/B failures and ESCALATED finality), and **recovery** to baseline after subsequent documents. The main difference is *when* the contradiction appears (which document) and *how long* the elevated disagreement lasts, which matches the structure of each corpus.

---

## 1. Run parameters

| Parameter | Financial | M&A (demo-baseline) |
|-----------|-----------|----------------------|
| Corpus | `docs-financial` (8 docs) | `docs` (7 docs) |
| Rounds | 8 | 7 |
| Interval | 30s | 30s |
| Governance | YOLO | YOLO |
| Auto-approve | Off | Off |
| Resolve-at | 7, 8 | 5, 6, 7 |
| Results | `financial/results/2026-03-04T09-55-34` | `demo-baseline/results/2026-03-04T10-05-51` |

---

## 2. V(t) and finality trajectory

### Financial (8 docs)

| Phase | Epochs | V(t) | Goal score | Finality | Trigger |
|-------|--------|------|------------|----------|---------|
| Baseline | 1–20 | 0.25 | 0.75 | HITL | Docs 1–4 (consolidated + 3 subsidiaries) |
| **Spike** | **21–22** | **0.55** | **0.45** | **ESCALATED** | Doc 5: Alpha Q1 restated (EUR 127.4M → 126.6M) |
| Recovery | 23–42 | 0.25 | 0.75 | HITL | Docs 6–8 (Q2 comparatives, EY, management) |

- One clear spike at doc 5 (restatement); recovery within one document step.

### M&A (7 docs)

| Phase | Epochs | V(t) | Goal score | Finality | Trigger |
|-------|--------|------|------------|----------|---------|
| Baseline | 1–6 | 0.251 | 0.73 | HITL | Doc 1: Analyst briefing |
| **Spike** | **7–10** | **0.55–0.57** | **0.38–0.43** | **ESCALATED** | Doc 2: Financial due diligence (ARR €50M vs €38M; patents) |
| Recovery | 11–15 | 0.27 | 0.68 | HITL | Doc 3: Technical assessment |
| Ripple | 16–21 | 0.30 | 0.63 | HITL | Doc 4: Market intelligence |
| Settled | 22–38 | 0.26–0.28 | 0.66–0.70 | HITL | Docs 5–7: Legal, resolutions |

- Spike at doc 2 (financial due diligence); longer elevated phase (epochs 7–10), then gradual return with a small step at doc 4.

**Consistency:** In both runs, V(t) sits near **0.25** in the initial/baseline state and jumps to **~0.55** when a contradiction is detected, with goal score dropping and finality moving to ESCALATED. Values and behaviour align with the paper’s design.

---

## 3. Gate behaviour

| Gate | Financial (spike epochs 21–22) | M&A (spike epochs 7–10) |
|------|-------------------------------|---------------------------|
| A (monotonicity) | Fails | Fails |
| B (evidence) | Fails | Fails |
| C (trajectory) | Passes | Passes |
| D (quiescent) | Passes | Passes |
| E (content) | Passes | Passes |

**Consistency:** During the contradiction window, Gates A and B fail in both scenarios; C–E pass. No auto-approve, so finality stays HITL except during the spike (ESCALATED).

---

## 4. Contradictions detected

### Financial

- **1 contradiction** (later marked irrelevant after recovery):  
  “Initial consolidated revenue EUR 127.4M contradicted by adjustment to EUR 126.6M.”
- Aligns with doc 5 (Alpha Q1 restated) and doc 6 (Q2 with restated Q1 comparatives).

### M&A

- **2 contradictions** (both irrelevant at end):
  1. “Original claim of 7 granted patents without encumbrance is contradicted by the IP ownership dispute.”
  2. “Claim of €50M ARR is overstated by 24%.”
- Both come from doc 2 (financial due diligence) vs doc 1 (analyst briefing).

**Consistency:** In both cases the drift agent identifies **factual conflicts** (revenue/ARR and, in M&A, IP), creates contradiction nodes, and the system escalates. Resolution/replacement in later docs leads to recovery and contradiction nodes marked irrelevant.

---

## 5. Semantic graph (final state)

| Metric | Financial | M&A |
|--------|-----------|-----|
| Claims (active / irrelevant) | 5 / 36 | 3 / 18 |
| Contradiction nodes | 1 (irrelevant) | 2 (irrelevant) |
| Goals (active / irrelevant) | 2 / 0 | 3 / 16 |
| Risks (active / irrelevant) | 4 / 10 | 2 / 12 |
| **Edges** | **0** | **0** |

Both runs end with **no** `contradicts` or `resolves` edges in the current view; contradictions are represented as nodes and/or resolved by facts replacement, not by explicit edges in the exported snapshot. Graph structure is consistent with that.

---

## 6. Convergence history and decisions

| Metric | Financial | M&A |
|--------|-----------|-----|
| Convergence points (DB) | 48 | 44 |
| Governance decisions | 44 allow | 35 allow |
| Scope finality decisions | 0 | 0 |
| Max epoch | 42 | 38 |

No finality decisions in either run (no auto-approve). Decision counts reflect the number of governance steps (proposals accepted in YOLO mode).

---

## 7. Conclusion

- **Baseline:** Both scenarios start with V(t) ~ 0.25 and goal score ~ 0.73–0.75.
- **Spike:** Contradiction in a later document (financial: restatement; M&A: due diligence) drives V(t) to ~0.55, goal score down, Gates A and B failing, and finality ESCALATED.
- **Recovery:** After one or more subsequent documents, V(t) returns to ~0.25–0.30 and finality to HITL; contradiction nodes are marked irrelevant.
- **Gates:** Same pattern—A and B fail on spike; C–E pass.

The financial consolidation run is **consistent with the initial M&A case**: same Lyapunov and gate semantics, same escalation and recovery pattern, with differences explained by document order and content (one main contradiction in financial vs two in M&A, and a longer “ripple” in M&A at doc 4). The system behaves as intended across both scenarios.
