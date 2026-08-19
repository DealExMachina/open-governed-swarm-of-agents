# Demo and experiment corpora

Document sets under `demo/scenario/`. Each folder is a corpus of `.txt` files injected into a scope for demos, experiments, or benchmark manifests (S1–S5 YAML under [`docs/benchmarks/manifests/`](../../docs/benchmarks/manifests/)).

| Corpus | Docs | Status | Wired by |
|--------|-----:|--------|----------|
| `docs/` | 7 | Active demo (M&A / Project Horizon) | `demo/demo-server.ts`, `run-experiment.sh` |
| `docs-financial/` | 8 | Active demo | `demo-server.ts`, `studioCorpora.ts`, `drive-experiment.ts` |
| `docs-green-bond/` | 38 | Active demo | `demo-server.ts`, `studioCorpora.ts`, `drive-experiment.ts` |
| `docs-basic-example/` | 2 | Active seed / Studio | `seed-basic-example.ts`, `studioCorpora.ts` |
| `docs-noisy/` | 5 | Experiment | `drive-experiment.ts`, `run-experiment.sh` |
| `docs-exp6/` | 7 | Experiment / adversarial | `drive-experiment.ts`, `drive-exp8-adversarial.ts` |
| `docs-tier3/` | 6 | Experiment | `drive-experiment.ts` |
| `docs-clinical-trial/` | 18 | Benchmark **s3** | Manifest + `run-experiment.sh s3` + Studio `s3` |
| `docs-solvency2/` | 15 | Benchmark **s2** | Manifest + `run-experiment.sh s2` + Studio `s2` |
| `docs-aml-kyc/` | 15 | Benchmark **s4** | Manifest + `run-experiment.sh s4` + Studio `s4` |
| `docs-energy-grid/` | 15 | Benchmark **s5** | Manifest + `run-experiment.sh s5` + Studio `s5` |

**Archived (not live):** [`docs/archive/scenario/docs-ma-extended/`](../../docs/archive/scenario/docs-ma-extended/) — 25-doc extended Horizon set; no driver/manifest. Do not wire without an explicit demo/manifest ticket.

Benchmark document lists come from [`docs/benchmarks/manifests/`](../../docs/benchmarks/README.md) (S1 uses a 5-doc package over `docs/`, not the full directory). Demo UI scenarios remain separate (M&A / financial / insurance / green-bond).

## Rules

- Do not delete archived or benchmark corpora without confirming publication / manifest needs (`src/baselines/manifest/registry.ts` keys `s1`–`s5`).
- Prefer adding a short README or YAML manifest per corpus before wiring a new driver.
- Default WAL seed documents live in repo-root [`seed-docs/`](../../seed-docs/), not here.
