# Insurance onboarding and pricing

> Back to [demos README](../README.md)

**Goal:** Demo corpus long enough for 20+ convergence cycles. Agents check onboarding conditions and take a verifiable decision to onboard at a given price.

## Scenario

Simplified property and contents insurance: one applicant, one product. Flow: application → verification (identity, address) → risk and property → underwriting rules → condition 4 (sum insured) pending → supplemental docs → contradiction (stated vs valuation) → resolution → final check and pricing → quote and onboarding decision.

## Corpus

22 documents, built in `scripts/drive-experiment.ts` (`buildInsuranceCorpus()`). Not file-based.

## Run

```bash
bash scripts/run-experiment.sh insurance
# Custom rounds: --rounds=25
```

Results: `docs/experiments/insurance/results/<timestamp>/`. The driver is uncapped: rounds can exceed corpus length (docs cycle).

## Scope isolation

Run insurance demos in their own session/scope. Demo feed paths now require explicit `scope_id`.
