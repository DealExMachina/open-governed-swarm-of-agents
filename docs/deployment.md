# Deploying or connecting to the swarm

This kernel repo runs the orchestration stack (feed API, agents, Postgres, NATS, MinIO, etc.). The **product** repo hosts [SGRS Studio, the REST API surface, and client libraries](https://github.com/DealExMachina/sgrs).

| Mode | What you do | Notes |
|------|-------------|--------|
| **Hosted (cloud)** | Open the Studio URL and point clients at the public API | Planned Studio URL: `https://app.sgrs-cloud.dealexmachina.com` (**not live yet**). For availability or early access, contact [jeanbapt@dealexmachina.com](mailto:jeanbapt@dealexmachina.com). |
| **Self-hosted** | Clone this repo, configure `.env`, run `docker compose`, then migrations / seed / swarm (see README Quick start) | You can build the feed image locally (default compose) or pull a prebuilt image (see below). |
| **Enterprise (private hosted)** | Engage with us for a dedicated instance, integration, and support | Email [jeanbapt@dealexmachina.com](mailto:jeanbapt@dealexmachina.com). |

**Experimental use:** see [experimental-terms.md](./experimental-terms.md).

---

## Connect (cloud-oriented clients)

When Studio and API are reachable over HTTPS:

1. Configure your tenant / scope and API base URL (see the [sgrs](https://github.com/DealExMachina/sgrs) repo).
2. Use the product TypeScript client [`@sgrs/client-ts`](https://www.npmjs.com/package/@sgrs/client-ts) or Python [`sgrs-client`](https://pypi.org/project/sgrs-client/) from the `sgrs` repository for external integrations.

Python releases use GitHub Actions [`.github/workflows/pypi-publish.yml`](../.github/workflows/pypi-publish.yml) (**filename must stay in sync with PyPI Trusted Publishing**). Stable semver policy: [release-versioning.md](./release-versioning.md).

The **API contract** is defined in the product monorepo: [`packages/api-schema`](https://github.com/DealExMachina/sgrs/tree/main/packages/api-schema) (OpenAPI).

**SDK + HTTP reference** (when the docs site is published): see the sgrs README — [built docs](https://dealexmachina.github.io/sgrs/) (GitHub Pages from the `sgrs` repo when enabled).

---

## Self-host with Docker Compose (default)

From the repository root:

```bash
cp .env.example .env   # edit secrets and endpoints
docker compose up -d
```

This builds the **feed** image locally (`Dockerfile.feed`) and bind-mounts the repo into the container for development-style iteration.

By default, feed now binds on the internal compose network only (`FEED_HOST=0.0.0.0` inside container, no host port mapping). This keeps a **single external API door** on the product side.

If you need host access to `http://localhost:3002` for local scripts/debugging, use the dev override:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Follow the **Quick start** in [README.md](../README.md) for `pnpm install`, `ensure-schema`, `seed:all`, and `swarm:start`.

---

## Self-host with a prebuilt feed image (GHCR)

Maintainers publish a **standalone** feed image (code baked in at build time) to GitHub Container Registry:

- Image: `ghcr.io/dealexmachina/swarm-feed` (tags: `latest`, or semver / `main` as configured in CI).
- Override env: `SWARM_FEED_IMAGE` (optional) to pin a digest or tag.

```bash
docker compose -f docker-compose.yml -f docker-compose.public-images.yml up -d
```

Requires Docker Compose **v2.24+** (supports `!reset` merge keys so the feed service drops local `build` and bind mounts).

**Default compose** runs facts-worker from `python:3.11-slim` with a **bind mount** of `workers/facts-worker` (live edit; pip install on start).

**Public / air-gapped** overlay builds (or pulls) a dedicated worker image from [`workers/facts-worker/Dockerfile`](../workers/facts-worker/Dockerfile) — Python 3.11, port **8010**, copies `app.py`, `rlm_facts.py`, and extraction schema assets. Override with `FACTS_WORKER_IMAGE`. Optional NER/NLI bake-in: `FACTS_WORKER_BUILD_FULL=1`.

```bash
# Build worker only
docker build -t swarm-facts-worker -f workers/facts-worker/Dockerfile workers/facts-worker

# Or let the public-images overlay build it
docker compose -f docker-compose.yml -f docker-compose.public-images.yml up -d --build facts-worker
```

---

## Public base images

Compose already relies on upstream images (e.g. Postgres + pgvector, NATS, MinIO, Grafana). Custom images in the public-images workflow: **feed** (GHCR) and **facts-worker** (local Dockerfile or `FACTS_WORKER_IMAGE`).

---

## License reminder

Orchestration code in this repo is **AGPL-3.0-only**; the Rust kernel under `sgrs-core/` is **Elastic License 2.0 (ELv2)**. The kernel internal HTTP clients (`packages/sgrs-client`, `packages/sgrs-client-py`) are **MIT**. See [README.md](../README.md#license).
