# Static assets served by the feed HTTP server (`pnpm run feed`)

| Path | Served at | Notes |
|------|-----------|-------|
| [`observability.html`](observability.html) | `GET /` (and HTML `Accept` on `/summary`) | Ops dashboard |
| [`studio/`](studio/) | `GET /studio`, `GET /studio/app.js` | SGRS Studio graph UI |

Loaded at process start by [`src/feed/assets.ts`](../src/feed/assets.ts). Included in the GHCR feed image via `Dockerfile.feed.dist`.
