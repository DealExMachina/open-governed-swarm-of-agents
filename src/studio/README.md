# Studio domain modules

Catalog scopes, corpora, graph-edge helpers, document progress, and scenario↔scope mapping for SGRS Studio / demo.

Legacy import paths (`src/studioCatalog.ts`, `src/scenarioScopes.ts`, …) remain thin re-export barrels.

| Module | Role |
|--------|------|
| `catalog.ts` | `studio_catalog_scopes` CRUD / resolution |
| `corpora.ts` | Demo dirs + S1–S5 manifest corpora |
| `graphEdges.ts` | Synthetic Cytoscape edges |
| `documentProgress.ts` | Ingest progress for Studio |
| `scopeReinit.ts` | Wipe/reinit scenario scopes |
| `scenarioScopes.ts` | Demo scenario → scope id map |
