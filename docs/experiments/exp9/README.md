# Experiment 9: Local Confluence

**Assumption #2**: Local confluence. The connection to rewriting theory invokes
Newman's Lemma, which requires local confluence as a precondition. Local
confluence --- that any two admissible transitions from the same state produce
joinable results --- is neither proven nor tested.

## Root Cause

The paper (Section 8.7) explicitly acknowledges:

> "The system provides kernel determinism (each proposal evaluation is
> deterministic) but not commutativity of independent transitions. The claimed
> 'partial confluence' is a weaker property: only transitions certified
> compatible by the kernel are guaranteed to commute."

The CRDT-inspired semantic graph uses three monotonic invariants:
1. **Confidence ratchet**: `WHERE confidence <= $2` (only upward updates)
2. **Irreversible contradiction resolution**: once a `resolves` edge exists, cannot re-open
3. **Staling-not-deletion**: stale nodes marked `irrelevant`, never deleted

These invariants make individual operations commutative (max, set-once, append-only).
But the `syncFactsToSemanticGraph` function also performs **stale marking** ---
marking nodes NOT in the current extraction as `irrelevant`. This operation
depends on the current payload content, making **sequential syncs from different
payloads non-commutative**.

## Experiment Design

Six sub-tests validate confluence at different layers:

| Sub-test | Layer | Property | Expected |
|----------|-------|----------|----------|
| 1. CRDT commutativity | Semantic graph | Apply 4 payloads in all 24 permutations | Partial: stale marking causes divergence |
| 2. Eventual consistency | Semantic graph | Apply final canonical payload after different orderings | All converge to identical state |
| 3. Confidence ratchet | CRDT monotonic | (0.7→0.92) vs (0.92→0.7) | Both reach 0.92 |
| 4. Idempotency | CRDT | Same payload twice | Graph unchanged |
| 5. Kernel determinism | Governance | Same inputs × 10 evaluations | Identical outputs |
| 6. Cross-epoch convergence | End-to-end | Interleaved partial → complete | Converges |

### No LLM/Docker required

This experiment uses only Postgres and the Rust kernel. Synthetic M&A due
diligence payloads simulate what the LLM would extract, allowing deterministic
testing of the mathematical confluence property.

## Running

```bash
bash scripts/run-experiment.sh exp9
```

Runs ~2 minutes (24 permutations + sub-tests, all database operations).

## Results

**Assumption #2 PARTIALLY VALIDATED**: The system exhibits partial confluence ---
core CRDT operations are fully commutative, but stale marking introduces
order-dependence that is resolved by complete re-extraction.

### Per-sub-test summary

| Sub-test | Result | Detail |
|----------|--------|--------|
| Ratchet commutativity | PASS | Both orderings reach confidence 0.92 |
| Idempotency | PASS | Second sync: 0 created, 3 updated (same values), 0 staled |
| CRDT commutativity (24 perms) | PARTIAL | 6/24 confluent, 18/24 divergent (stale marking) |
| Eventual consistency | PASS | All 5 orderings converge after canonical re-extraction |
| Kernel determinism | PASS | 8 proposal types × 10 runs = identical outputs |
| Cross-epoch convergence | PASS | 3 interleaving strategies converge |

### Max divergence (stale marking)

The 18 divergent permutations show differences caused by stale marking:
- `claims_active_min_confidence`: 0.78 to 0.90 (delta=0.12)
- `claims_active_count`: 3 to 4 (delta=1)
- `claims_active_avg_confidence`: 0.81 to 0.90 (delta=0.09)
- `contradictions_unresolved_count`: 0 to 2 (delta=2)
- `contradiction_mass`: 0 to 2 (delta=2)

These differences disappear after a complete re-extraction (sub-test 2).

### Governance kernel decision profile

| Mode | Drift | Transition | Verdict | Reason |
|------|-------|------------|---------|--------|
| YOLO | none | CI→FE | accept | policy_passed |
| YOLO | high | DC→CI | accept | yolo_override |
| YOLO | critical | DC→CI | accept | yolo_override |
| MITL | none | CI→FE | escalate | mitl_required |
| MASTER | none | CI→FE | accept | policy_passed |
| MASTER | high | DC→CI | reject | drift blocks |
| MASTER | medium | FE→DC | accept | policy_passed |
| YOLO | low | FE→DC | accept | policy_passed |

All 8 proposals × 10 evaluations = 80 total evaluations, all deterministic.

### Key observations

1. **Confidence ratchet is commutative by construction**
   - `UPDATE ... WHERE confidence <= $2` implements max(current, new)
   - max(a, b) = max(b, a) --- commutative
   - max(a, max(b, c)) = max(max(a, b), c) --- associative
   - max(a, a) = a --- idempotent
   - This is a classic state-based CRDT (G-Counter for confidence)

2. **Contradiction resolution is commutative**
   - Once a `resolves` edge exists, `hasResolvingEdge()` returns true
   - New contradictions matching resolved pairs are skipped
   - This is a set-once operation --- commutative and irreversible

3. **Stale marking breaks commutativity (expected)**
   - Payload A = {X, Y}, Payload B = {Y, Z}
   - Apply A→B: final = {Y, Z active; X stale}
   - Apply B→A: final = {X, Y active; Z stale}
   - Different final states! Stale marking is last-writer-wins, not commutative
   - **BUT**: after complete re-extraction (all claims), state converges

4. **Governance kernel is fully deterministic**
   - Pure function: same input state → same decision
   - No randomness, no side effects, no state between calls
   - Implemented in Rust with deterministic lattice comparison
   - 8 proposal types × 10 evaluations each = all identical

5. **Eventual consistency through re-extraction**
   - The facts-worker re-extracts from ALL source documents each cycle
   - Each complete extraction overrides stale marking from prior partials
   - This structural property makes the system eventually consistent
   - Same unintended defense identified in Exp 8 (Byzantine resilience)

### Confluence classification

| Operation | Commutative | Idempotent | Note |
|-----------|-------------|------------|------|
| Confidence upsert | Yes | Yes | max semantics (G-Counter CRDT) |
| Contradiction resolution | Yes | Yes | Set-once, irreversible |
| Node insertion | Yes | Yes | Content-matched upsert |
| Goal/risk upsert | Yes | Yes | Content-matched |
| Stale marking (claims) | **No** | Yes | Last-writer-wins on payload content (goals/risks protected) |
| Governance kernel | Yes | Yes | Pure deterministic function |

## Success Criteria

- [x] Confidence ratchet: commutative (max semantics)
- [x] Idempotency: applying same payload twice produces identical graph
- [x] Eventual consistency: all orderings converge after complete re-extraction
- [x] Governance kernel: fully deterministic (same input → same output)
- [x] Cross-epoch: interleaved partial extractions converge
- [x] Stale marking: identified as source of non-commutativity (expected)
- [x] Demonstrates WHY partial confluence is the correct characterization

## Implications

### Partial confluence IS the correct characterization
- Full confluence (Church-Rosser) would require all operations to commute
- Stale marking is structurally non-commutative (it depends on payload content)
- This is by design: the system needs to mark outdated claims as irrelevant
- Full confluence is "unrealistic in governed multi-agent systems" (paper Section 8.7)

### The system is eventually consistent
- Despite non-commutative stale marking, complete re-extraction guarantees convergence
- This is a stronger property than partial confluence alone
- Combined with Exp 8's finding (cycle-based re-extraction as Byzantine defense),
  the system has practical convergence guarantees beyond what the theory proves

### Goal-aware stale protection (applied fix)
- Exp 9 identified that stale marking of goal nodes caused goal_completion
  to be permanently stuck at 0.00 across all experiments
- **Fix:** Goals and risks are now protected from stale marking in
  `syncFactsToSemanticGraph` -- they are accumulative across documents
  (a goal from doc 1 remains valid when doc 2 is extracted)
- Stale marking still applies to claims and contradictions (last-writer-wins)
- This narrows the non-commutativity surface: stale marking only affects
  claims and contradictions, not the goal_completion dimension

### Recommendations for the paper
1. Formalize the "eventual consistency via complete re-extraction" property
2. Distinguish between operation-level confluence (CRDT operations) and
   system-level confluence (stale marking + re-extraction)
3. Note that the governance kernel is a pure deterministic function ---
   this is stronger than "partial confluence" at the kernel level
4. Propose stale marking as a "last-writer-wins register" CRDT variant

## Key Files

- `scripts/drive-exp9-confluence.ts` --- Self-contained confluence test driver
- `src/factsToSemanticGraph.ts` --- CRDT-inspired monotonic upsert strategy
- `src/semanticGraph.ts` --- `updateNodeConfidence` (line 774: `WHERE confidence <= $2`)
- `src/sgrsAdapter.ts` --- Rust kernel bridge (`evaluateKernel`)
- `governance.yaml` --- Unified governance policy
