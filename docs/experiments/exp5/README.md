# Experiment 5: Coverage-Autonomy Trade-off

**Goal:** Empirically map the coverage-autonomy trade-off identified by SECP, using governance modes as the control variable.

## Protocol

Run the identical M&A document corpus through 3 governance modes:
- **YOLO** (autonomous): all decisions made automatically
- **MITL** (human-in-the-loop): proposals require approval (simulated by simulate-mitl)
- **MASTER** (regulatory override): immutable invariants, deterministic approval

The experiment runner automatically resets the DB between modes and collects results separately.

**Independent variable:** Governance mode (YOLO, MITL, MASTER)

**Dependent variables:** Claims accepted, contradictions resolved autonomously, human escalations, convergence rate alpha, time to finality.

## Run

```bash
# Runs all 3 modes automatically (3 sequential runs with DB reset)
bash scripts/run-experiment.sh exp5 --rounds=7 --resolve-at=5
```

## Recording

Three result sets in `docs/experiments/exp5/results/` (one per mode). Compare:

- `decision_records.json` -- decision count and governance_path distribution per mode
- `convergence_history.json` -- alpha (convergence rate) should differ per mode
- `scope_finality_decisions.json` -- finality outcomes

## Expected results

- **YOLO:** Highest claim acceptance rate. Fastest convergence (alpha highest). Lowest human escalation (0). Analogous to SECP's scalar aggregation.
- **MITL:** Intermediate. Some proposals queued for approval (simulate-mitl auto-approves with 5s delay). Alpha lower than YOLO due to approval latency. Analogous to SECP's non-scalar coordination.
- **MASTER:** Lowest acceptance rate. Deterministic decisions only. Alpha lowest (no LLM-driven resolution). Analogous to SECP's Phase 1 veto.

The convergence rate alpha should differ characteristically across modes, providing a formal metric for the coverage-autonomy trade-off.

## Replication

3 sequential runs, ~3 minutes each. Total ~10 minutes.
