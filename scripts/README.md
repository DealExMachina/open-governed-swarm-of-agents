# Scripts taxonomy

Repository scripts are grouped by role. Prefer `pnpm run <script>` when an npm entry exists; paths below are for direct invocation from the repo root.

| Directory | Purpose |
|-----------|---------|
| [`ops/`](ops/) | Swarm lifecycle, schema/stream/bucket ensure, reset, seeding helpers, MITL simulate |
| [`checks/`](checks/) | Service health, governance path verification, dashboard smoke/regression, observers |
| [`demo/`](demo/) | Demo preflight/open helpers and demo/HITL/basic-example seeders |
| [`experiments/`](experiments/) | Experiment drivers, analyzers, loadgen, publication-oriented runners |
| [`benchmarks/`](benchmarks/) | Comparative / convergence / load benchmarks |
| [`lib/`](lib/) | Shared helpers (imported by experiment tooling) |

## Conventions

- Shell entrypoints `cd` to the **repo root** via `$(dirname "$0")/../..` before calling other scripts.
- TypeScript files import application code with `../../src/...`.
- Repo-relative assets (migrations, demo corpora) resolve with `join(__dirname, "..", "..", ...)`.
- When adding a script, place it in the matching category and wire `package.json` if it is part of the supported CLI surface.
