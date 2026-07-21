# sgrs-core migrations

Schema and assets packaged with the Rust reduction kernel (`sgrs-core`). Currently mirrors a subset of the application causal / evidence / propagation tables (`019`–`021`).

Do **not** treat these as a substitute for root [`migrations/`](../../migrations/). Day-to-day Node swarm schema changes go in the root tree and are applied via `pnpm run ensure-schema`.

See [docs/codebase-hygiene.md](../../docs/codebase-hygiene.md).
