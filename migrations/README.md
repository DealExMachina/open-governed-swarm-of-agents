# Application migrations (Postgres)

SQL applied by `pnpm run ensure-schema` for the Node orchestration stack (context WAL, semantic graph, control plane, Studio catalog, etc.).

Numbering gaps (for example missing `001` / `004`) are historical; do not renumber applied files.

## Parallel tree

`sgrs-core/migrations/` holds a smaller set used by the Rust crate / native packaging. Overlap on `019`–`021` is intentional parallel evolution — the trees are **not** interchangeable. Application schema changes belong here unless you are working only inside `sgrs-core`.

See [docs/codebase-hygiene.md](../docs/codebase-hygiene.md).
