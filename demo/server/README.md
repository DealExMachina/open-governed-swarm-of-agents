# Demo server modules

`pnpm run demo` still enters via [`../demo-server.ts`](../demo-server.ts). Implementation is split as follows:

| Path | Role |
|------|------|
| `config.ts` | `DEMO_PORT`, `FEED_URL`, `MITL_URL` |
| `types.ts` | `DemoDoc`, scenario metadata types |
| `scenarios.ts` | Corpus loaders + `SCENARIOS` registry |
| `state.ts` | Mutable active session/scenario state |
| `http.ts` | Auth headers, JSON helpers, feed/MITL proxies |
| `sse.ts` | Feed→UI SSE proxy (scope-filtered) |
| `routes.ts` | `/api/*` handlers |

Static UI lives in [`../ui/`](../ui/) (`index.html`, `ma-view.html`).
