# Demo and experiment corpora

Document sets under `demo/scenario/`. Each folder is a corpus of `.txt` files injected into a scope for demos, experiments, or forthcoming benchmark manifests.

| Corpus | Docs | Status | Wired by |
|--------|-----:|--------|----------|
| `docs/` | 7 | Active demo (M&A / Project Horizon) | `demo/demo-server.ts`, `run-experiment.sh` |
| `docs-financial/` | 8 | Active demo | `demo-server.ts`, `studioCorpora.ts`, `drive-experiment.ts` |
| `docs-green-bond/` | 38 | Active demo | `demo-server.ts`, `studioCorpora.ts`, `drive-experiment.ts` |
| `docs-basic-example/` | 2 | Active seed / Studio | `seed-basic-example.ts`, `studioCorpora.ts` |
| `docs-noisy/` | 5 | Experiment | `drive-experiment.ts`, `run-experiment.sh` |
| `docs-exp6/` | 7 | Experiment / adversarial | `drive-experiment.ts`, `drive-exp8-adversarial.ts` |
| `docs-tier3/` | 6 | Experiment | `drive-experiment.ts` |
| `docs-clinical-trial/` | 18 | Benchmark **s3** | [`docs/benchmarks/manifests/s3-clinical-trial.yaml`](../../docs/benchmarks/manifests/s3-clinical-trial.yaml) |
| `docs-solvency2/` | 15 | Benchmark **s2** | [`docs/benchmarks/manifests/s2-solvency2.yaml`](../../docs/benchmarks/manifests/s2-solvency2.yaml) |
| `docs-aml-kyc/` | 15 | Benchmark **s4** | [`docs/benchmarks/manifests/s4-aml-kyc.yaml`](../../docs/benchmarks/manifests/s4-aml-kyc.yaml) |
| `docs-energy-grid/` | 15 | Benchmark **s5** | [`docs/benchmarks/manifests/s5-energy-grid.yaml`](../../docs/benchmarks/manifests/s5-energy-grid.yaml) |
| `docs-ma-extended/` | 25 | Prepared, **not yet wired** | Extended M&A corpus; no driver/manifest |

## Rules

- Do not delete unwired corpora without confirming they are not needed for publication or upcoming manifests (`src/baselines/manifest/registry.ts` already keys `s1`–`s5`).
- Prefer adding a short README or YAML manifest per corpus before wiring a new driver.
- Default WAL seed documents live in repo-root [`seed-docs/`](../../seed-docs/), not here.
