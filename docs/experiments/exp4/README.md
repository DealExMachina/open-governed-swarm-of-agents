# Experiment 4: Multi-Level Governance

**Goal:** Demonstrate governance at multiple levels (L1 Operational, L2 Compliance, L3 Regulatory) with auditable decision distribution.

## Protocol

Inject the full M&A document corpus through the pipeline in YOLO mode (default). The governance agent processes proposals through the oversight path, producing decision records tagged with governance_path and scope_mode.

**Level mapping:**
- L1 (Operational): `governance_path = processProposal` (YOLO/MITL deterministic), `oversight_acceptDeterministic`
- L2 (Compliance): `governance_path = oversight_escalateToHuman`, `processProposalWithAgent`
- L3 (Regulatory): `governance_path = processProposal` when `scope_mode = MASTER`

The simulate-mitl script auto-approves pending proposals and finality reviews.

## Run

```bash
# Default: 7 rounds with resolution at round 5
bash scripts/run-experiment.sh exp4 --rounds=7 --resolve-at=5
```

## Recording

- `decision_records.json` -- each record has `governance_path`, `scope_id`, `scope_mode`
- `context_events_sample.json` -- proposal events with governance_path
- `scope_finality_decisions.json` -- finality decisions (via simulate-mitl finality approval)

## Analysis

Count decision distribution:
```sql
SELECT governance_path, scope_mode, COUNT(*), 
       COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () AS pct
FROM decision_records
GROUP BY governance_path, scope_mode;
```

## Expected results

- Most decisions (>80%) resolved at L1 (`oversight_acceptDeterministic` or `processProposal`)
- L2 decisions appear when the oversight agent escalates (drift-triggered or borderline proposals)
- L3 decisions are rare (only when scope_mode = MASTER)
- Separation of duties traceable through the governance_path audit trail

## Replication

1 run, ~3 minutes. For multi-scope testing, configure `governance.yaml` with scope-specific modes.
