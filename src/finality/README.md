# Finality domain modules

Evaluator, certificates, decisions, HITL review requests, and business finalization report.

Legacy paths (`src/finalityEvaluator.ts`, …) remain thin re-export barrels.

| Module | Role |
|--------|------|
| `evaluator.ts` | Config, scoring, `evaluateFinality`, snapshots |
| `certificates.ts` | JWS finality certificates |
| `decisions.ts` | Persist / load finality decisions |
| `hitlRequest.ts` | Queue human finality reviews |
| `report.ts` | Business-facing finalization narrative |
