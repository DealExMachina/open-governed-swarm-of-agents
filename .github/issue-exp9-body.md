## Goal

Validate **Assumption #2 (Local confluence)**. The connection to rewriting theory (Newman's Lemma) requires local confluence. The paper claims "partial confluence": certified compatible transitions commute; full Church–Rosser does not hold due to claim stale marking, but eventual consistency restores canonical state after complete re-extraction.

## Protocol

- Six sub-tests (no LLM/Docker): CRDT commutativity (24 permutations), eventual consistency, confidence ratchet, idempotency, kernel determinism, cross-epoch convergence.
- Uses Postgres + Rust kernel only; synthetic M&A payloads.

## Latest results (documented in exp9 README)

- **Assumption #2 PARTIALLY VALIDATED:** Core CRDT operations (ratchet, contradiction resolution, idempotency) commutative; kernel fully deterministic. Stale marking causes 18/24 permutations to diverge; all orderings converge after canonical re-extraction (eventual consistency).

## Outstanding

- [ ] **Confluence boundary:** Document the exact boundary: which operations commute vs which are order-dependent (stale marking). Optionally extend experiment (E4 in [#18](https://github.com/DealExMachina/swarm-of-governed-agents/issues/18)) — divergence window length, recovery rounds, invariant violations.
- [ ] **Eventual consistency safety:** Paper [#18](https://github.com/DealExMachina/swarm-of-governed-agents/issues/18) PO-3 plans "bounded recovery after complete re-extraction". Exp9 shows convergence; a formal bound (e.g. max rounds to canonical state) would strengthen the claim.
- [ ] Optional: re-run exp9 in CI or batch and attach result summary for traceability.

## References

- Paper Section 8.7 (Assumption 2), Section 9 (Exp. 9).
- `docs/experiments/exp9/README.md`
- Formal hardening E4 & PO-3: [#18](https://github.com/DealExMachina/swarm-of-governed-agents/issues/18)
