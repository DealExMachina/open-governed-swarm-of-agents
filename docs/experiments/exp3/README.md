# Experiment 3: Finality Robustness

**Goal:** Demonstrate that the 5-gate mechanism prevents false finality under adversarial evidence patterns.

## Protocol

The driver injects adversarial document sequences designed to trigger premature finality:

- **spike-and-drop:** Two high-confidence documents followed by two contradicting documents. Tests Gate A (monotonicity) and Gate C (trajectory quality).
- **oscillating:** Alternating pro/con documents. Tests Gate C (autocorrelation detection) and Gate A (monotonicity violations).
- **stale:** Old documents followed by a fresh contradiction. Tests Gate B (evidence freshness via max_age_days).

**Dependent variables:** False finality rate (RESOLVED despite unresolved contradictions), gate trigger frequency, ESCALATED rate, trajectory quality score.

## Run

```bash
# Spike-and-drop (default)
bash scripts/run-experiment.sh exp3 --pattern=spike-and-drop --rounds=4

# Oscillating
bash scripts/run-experiment.sh exp3 --pattern=oscillating --rounds=5

# Stale evidence
bash scripts/run-experiment.sh exp3 --pattern=stale --rounds=3
```

## Recording

- `convergence_history.json` -- gate columns show which gates blocked finality:
  - `gate_a_monotonic`: should be False after spike-drop and oscillating patterns
  - `gate_b_evidence`: should be False for stale evidence
  - `gate_c_trajectory_ok`: should be False for oscillating pattern (trajectory_quality < 0.7)
- `finality_state` column: expect ESCALATED or HITL, never RESOLVED when contradictions remain

## Expected results

- **Spike-and-drop:** Score rises to ~0.9 then drops to ~0.5. Gate A blocks (monotonicity violated). Gate C blocks if trajectory_quality < 0.7. System should ESCALATE, not RESOLVE.
- **Oscillating:** Score alternates between ~0.7 and ~0.5. Gate A false (non-monotonic). Gate C false (high autocorrelation). System should never RESOLVE.
- **Stale:** Gate B should detect expired evidence if evidence_schemas.yaml has max_age_days configured.

## Replication

3 pattern runs. Each ~2 minutes. Total ~6 minutes.
