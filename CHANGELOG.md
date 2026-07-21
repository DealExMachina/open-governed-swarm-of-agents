# Changelog

All notable changes to this repository are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
for the Node/workspace package version in `package.json` (the swarm is not published to npm).

## [Unreleased]

Kernel crate `sgrs-core` bumped **0.1.0 -> 0.2.0** (propagation-layer Lyapunov + dual-condition finality). Workspace `package.json` version unchanged; the Rust crate tracks its own semver.

### Added

- **Sheaf Dirichlet energy** `f(x) = xᵀL_F x = ‖δx‖²` in `sgrs-core` (`propagation/dirichlet.rs`): the true propagation-layer Lyapunov function, its per-edge decomposition, and the global-section characterization `{x : f(x) = 0} = ker(δ) = H⁰(G;F)`. Contracts at rate `(1 - αλ₂)²`.
- Propagation steps now report `dirichlet_before` / `dirichlet_after` (NAPI DTO + TS `PropagationStepResult`), plus direct `dirichletEnergy` / `dirichletEnergyByEdge` bridges and `PropagationEngine.getDirichletEnergy`.
- **Dual-condition (∧) finality gate**: RESOLVED requires `[f(x) < ε_prop] ∧ F*(t)` — propagation-layer consensus (global section) AND semantic-layer vector finality (non-compensable). Configured via `finality.yaml: dirichlet_gate`. Additive and backward-compatible: falls back to the semantic layer alone when disabled or when no propagation history exists. Emits a `dirichlet_hold` signal when semantics are ready but propagation is still converging.
- Migration `025_propagation_history_dirichlet.sql`: nullable `dirichlet_before` / `dirichlet_after` columns (legacy rows fall back to the Ω proxy).
- `docs/cleanup-and-refactor.md`: cleanup backlog, subdirectory review, and phased refactor assessment.
- `demo/scenario/README.md` corpus wiring matrix; READMEs for root and `sgrs-core` migration trees.
- `scripts/README.md` documenting the scripts taxonomy.
- Benchmark manifests **s1–s5** under `docs/benchmarks/manifests/` (S1 via `builtinRef`; S2–S5 wire Solvency II, clinical trial, AML/KYC, energy-grid corpora).

### Changed

- **Convergence model is now explicitly two-layer and lattice-geometric.** The scalar Lyapunov `V(t)` is documented and retained as a **diagnostic** (rate, ETA, plateau, pressure), not the admissibility test; admissibility is vector finality `F*` plus the Dirichlet gate. `docs/convergence.md` and `docs/architecture.md` rewritten accordingly.
- The variance proxy `Ω(x)` is now clearly labelled a topology-health signal (it equals `f(x)/N` only on the constant complete sheaf; on projection sheaves it can plateau above zero while `f(x) -> 0`). Finality gates on `f(x)`.
- Moved `workers/facts-worker/test_nli.py` into `workers/facts-worker/tests/unit/` for consistent pytest layout.
- Fixed `agents-swarm-governed.code-workspace` to open only this repo (removed broken sibling path).
- Taxonomized `scripts/` into `ops/`, `checks/`, `demo/`, `experiments/`, `benchmarks/` (+ `lib/`); updated `package.json`, shell entrypoints, and docs accordingly.

### Removed

- Obsolete Vitest placeholders `test/.gitkeep` and `test/.placeholder.ts` (real tests already present under `test/`).

### Notes

- **Scope boundary (open product vs. research):** this snapshot ships the ∧-gate, Dirichlet energy, and global sections — the powerful, teachable core of the lattice-geometry model. The `κ_max = γ·λ₂(L_F)` ISS tightness bound and the Lean4 proofs remain in the research repository and are intentionally not included here.

## [1.1.0] - 2026-05-12

Workspace **package.json** version (orchestration / Node monolith). The **Rust crate** `sgrs-core` keeps its own semver in `sgrs-core/Cargo.toml` (unchanged in this release unless a kernel change ships).

### Added

- `tsconfig.eslint.json` so ESLint type-aware rules cover `src/` and `test/` (including `test/.placeholder.ts`).
- Root devDependency `@napi-rs/cli` so `pnpm build:rust` resolves the `napi` binary on CI and fresh clones without a separate `sgrs-core/node_modules` install.
- `engines.node` (`>=20`) in `package.json` to match CI and `@napi-rs/cli` requirements.

### Changed

- **CI:** GitHub Actions install Rust (stable), run `pnpm build:rust` before `pnpm build` / `pnpm typecheck` in test, build, and lint workflows so `sgrs-core/index.js` and typings exist before `tsc`.
- **CI:** Build workflow Node matrix is **20 only** (Node 18 removed; current napi toolchain expects Node 20+ APIs).
- **TypeScript:** `skipLibCheck: true` in main `tsconfig.json` (aligns with `tsconfig.check.json`, avoids blocking on third-party `.d.ts` defects).
- **Lint:** `pnpm lint` allows up to 80 warnings (`--max-warnings 80`) with tests in the type-aware project.
- **Formatting:** Prettier applied across `src/**/*.ts` and `test/**/*.ts` so `pnpm format:check` passes in CI.

### Fixed

- `actionExecutor.ts`, `watchdog.ts`, `sgrsAdapter.ts`: unused symbols and implicit `any` in vector finality mapping for strict `tsc`.
- Default ports documented elsewhere: product API **3003**, kernel demo **3005**, resolution MCP **3006** (see `README.md` and `.env.example`).

## [1.0.0] - earlier

No maintained changelog entries before 1.1.0; use `git log` for history.
