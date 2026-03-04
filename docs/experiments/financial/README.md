# Financial Consolidation Experiment (Dual Temporality)

> Back to [experiments README](../README.md) | Corpus: `demo/scenario/docs-financial/`

## Goal

Demonstrate that the bitemporal semantic graph and the five-gate finality mechanism handle **multi-period financial statement reconciliation** -- a domain where dual temporality (valid time vs. transaction time) is structurally necessary, not merely decorative.

Unlike the Project Horizon M&A scenario (which tests contradiction detection on a single target company), this experiment uses a **holding company consolidation** where three subsidiaries report overlapping metrics with different accounting methodologies, figures are restated across periods, and an external auditor introduces further ambiguity. The scenario is designed so that naive contradiction detection (ignoring temporal overlap) produces false positives, and naive convergence (ignoring restatement ordering) produces incorrect finality.

## Scenario: Meridian Holdings H1 2025

Meridian Holdings consolidates three subsidiaries: Alpha Industrials (manufacturing), Beta Services (consulting), and Gamma Digital (SaaS). The 8 documents arrive sequentially and create a layered web of contradictions, ambiguities, and temporal restatements.

### Document injection order

| Round | Document | Valid period | Tx date | Role |
|-------|----------|-------------|---------|------|
| 1 | Consolidated Q1 summary | Q1 2025 | Apr 18 | Baseline: group-level headline figures |
| 2 | Alpha Industrials Q1 | Q1 2025 | Apr 14 | Contradicts group total (EUR 61.3M vs implied EUR 58.2M); inter-company dispute |
| 3 | Beta Services Q1 | Q1 2025 | Apr 15 | Contradicts Alpha on inter-company (EUR 2.3M vs EUR 3.1M); aggressive revenue recognition |
| 4 | Gamma Digital Q1 | Q1 2025 | Apr 12 | Revenue methodology mismatch (EUR 29.8M local vs EUR 27-28.2M group); equity vs. loan |
| 5 | Alpha Q1 restated | Q1 2025 (restated) | May 22 | **Temporal restatement**: same valid time, later transaction time; supersedes doc 2 |
| 6 | Q2 preliminary with Q1 comparatives | Q2 2025 + Q1 restated | Jul 21 | Cross-period; revised Q1 baseline (EUR 125.8M vs original 127.4M); new Q2 data |
| 7 | EY interim review | H1 2025 | Aug 14 | Auditor observations: hedging, ranges, classification uncertainty |
| 8 | Management response | H1 2025 | Aug 28 | Partial resolution; introduces forward-looking ambiguity |

### Contradiction and ambiguity map

**Hard contradictions (numerical disagreements on same valid period):**

- Group consolidated revenue EUR 127.4M vs. sum of subsidiaries (EUR 61.3M + EUR 43.9M + EUR 29.8M = EUR 135.0M before eliminations; implied eliminations EUR 7.6M vs. stated EUR 4.8M)
- Alpha inter-company revenue: EUR 3.1M (Alpha) vs. EUR 2.3M (Beta's view)
- Gamma revenue: EUR 29.8M (local) vs. EUR 27.0-28.2M (group methodology)
- Group gross margin: 41.7% (original) vs. 40.6% (restated) vs. 39-41% (EY estimate)
- Headcount: 1,247 (original) vs. 1,271 (restated methodology) vs. 1,247 (subsidiary sum: 512 + 389 + 346)

**Temporal contradictions (same valid time, different transaction times):**

- Alpha Q1 revenue: EUR 61.3M (Apr 14) superseded by EUR 60.5M (May 22)
- Alpha gross margin: 38.4% (Apr 14) superseded by 36.5% (May 22)
- Q1 consolidated revenue: EUR 127.4M (Apr 18) vs. EUR 125.8M (Jul 21 restated comparatives)

**Ambiguity (hedging, ranges, judgment areas):**

- EY gross margin range: 39-41% (Q1) and 41-43% (Q2) -- approximately EUR 3-4M in genuinely ambiguous cost classification
- Gamma revenue recognition: EUR 1.2M (management estimate of methodology impact) vs. EUR 1.6-2.8M (EY range)
- Beta unsigned change orders: EUR 1.9M recognized under IFRS 15 judgment (subsequently validated)
- Nordstern provision: EUR 0 -> EUR 1.2M -> EUR 0.6M (evolving probability assessment)
- Gamma Digital capital injection: equity (subsidiary) vs. inter-company loan (group)

## What this tests

### Dual temporality (valid time + transaction time)

1. **Temporal supersession**: Document 5 (Alpha restated, tx May 22) should supersede document 2 (Alpha original, tx Apr 14) for the same valid period (Q1 2025). The system should correctly set `superseded_at` on the original nodes.
2. **Cross-period comparison**: Document 6 references both Q2 (new valid time) and Q1 (restated comparatives with a different valid-time anchor). The system must handle facts with different valid-time windows coexisting.
3. **Contradiction scoping by valid time**: A Q1 revenue figure should only contradict another Q1 figure if their valid-time windows overlap, not a Q2 figure.
4. **Staleness**: The original Q1 consolidated summary (Apr 18) becomes stale evidence once the restated figures arrive. Gate B (evidence freshness) should detect this.

### Ambiguity and partial contradiction

5. **Range-based claims**: EY reports margins as ranges (39-41%), not point estimates. The system must handle overlapping ranges without flagging false contradictions.
6. **Methodology-dependent figures**: Gamma's revenue differs depending on accounting policy, not on factual disagreement. The system should distinguish methodological from factual contradictions.
7. **Progressive resolution**: Document 8 (management response) partially resolves some contradictions while introducing new forward-looking uncertainty.

### Convergence dynamics

8. **Non-monotonic trajectory**: V(t) should rise as contradictions accumulate (rounds 2-4), partially stabilize on restatement (round 5), potentially rise again on auditor observations (round 7), and begin resolving on management response (round 8).
9. **Gate behavior**: Gate C (oscillation) may trigger if the V(t) trajectory oscillates between contradiction arrival and resolution. Gate B should activate on stale original figures.

## Running

```bash
# Full experiment (resets DB, starts hatchery, drives 8 docs, collects)
bash scripts/run-experiment.sh financial --rounds=8

# With custom interval and resolution injection
bash scripts/run-experiment.sh financial --rounds=8 --interval=30 --resolve-at=7,8

# Multiple runs for consistency
bash scripts/run-experiment-batch.sh financial 3 --rounds=8
```

## Expected outcome

- **Rounds 1-4**: V(t) rises as subsidiary reports introduce conflicting figures. Multiple contradiction edges created. Finality state: BLOCKED or IN_PROGRESS.
- **Round 5**: Alpha restatement supersedes original figures (transaction-time update). Some contradiction edges may be resolved by the supersession. V(t) should decrease or plateau.
- **Round 6**: Q2 data arrives with restated Q1 comparatives. New valid-time window (Q2) introduces fresh facts. V(t) behavior depends on whether the system correctly scopes contradictions by valid time.
- **Rounds 7-8**: Auditor and management response. Further resolution and new ambiguity. Final finality state should be ESCALATED (due to unresolved classification issues like equity vs. loan) or RESOLVED if enough contradictions are closed.

The experiment should produce characteristic V(t) trajectories that differ qualitatively from both the clean M&A demo (few contradictions, clean resolution) and the noisy corpus (ambiguity without temporal structure).

## Results

Results in `docs/experiments/financial/results/<timestamp>/`. Key files:
- `convergence_history.json` -- V(t), alpha(t), gate states per epoch
- `decision_records.json` -- governance paths and verdicts
- `scope_finality_decisions.json` -- finality lifecycle
- `metadata.json` -- run parameters
