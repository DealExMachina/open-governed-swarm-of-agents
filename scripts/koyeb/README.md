# Koyeb SGRS demo stack

Provision the hosted demo: **private kernel** (feed, hatchery, NATS, MinIO, facts-worker) + **public product door** (sgrs API + Studio with Clerk).

## Prerequisites

- [Koyeb CLI](https://www.koyeb.com/docs/cli/installation) authenticated (`koyeb login`)
- Org with Volume support in **`fra`** or **`was`**
- Clerk app (Google + Apple + email) with webhook `https://<api-host>/webhooks/clerk`
- Secrets filled in from [`env.template`](./env.template)

## Quick start

```bash
# 1. Copy and edit secrets (do not commit)
cp scripts/koyeb/env.template scripts/koyeb/env.local
# edit scripts/koyeb/env.local

# 2. Create app + private infra (Postgres, NATS, MinIO, kernel, worker)
source scripts/koyeb/env.local
./scripts/koyeb/provision-infra.sh

# 3. Deploy public api + studio (after product images are built/pushed)
./scripts/koyeb/deploy-public.sh

# 4. Smoke test
./scripts/koyeb/smoke-demo.sh
```

## Service layout (`sgrs-demo`)

| Service | Public | Scale-to-zero | Notes |
|---------|--------|---------------|-------|
| `postgres` | No | Yes (idle) | Koyeb managed Small |
| `nats` | No | No | 5 GB volume on `/data` |
| `minio` | No | No | 5–10 GB volume on `/data` |
| `facts-worker` | No | Yes | Eco small |
| `feed` | No | Optional | GHCR `swarm-feed` |
| `hatchery` | No | No while live | GHCR `swarm-hatchery` |
| `api` | Yes | Yes | sgrs `Dockerfile.api` |
| `studio` | Yes | Yes | sgrs `Dockerfile.studio` |

Feed is **mesh-only**. Product API proxies with `SWARM_API_TOKEN`.

## Pause between demos

```bash
./scripts/koyeb/pause-demo.sh    # scale down NATS, MinIO, hatchery, facts-worker
./scripts/koyeb/resume-demo.sh   # bring stack back
```

Approx cost when paused: **~$5–15/mo** (Postgres storage + idle services). Always-on: **~$35–50/mo**.

## Upgrade path

| Component | Demo | Production upgrade |
|-----------|------|-------------------|
| Object store | MinIO + Volume | [Cloudflare R2](https://developers.cloudflare.com/r2/) — drop MinIO |
| Message bus | NATS on Koyeb | Managed NATS or VM cluster |
| Hatchery | Standard small | Medium/large for heavier workloads |

See [docs/deployment.md](../../docs/deployment.md) for kernel image tags and env matrix.

## Health checks

| Service | Probe |
|---------|-------|
| feed | `GET /health` |
| api | `GET /api/health` |
| studio | `GET /api/health` |
| facts-worker | `GET /health` |
| nats | `GET :8222/healthz` |
| minio | `GET /minio/health/live` |

## E2E validation

1. Sign up in Studio (Google / Apple / email)
2. Settings → API keys → create `sk_live_…`
3. Call `@sgrs/client-ts` against public API URL with the key
4. Ingest a document; confirm hatchery activity in Studio scopes
