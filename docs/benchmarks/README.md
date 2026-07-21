# Benchmark scenarios (PRD v0.2)

Manifests under [`manifests/`](manifests/) are the single source of truth for comparative benchmark runners (`pnpm run benchmark:smoke-llm`, `scripts/benchmarks/benchmark-comparative.ts`).

| Key | Manifest | Corpus | Notes |
|-----|----------|--------|-------|
| `s1` | [`s1-project-horizon.yaml`](manifests/s1-project-horizon.yaml) | `demo/scenario/docs/` | Uses `builtinRef: s1-project-horizon` (claims live in `src/baselines/manifest/builtin-s1.ts`) |
| `s2` | [`s2-solvency2.yaml`](manifests/s2-solvency2.yaml) | `demo/scenario/docs-solvency2/` | Solvency II SCR / look-through / remediation |
| `s3` | [`s3-clinical-trial.yaml`](manifests/s3-clinical-trial.yaml) | `demo/scenario/docs-clinical-trial/` | Oncology trial safety + protocol drift |
| `s4` | [`s4-aml-kyc.yaml`](manifests/s4-aml-kyc.yaml) | `demo/scenario/docs-aml-kyc/` | AML/KYC Castellan Holdings |
| `s5` | [`s5-energy-grid.yaml`](manifests/s5-energy-grid.yaml) | `demo/scenario/docs-energy-grid/` | NERC CIP / Winter Storm Helios |

Registry: `src/baselines/manifest/registry.ts`.

## Validate

```bash
pnpm run check:benchmark-manifests
```

Loads each registered YAML, merges builtins when `builtinRef` is set, and asserts every `documents[].path` exists under `docsRootRelative`.

## Schema (manifestVersion: "1")

Required without `builtinRef`:

- `id`, `prdScenario`, `version`, `docsRootRelative`
- `documents[]` — `id`, `epoch`, `title`, `path`, `expectedClaims`, `contradictions`
- `groundTruth` — includes `expectedValuation.{min,max}` (for non-M&A scenarios this is the **primary numeric outcome band**, e.g. SCR ratio %, risk score, WCI %)
- `agentRoles[]`, `roleDimensionMap`

Optional: `evaluation.epochRegulationVersion`, `evaluation.c4ExpectedPreservedFacts`.

## Run a scenario

```bash
# Comparative / LLM smoke (benchmark harness)
pnpm exec tsx scripts/benchmarks/benchmark-comparative.ts --preset=smoke --scenario=s2
pnpm run benchmark:smoke-llm:all   # s1–s5 smoke-llm

# Full swarm experiment driver (inject via hatchery pipeline)
./scripts/experiments/run-experiment.sh s2
pnpm exec tsx scripts/experiments/drive-experiment.ts --corpus=s3
```

Studio can load the same packages via corpus ids `s1`–`s5` (`src/studioCorpora.ts`).
