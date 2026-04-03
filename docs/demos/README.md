# Demos and use cases

Domain scenarios used to demonstrate swarm behaviour. These are **not** assertion-validation experiments; for formal experiment protocols, see [docs/experiments.md](../experiments.md).

| Demo | Corpus | Run command |
|------|--------|-------------|
| [M&A (Project Horizon)](ma/README.md) | `demo/scenario/docs/` | Demo UI: `pnpm run demo` (select M&A) or `./scripts/run-experiment.sh demo-baseline` |
| [Financial consolidation](financial/README.md) | `demo/scenario/docs-financial/` | Demo UI: `pnpm run demo` (select Financial) or `./scripts/run-experiment.sh financial --rounds=8` |
| [Insurance onboarding and pricing](insurance/README.md) | Programmatic (22 docs) | Demo UI: `pnpm run demo` (select Insurance) or `./scripts/run-experiment.sh insurance --rounds=22` |
| [European Green Bond Standard (EUGBS)](green-bond/README.md) | `demo/scenario/docs-green-bond/` (38 docs) | Demo UI: `pnpm run demo` (select Green Bond) or `./scripts/run-experiment.sh green-bond --rounds=38` |

All four demos are available in the demo UI at `pnpm run demo`. Grafana (port 3004) shows convergence, propagation, and progress metrics during demo runs.

## Strict scope/session requirement

Demo surfaces use server-minted sessions and strict scope routing. To avoid cross-demo state contamination:

- Always start from the demo UI scenario picker (it creates a fresh session).
- For shell walkthroughs, set `DEMO_SCOPE_ID` explicitly.
- Feed/MITL demo paths reject missing scope with `scope_required`.

See [../archive/demo.md](../archive/demo.md) for the archived Project Horizon overview. For financial vs M&A consistency check, see [COMPARISON-financial-vs-ma.md](COMPARISON-financial-vs-ma.md).
