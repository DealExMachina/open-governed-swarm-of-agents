# Insurance onboarding and quote corpus

**Goal:** Demo corpus long enough for 20+ convergence cycles. Agents check that onboarding conditions are met and take a verifiable decision to onboard at a given price.

## Scenario

Simplified property and contents insurance: one applicant, one product. Flow:

1. **Application** — Product, sum insured, applicant details.
2. **Verification** — Identity and address (conditions 1–2).
3. **Risk and property** — Questionnaire, property details, claims history (condition 3).
4. **Underwriting rules** — Five onboarding conditions; conditions 4–5 depend on sum insured and no misrepresentation.
5. **Condition 4 pending** — Sum insured must be supported by valuation; request additional information.
6. **Supplemental docs** — Construction certificate, security system (valuation reveals a discrepancy).
7. **Contradiction** — Stated sum insured 200k vs valuation 185k.
8. **Resolution** — Underwriter exception: accept 185k; discrepancy resolved.
9. **Final check and pricing** — All conditions met; pricing engine outputs premium (455 EUR).
10. **Quote and decision** — Binding quote; verifiable onboarding decision at stated price.

## Corpus

22 documents, built in `scripts/drive-experiment.ts` (`buildInsuranceCorpus()`). Not file-based; no `demo/scenario/docs-insurance/` folder.

| #  | Title / theme |
|----|----------------|
| 01 | Product and application |
| 02 | Applicant identity |
| 03 | Risk questionnaire |
| 04 | Property details |
| 05 | Sum insured and options |
| 06 | Claims history declaration |
| 07 | Underwriting eligibility rules |
| 08 | ID verification result |
| 09 | Address verification result |
| 10 | Underwriting check conditions 1–3 |
| 11 | Condition 4 pending (valuation) |
| 12 | Request additional information |
| 13 | Supplemental construction / valuation |
| 14 | Supplemental security |
| 15 | Contradiction: stated value vs valuation |
| 16 | Underwriter exception note |
| 17 | Resolution of value discrepancy |
| 18 | Final conditions check |
| 19 | Pricing engine output |
| 20 | Quote summary |
| 21 | Compliance and audit trail |
| 22 | Onboarding decision |

## Run

```bash
# Default: 22 rounds, resolution at 17, 18, 19 (aligns with discrepancy resolution in story)
bash scripts/run-experiment.sh insurance

# Custom rounds (driver is uncapped: rounds can exceed corpus length, docs cycle)
bash scripts/run-experiment.sh insurance --rounds=25
```

Results: `docs/experiments/insurance/results/<timestamp>/`.

## Driver uncap

The experiment driver no longer caps rounds at corpus length. So you can run e.g. `--rounds=20` with a 7-doc corpus; documents are taken from `corpus[i % corpus.length]`. The insurance corpus has 22 docs, so one pass gives 22 distinct documents and 22 convergence cycles.
