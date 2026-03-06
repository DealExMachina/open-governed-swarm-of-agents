# Demos and use cases

Domain scenarios used to demonstrate swarm behaviour. These are **not** assertion-validation experiments; for formal experiments (exp1–exp9) and assumption validation, see [docs/experiments/](../experiments/README.md) and [docs/formal-hardening.md](../formal-hardening.md).

| Demo | Corpus | Run command |
|------|--------|-------------|
| [M&A (Project Horizon)](ma/README.md) | `demo/scenario/docs/` | `./scripts/run-experiment.sh demo-baseline` or demo UI: `pnpm run demo` |
| [Financial consolidation](financial/README.md) | `demo/scenario/docs-financial/` | `./scripts/run-experiment.sh financial --rounds=8` |
| [Insurance onboarding and pricing](insurance/README.md) | Programmatic (drive-experiment.ts) | `./scripts/run-experiment.sh insurance --rounds=22` |

See [../demo.md](../demo.md) for the Project Horizon walkthrough. For financial vs M&A consistency check, see [COMPARISON-financial-vs-ma.md](COMPARISON-financial-vs-ma.md).
