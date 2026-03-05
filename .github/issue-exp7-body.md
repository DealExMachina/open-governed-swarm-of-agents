## Goal

Validate **Assumption #4 (Tier 2/3 governance routing)** — that the multi-tier architecture (Tier 1 deterministic, Tier 2 MITL, Tier 3 LLM) is exercised and observable. Paper Section 8.7: "Tier 2/3 governance routing (partially validated)."

## Protocol

- Run exp7 (3 sub-runs: YOLO, MITL, MASTER) on exp6 corpus with unified governance (block_when: [high, critical]).
- Measure: decision distribution by tier (Tier 1/2/3), escalation frequency, MASTER rejection rate.
- Analysis: `scripts/analyze-tier-coverage.ts`

## Latest results (documented in exp7 README)

- **Assumption #4 VALIDATED** (per docs/experiments/exp7/README.md): Tier 1 and Tier 2 exercised; MASTER rejects on policy block; MITL escalates. Tier 3 (oversight LLM choosing escalateToLLM) was not triggered — oversight consistently accepted deterministic result.

## Outstanding

- [ ] **Tier-3 reachability:** No experiment has yet triggered Tier 3 (full LLM governance path). Paper and [#18](https://github.com/DealExMachina/swarm-of-governed-agents/issues/18) call out **E2 Tier-3 reachability** — construct a workload (e.g. deterministic-vs-LLM disagreement corpus) that forces the oversight agent to choose `escalateToLLM`, and document reproducible trace.
- [ ] Optional: re-run exp7 in full suite (e.g. 2026-03-04 batch) and attach result summary to this issue for traceability.

## References

- Paper Section 8.7 (Assumption 4), Section 9.
- `docs/experiments/exp7/README.md`
- Formal hardening E2: [#18](https://github.com/DealExMachina/swarm-of-governed-agents/issues/18)
