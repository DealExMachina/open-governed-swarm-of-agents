# Artefact review ledger

> Back to [README](../README.md) | Related: [codebase-hygiene.md](codebase-hygiene.md).

Recurring review of **old, redundant, or inconsistent artefacts**. Each cycle records what was verified, what was changed safely, and which decisions need an owner. Scope is technical (components and invasiveness), not calendar estimates.

---

## How to run a cycle

1. Diff `main` against active cleanup branches / open PRs before deleting anything already in flight.
2. Check internal markdown links and paths claimed by docs vs the tree on disk.
3. Separate **safe slim-down** (zero/few importers, redirects only) from **needs decision** (corpora, Docker story, branch merge).
4. Prefer fixing dead links and contradictions over mass deletion.
5. Append a new cycle section below; update [codebase-hygiene.md](codebase-hygiene.md) when layout reality changes.

---

## Open cleanup series (do not duplicate blindly)

| PR | Base | Status | Notes |
|----|------|--------|-------|
| [#24](https://github.com/DealExMachina/open-governed-swarm-of-agents/pull/24) | `main` | Open (draft) | Cleanup plan, placeholders, scripts taxonomy, S1–S5 manifests |
| [#26](https://github.com/DealExMachina/open-governed-swarm-of-agents/pull/26) | `dev` | Merged into `dev` | Studio/observability → `public/`; GHCR image copies `public/` |
| [#27](https://github.com/DealExMachina/open-governed-swarm-of-agents/pull/27) | `dev` | Open | Soft cleanup: archive stub, ma-extended archive, skills docs |
| [#28](https://github.com/DealExMachina/open-governed-swarm-of-agents/pull/28) | `dev` | Open | Manifest wiring, semantic-graph split, exp harness |
| [#29](https://github.com/DealExMachina/open-governed-swarm-of-agents/pull/29) | `dev` | Open | Studio HTML → CSS/JS split |

`docs/cleanup-and-refactor.md` and `public/` exist on **`dev`**, not on `main` (as of this cycle).

---

## Cycle 2026-07-25

### Verdict

`main` still carries the pre-`public/` layout and several doc/link contradictions. The larger slim-down and structural refactor already live on **`dev`**. Highest leverage for consistency is **reconciling `main` ↔ `dev`**, not starting a parallel cleanup stack.

### Critical findings

| Finding | Impact |
|---------|--------|
| **GHCR feed image (`Dockerfile.feed.dist`) omitted Studio assets** while `.dockerignore` excluded `prototype/` | Dist image could not load `src/feed.ts` (top-level `readFileSync` of Studio HTML/JS). Fixed in this cycle on `main` by shipping `prototype/`. `dev` already moved assets to `public/` + `COPY public`. |
| **`docs/benchmarks/manifests/` missing on `main`** | `pnpm run check:benchmark-manifests` and `registry.ts` point at absent YAML. Present on `dev` / PR #24. |
| **Branch divergence** | Cleanup + asset move landed on `dev`; `main` docs still describe `prototype/studio-preview`. |

### Executed this cycle (safe)

- Ship `prototype/` in `Dockerfile.feed.dist`; stop dockerignoring it (feed boot on GHCR).
- Remove obsolete `test/.gitkeep` / `test/.placeholder.ts`; drop ESLint include.
- Fold archive demo preflight into `demo/DEMO.md`; leave `docs/archive/demo.md` as redirect-only.
- Fix broken relative links in `docs/demos/ma` and `docs/demos/green-bond`.
- Align hygiene / validation / CONTRIBUTING / convergence docs with the real `test/` tree.
- Demote dead experiment protocol links (`exp-load`, `e19-e20`) and misleading Stage‑1 GitHub issue IDs in `validation.md`.
- Archive orphan `docs/investigation-3d-knowledge-mesh.md` → `docs/archive/` (zero inbound links).

### Needs human decision

| Decision | Options | Recommendation |
|----------|---------|----------------|
| **D1. `main` vs `dev` cleanup** | (A) Merge `dev` → `main` after open #27–#29 settle; (B) Retarget/close stale #24 and cherry-pick only what’s still needed on `main`; (C) Dual-maintain both layouts | **(A)** once #27–#29 are reviewed — avoids parallel artefact stories |
| **D2. Dist image corpora** | (A) `COPY demo/scenario` (or a slim subset) into GHCR feed; (B) API-only image without Studio corpora; (C) Lazy-load assets so missing corpora degrade gracefully | **(C)+(A subset)** if Studio-in-GHCR is a product goal; otherwise document API-only |
| **D3. Unwired corpora** (`docs-aml-kyc`, `docs-energy-grid`, `docs-clinical-trial`, `docs-solvency2`, `docs-ma-extended`) | (A) Keep until manifests/drivers land; (B) Archive under `docs/archive/scenario/`; (C) Delete after publication sign-off | **(A)** for s2–s5-related trees until #24/#28 merge; **(B)** for `docs-ma-extended` (already proposed in #27) |
| **D4. Root `skills/*.md`** | (A) Ship playbooks; (B) Document intentionally unshipped; (C) Remove loader path | **(B)** (matches #27) — do not invent placeholder markdown that changes prompts |
| **D5. `src/combiningAlgorithms.ts`** | (A) Wire into policy engine + tests; (B) Delete as dead; (C) Keep documented-only | **Owner call** — architecture still cites it; zero importers today |
| **D6. `sgrs-core/migrations/` copies** | (A) Delete unused duplicates; (B) Keep with README “reference only”; (C) Wire Rust build to them | **(B)** short-term (dev already adds READMEs); **(A)** once confirmed no native consumer |
| **D7. `docs/dashboard-test-suite-spec.md`** | (A) Link from hygiene/README; (B) Archive; (C) Delete if scripts are source of truth | **(B)** or **(A)** — zero inbound links today |
| **D8. Dual publication PDFs** | Keep both venue variants vs one PDF + both TeX | **Keep both** — hashes/TeX differ (not duplicate bloat) |

### Explicitly not deleted

Live on `main`: `prototype/studio-preview/`, `src/observability.html`, `seed-docs/`, wired demo corpora, research scripts called by `run-experiment.sh`, `packages/sgrs-client*`, root `migrations/`, dual `Dockerfile.feed` / `.dist` (by design).

### Next cycle checklist

- [ ] Resolve D1 (`dev` → `main` or retarget #24).
- [ ] After `public/` lands on `main`, remove `prototype/` from dist Dockerfile and docs.
- [ ] Decide D2 (corpora in GHCR image).
- [ ] Link or archive `dashboard-test-suite-spec.md`.
- [ ] Owner call on `combiningAlgorithms.ts` and `scripts/lib/experiment-harness.ts` (zero importers on `main`).
- [ ] Re-scan markdown links after any merge from `dev`.
