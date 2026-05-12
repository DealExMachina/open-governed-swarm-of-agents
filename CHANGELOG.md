# Changelog

All notable changes to this repository are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
for the Node/workspace package version in `package.json` (the swarm is not published to npm).

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
