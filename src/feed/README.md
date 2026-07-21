# Feed HTTP server modules

`pnpm run feed` still enters via [`../feed.ts`](../feed.ts), which re-exports the public API and runs `main`.

| Path | Role |
|------|------|
| `config.ts` | Port, NATS stream, scope policy, MITL URL |
| `http.ts` | Path/query/JSON helpers |
| `scope.ts` | Scope parsing + `validateScopedRequest` |
| `runtime.ts` | Hatchery bind + EventBus singleton |
| `summary.ts` | `buildScopeSummaryForScope` read model |
| `ingest.ts` | Shared context-doc ingest helper |
| `contextRoutes.ts` | `/context/docs`, `/context/resolution` |
| `mitlRoutes.ts` | `/pending`, `/finality-response` proxies |
| `summaryRoutes.ts` | `/summary`, `/convergence` |
| `eventsRoute.ts` | SSE `/events` |
| `studioRoutes.ts` | Studio catalog / corpora / documents API |
| `assets.ts` | Observability + Studio static HTML/JS |
| `main.ts` | HTTP router and listen |
