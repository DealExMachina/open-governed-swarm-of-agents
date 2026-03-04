# Experiment 8: Adversarial Agent Defense

**Assumption #5**: All formal guarantees (monotonic convergence, finality gates,
governance routing) assume cooperative agents. No Byzantine, adversarial, or
colluding agents are modeled.

## Root Cause

The paper (Section 8.7) explicitly acknowledges:

> "The monotonic confidence ratchet provides partial robustness against downward
> manipulation, but no defense exists against upward inflation — an adversarial
> agent that inflates confidence scores can drive V(t) toward 0 without genuine
> resolution."

The three CRDT invariants (confidence ratchet, irreversible contradictions,
staling-not-deletion) defend against **downward** manipulation but are powerless
against **upward** inflation by a compromised agent.

## Attack Model

Two adversarial scenarios are tested:

### Single adversarial agent (`inflate`)
A compromised facts agent that, after each cycle:
1. Inflates all claim confidences to 0.99 (ratchet allows upward updates)
2. Creates fake "resolves" edges on contradiction pairs
3. Marks contradiction nodes as resolved
4. Marks active goals as resolved
5. Neutralizes critical risks (changes severity to "low")

The drift agent remains **honest** — it should detect the manipulation because
document text still contains contradicting information.

### Coordinated adversarial agents (`collude`)
Both facts AND drift agents are compromised:
- Same mutations as `inflate` mode
- Additionally overwrites `drift/latest.json` in S3 to `{ "level": "none" }`

This simulates a Byzantine scenario where two agents collude to suppress
contradiction detection.

## Experiment Design

Uses the exp6 corpus (7 M&A due diligence documents with genuine contradictions)
with YOLO governance (most permissive, giving the adversary the best chance).

Runs 3 sub-experiments:

| Sub-run | Adversarial | Expected Outcome |
|---------|------------|-----------------|
| exp8-baseline | None | HITL (contradictions remain unresolved) |
| exp8-inflate | Facts agent only | HITL (drift agent detects, governance blocks) |
| exp8-collude | Facts + drift | Ephemeral false finality, then HITL (cycle-based re-extraction flushes mutations) |

### Defense Mechanisms Tested

| Defense | vs inflate | vs collude |
|---------|-----------|-----------|
| Confidence ratchet (CRDT) | Allows upward | Allows upward |
| Drift detection (drift agent) | **Catches** (5.3x more blocks) | Compromised |
| Governance kernel (transition rules) | **Blocks** on high drift | No drift reported |
| Gate A (monotonicity) | V(t) decreasing = passes | Catches after mutation flush |
| Gate B (evidence coverage) | Some blocks (88% pass) | Lower pass rate (61%) |
| Gate C (trajectory quality) | **Catches** (false at epoch 5) | Passes (smooth trajectory) |
| Cycle-based re-extraction | **Flushes** mutations in 1-2 cycles | **Flushes** mutations in 1-2 cycles |

## Running

```bash
bash scripts/run-experiment.sh exp8
```

Runs ~25 minutes (3 x 7 rounds x ~20s intervals, with extra trigger docs).

## Analysis

```bash
pnpm tsx scripts/analyze-adversarial-defense.ts docs/experiments/exp8/results/
```

## Results

**Assumption #5 PARTIALLY VALIDATED**: The cooperative model assumption provides
formal guarantees, but the system has unexpected defense-in-depth through
cycle-based re-extraction that limits adversarial impact to ephemeral windows.

### Per-mode summary

| Metric | Baseline | Inflate | Collude |
|--------|----------|---------|---------|
| Final V(t) | 0.25 | 0.55 | 0.55 |
| Final goal score | 0.75 | 0.45 | 0.45 |
| Epochs | 15 | 14 | 32 |
| Governance decisions | 20 | 34 | 44 |
| YOLO overrides | 3 (15%) | 16 (47%) | 7 (16%) |
| False RESOLVED epochs | 0 | 1 | 2 |
| Final state | HITL | HITL | HITL |

### Key observations

1. **Inflate mode: drift agent catches manipulation (5.3x more overrides)**
   - 16 YOLO overrides vs 3 in baseline (47% vs 15% of decisions)
   - Drift agent detects contradictions in source text despite graph mutations
   - Gate C (trajectory quality) caught the post-inflation inconsistency at epoch 5
   - Adversarial mutations are ephemeral: flushed by next facts extraction cycle

2. **Collude mode: ephemeral false finality, NOT permanent**
   - Achieved false RESOLVED for 2 epochs (goal_completion=1.0, V(t)=0.0)
   - Facts-worker re-extraction overwrote mutations within 1-2 cycles
   - System recovered to HITL after epoch 5
   - 9 monotonicity violations (vs 2 baseline) show adversarial instability
   - More total epochs (32 vs 14) show prolonged instability

3. **Cycle-based re-extraction acts as unintended Byzantine defense**
   - The facts-worker continuously re-extracts from source documents
   - Each cycle flushes adversarial mutations by rebuilding truth from sources
   - This structural property limits any adversarial impact to 1-2 cycle windows
   - For permanent false finality, the adversary would need to also compromise
     the facts-worker (3-agent collusion), not just drift + graph mutations

4. **Gate profile comparison**

   | Gate | Baseline | Inflate | Collude |
   |------|----------|---------|---------|
   | A (monotonic) | 87% | 76% | 74% |
   | B (evidence) | 77% | 88% | 61% |
   | C (trajectory) | 100% | 97% | 100% |
   | D (quiescence) | 100% | 100% | 100% |
   | E (has content) | 100% | 100% | 100% |
   | All gates pass | 71% | 70% | 49% |

   Collude has the lowest all-gates-pass rate (49%) despite drift suppression,
   because Gate B catches evidence inconsistencies the adversary cannot mask.

### Adversarial mutation volumes

| Mutation | Inflate | Collude |
|----------|---------|---------|
| Claims inflated | 11 | 15 |
| Contradictions faked | 16 | 9 |
| Goals faked | 4 | 28 |
| Risks neutralized | 9 | 5 |
| Drift overwritten | No | Yes (7x) |

## Success Criteria

- [x] Baseline: System stays HITL (contradictions remain unresolved)
- [x] Inflate: Drift agent detects manipulation (5.3x more governance overrides)
- [x] Collude: Brief false RESOLVED window (2 epochs), then self-corrects
- [x] Cycle-based re-extraction provides defense-in-depth
- [x] Gate B catches evidence inconsistencies even when drift is suppressed
- [x] Demonstrates WHY cooperative assumption matters (ephemeral false finality windows)

## Implications

### Cooperative assumption IS structurally important
- Both adversarial modes achieved brief false RESOLVED windows (1-2 epochs)
- Without cooperative agents, formal V(t) monotonicity is violated (9 violations in collude)
- The paper's theoretical guarantees do NOT hold under adversarial conditions

### But the system has unexpected resilience
- Cycle-based re-extraction from source documents provides a structural defense
- This is NOT a formal Byzantine defense but a practical one:
  adversarial mutations are ephemeral because truth is re-established each cycle
- For sustained false finality, an adversary needs to compromise:
  1. Facts extraction (graph mutations)
  2. Drift detection (suppress alerts)
  3. Facts-worker (prevent re-extraction from sources)
- This 3-layer defense exceeds the paper's claimed single-layer (cooperative model)

### Recommendations for the paper
1. Acknowledge cycle-based re-extraction as a practical defense mechanism
2. Propose multi-source facts extraction as formal Byzantine defense
3. Note that Gate B enforcement would strengthen the defense further
4. Define "adversarial window" metric: max consecutive epochs of false finality
5. SECP integration remains necessary for formal Byzantine guarantees

## Key Files

- `scripts/drive-exp8-adversarial.ts` — Adversarial driver with injection modes
- `scripts/analyze-adversarial-defense.ts` — Post-processing analysis
- `demo/scenario/docs-exp6/` — Shared corpus (produces genuine contradictions)
- `governance.yaml` — Unified policy (YOLO mode for maximum permissiveness)
- `finality.yaml` — Finality conditions (RESOLVED thresholds)
