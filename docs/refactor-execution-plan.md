# Refactor execution plan

> Companion to [cleanup-and-refactor.md](cleanup-and-refactor.md). Scope is technical; no calendar estimates.

## Priority order

| Track | Goal | Why first | Status |
|-------|------|-----------|--------|
| **R1** | Wire experiments to S1–S5 manifests | YAML already shipped; unlocks S2–S5 without new demo UX | **done** (this PR) |
| **R2** | Split `src/semanticGraph.ts` behind barrel | Largest remaining TS hotspot; enables later `src/` layout | **done** (this PR) |
| **R3** | Incremental `src/` domains | `src/studio/` collocated (barrels at old paths); `finality/` next | **studio done**; finality pending |
| **R4** | Split Studio HTML/JS | Needs `public/studio/` (PR #26); extract app shell vs graph logic | Blocked on #26 |
| **R5** | Rust test classes (P5) | Gate/ignore heavy `exp_*` vs fast invariants | **done** (`exp-harness` feature) |
| **R6** | Secondary hotspots | `governanceAgent`, `finalityEvaluator`, `bridge.rs` — after R2–R3 | Deferred |

## R1 — Manifest → experiments

**Keep:** demo UI scenarios (`ma` / financial / insurance / green-bond) unchanged.

**Change:**
- `drive-experiment.ts` accepts `--corpus=s1|s2|s3|s4|s5` (and `--scenario=` alias)
- Load docs via `loadBenchmarkPackageForScenario` + `loadDocumentTextForPackage`
- Default rounds = package document count when shell does not override
- `run-experiment.sh` cases for `s1`–`s5`

**Optional later:** Studio corpus ids `s2`–`s5` via same loader (no demo picker cards).

## R2 — semanticGraph modules

```
src/semantic-graph/{types,view,nodes,edges,finalitySnapshot,
  contradictions,resolutions,goalMatching,goals,knowledgeState,studio,index}.ts
src/semanticGraph.ts  →  export * from "./semantic-graph/index.js"
```

No import-site churn in the first PR.

## R3 — src/ domains (incremental)

After R2 stabilizes:
1. Collocate Studio helpers (`studioCatalog`, `studioCorpora`, `studioGraphEdges`, …) under `src/studio/`
2. Collocate finality (`finalityEvaluator` + consumers) under `src/finality/` with re-export shims
3. Leave agents/ under `src/agents/` (already grouped)

Do **not** big-bang rename all of `src/` in one PR.

## R4 — Studio UI monolith

Depends on assets living under `public/studio/` (PR #26). Then extract:
- markup shell vs Cytoscape bootstrap vs control-plane client
- Prefer keeping served URLs `/studio` and `/studio/app.js`

## R5 — Rust tests

In `sgrs-core`:
- Mark publication/harness tests (`exp_*` / long integration) with `#[ignore]` or a Cargo feature `exp-harness`
- Default `cargo test` = fast invariants
- Document the slow lane in `sgrs-core/README` or validation.md

## Explicit non-goals (this wave)

- No HTTP route renames
- No inventing `skills/*.md` placeholders
- No wiring archived `docs-ma-extended` into demos
- No rewriting `bridge.rs` N-API surface
