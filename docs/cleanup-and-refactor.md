# Cleanup plan and refactor assessment

> Produced by the Cleanup Agent review. Related: [codebase-hygiene.md](codebase-hygiene.md), [architecture.md](architecture.md), [refactor-execution-plan.md](refactor-execution-plan.md).

This document records what was cleaned in the current pass, what remains, how directories are organized, and a phased refactor assessment. Scope is technical (components and invasiveness), not calendar estimates.

---

## Verdict

The repo is a healthy research + product monorepo with clear license/package boundaries. Scripts are taxonomized, S1–S5 manifests drive experiments and Studio, `feed` / `semantic-graph` / `studio` / `finality` are modularized behind thin barrels, and soft cleanup (#27) is done. Remaining payoff: Studio HTML split (#29), secondary hotspots (`governanceAgent`, `bridge.rs`), and `dev` → `main` convergence.

---

## Cleanup executed (this PR)

| Action | Path | Rationale |
|--------|------|-----------|
| Deleted | `test/.gitkeep` | Directory has real tests; placeholder no longer needed |
| Deleted | `test/.placeholder.ts` | Same; was only keeping ESLint/TS aware of an empty tree |
| Updated | `tsconfig.eslint.json` | Dropped explicit `.placeholder.ts` include |
| Moved | `workers/facts-worker/test_nli.py` → `workers/facts-worker/tests/unit/` | Orphaned at worker root; peers already live under `tests/unit/` |
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
| `public/studio/**`, `public/observability.html` | Served by feed at `/studio` and `/` (copied into GHCR image) |
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
| ~~`docs/archive/demo.md`~~ | **done** — deleted; preflight/troubleshooting in [`demo/DEMO.md`](../demo/DEMO.md) |
| Empty Python `tests/__init__.py` files | **keep** — conventional markers; not worth deleting |
| ~~Unwired corpora (`docs-ma-extended`)~~ | **done** — archived at [`docs/archive/scenario/docs-ma-extended/`](archive/scenario/docs-ma-extended/) |
| ~~Missing `docs/benchmarks/manifests/*.yaml`~~ | **done** — S1–S5 manifests shipped under [`docs/benchmarks/`](benchmarks/README.md) |
| ~~Missing root `skills/*.md`~~ | **done (doc)** — unshipped by design; loader kept; no placeholder markdown |
| ~~`Dockerfile.feed.dist` omits Studio assets~~ | **done** — image copies `public/` |

---

## Subdirectory organization

```
/
├── src/                 # TS orchestration — feed/, semantic-graph/, studio/, finality/ extracted; rest still flat
├── sgrs-core/           # Rust kernel + N-API (well modularized internally)
├── packages/            # MIT clients (TS + Python)
├── workers/facts-worker # Python extraction / NLI
├── demo/                # Demo UI server + scenario corpora
├── public/              # Feed static assets (Studio + observability)
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

1. **`src/` still has flat modules** — billing, hatchery, agents share top-level namespace; domains partially extracted.
2. ~~**`scripts/` mixes production ops with one-off research**~~ — **done**: files live under `ops/`, `checks/`, `demo/`, `experiments/`, `benchmarks/`.
3. ~~**`prototype/` naming lies**~~ — **done**: Studio + observability live under `public/`.
4. ~~**Scenario corpora lack manifest wiring**~~ — **done**: S1–S5 via manifests + `run-experiment.sh` + Studio ids; demo UI picker unchanged.
5. ~~**Static HTML lives beside TS**~~ — **done**: assets under `public/`; monolithic HTML split still open (#29).

### Target layout (incremental)

```
src/
  server/          # feed routes, control plane mount, MITL
  semantic-graph/  # nodes, edges, snapshots, provenance  ← done
  finality/        # evaluator, certificates, HITL requests  ← done
  studio/          # catalog, corpora, graph edges, progress  ← done
  runtime/         # hatchery, swarm, watchdog, event bus
  governance/      # policy, resolution, obligations
  agents/          # (already exists)
scripts/
  ops/ checks/ demo/ experiments/ benchmarks/ lib/   # taxonomized
public/
  studio/ observability.html
demo/
  server/ ui/ scenario/corpora/<id>/
```

---

## Refactor assessment

### Hotspots (by size / coupling)

| File | ~Lines | Issue |
|------|-------:|-------|
| `demo/demo-server.ts` | thin entry | Logic in `demo/server/`; UI in `demo/ui/` |
| `public/studio/index.html` | ~750 | Shell markup; CSS + graph boot extracted (#29) |
| `src/semanticGraph.ts` | barrel | Logic under `src/semantic-graph/` |
| `sgrs-core/src/bridge.rs` | 1600+ | Broad N-API surface |
| `src/feed.ts` | thin entry | Routes under `src/feed/`; static via `assets.ts` |
| `src/agents/governanceAgent.ts` | 1300+ | Tools + finality consumer + proposals |
| `src/finalityEvaluator.ts` | barrel | Logic under `src/finality/` |

### Duplication patterns

- ~~Scenario metadata triplicated~~ — reduced: S1–S5 share manifest loader; product demos still use directory scans.
- HTTP/SSE helpers duplicated between feed and demo server.
- Parallel migration numbering without cross-links (now documented via READMEs).

### Phased refactor (technical scope)

| Phase | Scope | Invasiveness | Risk |
|-------|-------|--------------|------|
| **P0 — Manifests** | ~~Add manifests + wire experiments/Studio~~ **done** | — | — |
| **P1 — Split demo server** | ~~Extract `demo/server/` + `demo/ui/`~~ **done** | — | — |
| **P2 — Static assets** | ~~Move Studio + observability HTML to `public/`~~ **done** | — | — |
| **P3 — Split feed + graph** | ~~`src/feed/` + `src/semantic-graph/`~~ **done** | — | — |
| **P4 — Scripts taxonomy** | ~~`scripts/{ops,experiments,...}`~~ **done** | — | — |
| **P5 — Rust test classes** | ~~`exp-harness` feature gates `tests/exp_*.rs`~~ **done** | — | — |

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
3. ~~Soft cleanup / skills docs / archive ma-extended.~~ **done**
4. ~~Include Studio assets in `Dockerfile.feed.dist`.~~ **done** (`COPY public`)
5. ~~Split `demo-server.ts` / `feed.ts` / `semanticGraph.ts`.~~ **done**
6. ~~Organize `scripts/`.~~ **done**
7. ~~`src/studio/` + `src/finality/` domains.~~ **done** (barrels). Next: Studio HTML split (#29); secondary hotspots (`governanceAgent`, `bridge.rs`).

