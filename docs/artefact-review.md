# Artefact review ledger

> Back to [README](../README.md) | Related: [codebase-hygiene.md](codebase-hygiene.md), [cleanup-and-refactor.md](cleanup-and-refactor.md).

Recurring review of **old, redundant, or inconsistent artefacts**. Each cycle records what was verified, what was changed safely, and which decisions need an owner. Scope is technical (components and invasiveness), not calendar estimates.

---

## How to run a cycle

1. Fetch/rebase onto the intended tip (`origin/dev` while cleanup lands there; `origin/main` after catch-up).
2. Diff against open cleanup PRs before deleting anything already in flight.
3. Check internal markdown links and paths claimed by docs vs the tree on disk.
4. Separate **safe slim-down** from **needs decision**.
5. Prefer fixing dead links and contradictions over mass deletion.
6. Append a new cycle section below; update hygiene / cleanup docs when layout reality changes.

---

## Open cleanup series (do not duplicate blindly)

| PR | Base | Status | Notes |
|----|------|--------|-------|
| [#24](https://github.com/DealExMachina/open-governed-swarm-of-agents/pull/24) | `main` | Open (draft) | Overlaps content already on `dev` — prefer close/retarget after `dev` → `main` |
| [#26](https://github.com/DealExMachina/open-governed-swarm-of-agents/pull/26) | `dev` | Merged | Studio/observability → `public/`; GHCR copies `public/` |
| [#27](https://github.com/DealExMachina/open-governed-swarm-of-agents/pull/27) | `dev` | Open (conflicts) | Soft cleanup: delete archive stub, archive ma-extended, skills docs |
| [#28](https://github.com/DealExMachina/open-governed-swarm-of-agents/pull/28) | `dev` | Open (conflicts) | Wire s1–s5 drivers, split semantic-graph/finality/studio, exp-harness |
| [#29](https://github.com/DealExMachina/open-governed-swarm-of-agents/pull/29) | `dev` | Open (conflicts) | Studio HTML → CSS/JS split |
| [#30](https://github.com/DealExMachina/open-governed-swarm-of-agents/pull/30) | retarget `dev` | Open | This ledger + post-rebase consistency fixes |

---

## Cycle 2026-07-25 (rebased onto `origin/dev`)

### Verdict

After rebase onto `origin/dev`, the tip has **`public/`**, taxonomized **`scripts/`**, and **S1–S5 manifests**. Relative markdown links: **0 broken**. Remaining work is owner decisions + finishing open PRs #27–#29 (all currently **conflicting** with tip), not another parallel cleanup stack.

### Critical (still open on tip)

| Finding | Impact |
|---------|--------|
| **GHCR feed omits `demo/scenario`** (`.dockerignore` + no COPY) | Studio HTML boots; corpus load degrades to empty; still no corpora in image (D2) |
| **Cleanup PRs #27–#29 conflict with tip** | Soft cleanup / wiring / Studio split cannot land without rebase |

~~**D10 facts-worker Dockerfile**~~ — **fixed**: aligned to Python 3.11 / port 8010 / full runtime COPY; wired via `docker-compose.public-images.yml` (`FACTS_WORKER_IMAGE`). Default compose still bind-mounts for live edit.

### Already fixed by `dev` (supersedes cycle-1 `main` findings)

- Studio at `public/studio/`; GHCR `COPY public`
- Scripts under `ops/` / `checks/` / `demo/` / `experiments/` / `benchmarks/`
- S1–S5 manifests present; `check:benchmark-manifests` path exists
- Vitest placeholders removed; demo/feed module splits landed

### Executed this rebase cycle (safe)

- Rebase artefact-review branch onto `origin/dev`; drop obsolete `prototype/` dist fix in favor of `public/`
- `loadCorpusDocuments` returns `[]` when scenario dirs missing (no 500 on API-only images)
- Fix validation e19/e20 script paths to `scripts/experiments/`
- Refresh cleanup Verdict, scenario README, hygiene corpus wording, README “prototypes” phrasing, CHANGELOG Docker note
- Keep archive investigation + redirect stub; demote dead experiment protocol links (from cycle 1, retained)

### Needs human decision (updated)

| Decision | Options | Recommendation |
|----------|---------|----------------|
| **D1. `main` vs `dev`** | (A) Finish #27–#29 on `dev`, merge `dev` → `main`, close/retarget #24; (B) cherry-pick only; (C) dual-maintain | **(A)** |
| **D2. Dist corpora** | (A) `COPY demo/scenario` (or subset); (B) document API-only Studio; (C) graceful empty (done) + optional COPY | **(B) or (A subset)** — graceful empty is now in tree |
| **D3. Corpora** | Keep s2–s5 until #28 wires drivers; archive `docs-ma-extended` (#27) | **Keep s2–s5; archive ma-extended via #27** |
| **D4. Skills** | Ship / intentionally unshipped / remove loader | **(B)** via #27 wording |
| **D5. `combiningAlgorithms.ts` + `experiment-harness.ts`** | Wire / delete / keep | **Owner call** — still zero importers |
| **D6. `sgrs-core/migrations/`** | Delete identical copies / keep annotated / wire Rust | **(B)** short-term |
| **D7. `docs/dashboard-test-suite-spec.md`** | Link / archive / delete | **(B)** — still 0 inbound links |
| **D8. Dual PDFs** | Keep both venue variants | **Keep both** |
| **D9. Orphan research scripts** | Archive/delete zero-caller benchmarks (`benchmark-*-agents`, `benchmark-gateway-load`, `benchmark-multi-scope`, `test-llm-paths`, `describe-scope-graph`) | **Owner call** — low risk if research not needed in-tree |
| ~~**D10. Facts-worker Dockerfile**~~ | — | **Done** — Dockerfile fixed + public-images overlay |

### Explicitly not deleted

`public/studio/**`, wired demo corpora, s2–s5 corpora (manifest-backed), `seed-docs/`, `packages/sgrs-client*`, root `migrations/`, dual feed Dockerfiles, research scripts used by `run-experiment.sh`.

### Next cycle checklist

- [ ] Rebase/land #27 → #28 → #29 on `dev` (resolve conflicts first)
- [ ] Resolve D1 (`dev` → `main`) and close stale #24
- [x] Fix D10 (facts-worker Dockerfile + public-images overlay)
- [ ] Owner call on D2 (corpora in GHCR)
- [ ] Owner call on D5 / D9 orphans
- [ ] Archive or link `dashboard-test-suite-spec.md` (D7)
- [ ] Re-scan markdown links after #27–#29 land

---

## Cycle 2026-07-25 (original, on `main` — historical)

First pass targeted `main` before rebase. Key finding was `main`↔`dev` divergence and GHCR omitting Studio when assets lived under `prototype/`. Superseded by the rebased cycle above once this branch sits on `origin/dev`.
