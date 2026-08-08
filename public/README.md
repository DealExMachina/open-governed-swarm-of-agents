# Static assets served by the feed HTTP server (`pnpm run feed`)

| Path | Served at | Notes |
|------|-----------|-------|
| [`observability.html`](observability.html) | `GET /` (and HTML `Accept` on `/summary`) | Ops dashboard |
| [`studio/index.html`](studio/) | `GET /studio` | Shell markup + `STUDIO_CONTROL` bootstrap |
| [`studio/styles.css`](studio/styles.css) | `GET /studio/styles.css` | Studio theme |
| [`studio/studio-app.js`](studio/studio-app.js) | `GET /studio/app.js` | Live control plane (scopes, reload, HITL) |
| [`studio/graph-boot.js`](studio/graph-boot.js) | `GET /studio/graph.js` | Cytoscape init + `studio:ready` |

Loaded at process start by [`src/feed/assets.ts`](../src/feed/assets.ts). Included in the GHCR feed image via `Dockerfile.feed.dist`.
