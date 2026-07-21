# Cleanup plan and refactor assessment

> Produced by the Cleanup Agent review. Related: [codebase-hygiene.md](codebase-hygiene.md), [architecture.md](architecture.md), [refactor-execution-plan.md](refactor-execution-plan.md).

This document records what was cleaned in the current pass, what remains, how directories are organized, and a phased refactor assessment. Scope is technical (components and invasiveness), not calendar estimates.

---

## Verdict

The repo is a healthy research + product monorepo with clear license/package boundaries. Scripts are taxonomized, S1–S5 manifests exist and drive experiments/Studio, and `feed` / `semantic-graph` are modularized behind thin entries. Remaining payoff is incremental `src/` domain folders, Studio UI split (after `public/`), and secondary hotspots (`governanceAgent`, `finalityEvaluator`, `bridge.rs`).

---

## Cleanup executed (this PR)

| Action | Path | Rationale |
|--------|------|-----------|
| Deleted | `test/.gitkeep` | Directory has real tests; placeholder no longer needed |
| Deleted | `test/.placeholder.ts` | Same; was only keeping ESLint/TS aware of an empty tree |
| Updated | `tsconfig.eslint.json` | Dropped explicit `.placeholder.ts` include |
| Moved | `workers/facts-worker/test_nli.py` → `tests/unit/test_nli.py` | Orphaned at worker root; peers already live under `tests/unit/` |
| Fixed | `agents-swarm-governed.code-workspace` | Removed broken `../agents-swarm-governed` folder entry |
| Added | `migrations/README.md`, `sgrs-core/migrations/README.md` | Clarify parallel migration trees |
| Added | `demo/scenario/README.md` | Corpus wiring status matrix |
| Taxonomized | `scripts/{ops,checks,demo,experiments,benchmarks}/` | Role-based layout; `package.json` + callers updated; see `scripts/README.md` |
| Added | `docs/benchmarks/manifests/s1`–`s5` | Comparative benchmark packages; `pnpm run check:benchmark-manifests` passes |

---

## Cleanup backlog (do not delete without owner confirmation)

### Keep — still live

| Path | Why |
|------|-----|
| `Dockerfile.feed` / `Dockerfile.feed.dist` | Dev bind-mount vs CI/GHCR image — complementary, not duplicates |
| `prototype/studio-preview/**` | Served by `src/feed.ts` at `/studio` |
| `src/observability.html` | Served by feed dashboard |
| `seed-docs/**` | Used by `pnpm run seed:all` and E2E |
| `sgrs-core/verify-build.cjs` | `postbuild` hook |
| `publications/publication_1/**` | Distinct main + arXiv TeX/PDF variants |
| `test/unit/mastra-migration.test.ts` | Guards current `@mastra/core` / AI SDK token shapes |
| `test/unit/accrualPrefilter.test.ts` | Frozen legacy path still optionally enabled |
| Root + `sgrs-core` `019`–`021` SQL | Documented parallel trees |
| `scripts/benchmarks/*`, `scripts/experiments/drive-exp*`, `scripts/experiments/analyze-*` | Research tooling; referenced by experiments docs |

### Soft cleanup candidates

| Item | Recommendation |
|------|----------------|
| `docs/archive/demo.md` | Keep as redirect stub, or delete after updating `docs/demos/*` and hygiene links |
| Empty Python `tests/__init__.py` files | Optional; low value, conventional for some runners |
| Unwired corpora (`docs-ma-extended`) | Extended M&A corpus still without a driver/manifest; keep until publication confirms unused |
| ~~Missing `docs/benchmarks/manifests/*.yaml`~~ | **done** — S1–S5 manifests shipped under [`docs/benchmarks/`](benchmarks/README.md) |
| Missing root `skills/*.md` | Dead data path until skill markdown is added (`src/skills/loader.ts`) |
| `Dockerfile.feed.dist` omits `prototype/` | Dist image cannot serve Studio; either copy assets or document as unsupported |

---

## Subdirectory organization

```
/
├── src/                 # TS orchestration — feed/, semantic-graph/, studio/ extracted; rest still flat
├── sgrs-core/           # Rust kernel + N-API (well modularized internally)
├── packages/            # MIT clients (TS + Python)
├── workers/facts-worker # Python extraction / NLI
├── demo/                # Demo UI server + scenario corpora
├── prototype/           # Misnamed: active Studio static assets
├── scripts/             # Taxonomized: ops / checks / demo / experiments / benchmarks / lib
├── migrations/          # App Postgres
├── seed-docs/           # Default WAL seed (≠ demo corpora)
├── docs/                # Architecture, experiments, demos, hygiene
├── publications/        # Paper assets
└── observability/       # Grafana provisioning
```

### What works

- License split (AGPL orchestration / ELv2 kernel / MIT clients) matches directory boundaries.
- `packages/*` and `workers/` are appropriately separated.
- Vitest layout (`test/unit`, `test/baselines`, `test/fixtures`) is coherent after placeholder removal.
- `sgrs-core/src/{causal,convergence,finality,governance,propagation,types}` is a good modular model for TS to emulate.

### What does not

1. **`src/` is a junk drawer** — feed HTTP, semantic graph SQL, finality, Studio helpers, billing, hatchery, and agents share one flat namespace.
2. ~~**`scripts/` mixes production ops with one-off research**~~ — **done**: files live under `ops/`, `checks/`, `demo/`, `experiments/`, `benchmarks/` (see [`scripts/README.md`](../scripts/README.md)).
3. **`prototype/` naming lies** — Studio is production-served UI, not a disposable sketch.
4. **Scenario corpora lack manifests** — wiring is hardcoded across `demo-server.ts`, `studioCorpora.ts`, and `drive-experiment.ts`.
5. **Static HTML lives beside TS** — `observability.html` in `src/`; Studio under `prototype/`.

### Target layout (incremental)

```
src/
  server/          # feed routes, control plane mount, MITL
  semantic-graph/  # nodes, edges, snapshots, provenance
  finality/        # evaluator, certificates, HITL requests
  studio/          # catalog, corpora, graph edges, progress
  runtime/         # hatchery, swarm, watchdog, event bus
  governance/      # policy, resolution, obligations
  agents/          # (already exists)
scripts/
  ops/ checks/ demo/ experiments/ benchmarks/ lib/   # taxonomized
public/ or assets/
  studio/ observability.html
demo/
  server/ ui/ scenario/corpora/<id>/
```

---

## Refactor assessment

### Hotspots (by size / coupling)

| File | ~Lines | Issue |
|------|-------:|-------|
| `demo/demo-server.ts` | 4300+ | Server + corpora + HTML/CSS/JS monolith |
| `prototype/studio-preview/index.html` | 3100+ | Oversized static document |
| `src/semanticGraph.ts` | barrel | Logic under `src/semantic-graph/` |
| `sgrs-core/src/bridge.rs` | 1600+ | Broad N-API surface |
| `src/feed.ts` | thin entry | Routes under `src/feed/` |
| `src/agents/governanceAgent.ts` | 1300+ | Tools + finality consumer + proposals |
| `src/finalityEvaluator.ts` | 1250+ | Config + gates + certificates + blockers |

### Duplication patterns

- Scenario metadata triplicated (demo server / Studio corpora / experiment drivers).
- HTTP/SSE helpers duplicated between feed and demo server.
- Parallel migration numbering without cross-links (now documented via READMEs).

### Phased refactor (technical scope)

| Phase | Scope | Invasiveness | Risk |
|-------|-------|--------------|------|
| **P0 — Manifests** | ~~Add manifests + wire experiments/Studio~~ **done** (`run-experiment.sh s1`–`s5`, `studioCorpora` ids). Demo UI picker unchanged. | — | — |
| **P1 — Split demo server** | ~~Extract `demo/server/` + `demo/ui/`~~ **done** | — | — |
| **P2 — Static assets** | Move Studio + observability HTML to `public/` — see PR #26 | Medium | Low–medium |
| **P3 — Split feed + graph** | ~~`src/feed/`~~ **done**; ~~`src/semantic-graph/`~~ **done** (barrel `semanticGraph.ts`) | — | — |
| **P4 — Scripts taxonomy** | ~~`scripts/{ops,experiments,...}`~~ **done** | — | — |
| **P5 — Rust test classes** | ~~`exp-harness` feature gates `tests/exp_*.rs`~~ **done**; default `cargo test` = prop/scenarios | — | — |

See also the execution backlog: [`refactor-execution-plan.md`](refactor-execution-plan.md).

### Explicit non-goals for cleanup PRs

- Do not rewrite the governance lattice or rename public HTTP routes.
- Do not delete experiment scripts or publication assets.
- Do not “dedupe” root vs `sgrs-core` migrations by deleting one tree.
- Do not remove Mastra migration / accrual prefilter tests while those APIs remain.

---

## Suggested follow-up tickets

1. ~~Ship `docs/benchmarks/manifests/s1`–`s5`.~~ **done**
2. ~~Drive S1–S5 via `run-experiment.sh` / Studio corpora.~~ **done**
3. Soft cleanup / skills docs / archive ma-extended — see PR #27.
4. Include Studio assets in `Dockerfile.feed.dist` — see PR #26.
5. ~~Split `demo-server.ts` / `feed.ts` / `semanticGraph.ts`.~~ **done**
6. ~~Organize `scripts/`.~~ **done**
7. ~~`src/studio/` domain.~~ **done** (barrels). Next: `src/finality/`; Studio HTML split after #26; secondary hotspots.
