# CLAUDE.md — Project Rules for agents-swarm-governed

## Package Manager

**Always use `pnpm`**, never `npm` or `yarn`. This applies to all commands:
`pnpm install`, `pnpm run build`, `pnpm test`, `pnpm exec`, etc.

## Native Addon (sgrs-core)

**CRITICAL**: Always rebuild the native addon using the pnpm script, never raw napi commands:

```bash
cd sgrs-core && pnpm run build
```

This runs `napi build --release --platform`, which generates the correct
platform-specific binary (e.g. `sgrs-core.darwin-arm64.node`).

**NEVER** run `npx napi build --release` without `--platform`. It produces a
generic `sgrs-core.node` file that the loader ignores in favor of the
platform-specific name, causing the new code to silently not load (or crash).

After rebuilding, verify the addon loads:

```bash
node -e "const m = require('./sgrs-core/index.js'); console.log(typeof m.evaluateVectorFinalityBridge)"
# Must print: function
```

## Test Commands

- Rust tests: `cargo test --manifest-path sgrs-core/Cargo.toml`
- TypeScript tests: `pnpm test` or `pnpm exec vitest run`
- Both must pass before merging.

## Branch Workflow

- Main branch: `main`
- Feature branches: named after the feature (e.g. `non-scalar-finality`)
- Merge via fast-forward when possible.
