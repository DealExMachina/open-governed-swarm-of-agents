# Observability

Prometheus scrapes the swarm application (via the OpenTelemetry collector at `otel-collector:8889`) plus the backing infrastructure: NATS (`nats-exporter:7777`), PostgreSQL (`postgres-exporter:9187`), and MinIO/S3 (native `/minio/v2/metrics/*` endpoints). Grafana is provisioned with the Prometheus datasource and file-based dashboards from `grafana/dashboards/`.

## Metric name stability

The OTEL Prometheus exporter appends a unit suffix to instruments; for unit=`1` gauges it currently appends `_ratio` (e.g. `swarm.convergence.goal_score` -> `swarm_convergence_goal_score_ratio`). Because that suffix depends on the collector version, `prometheus-rules.yml` re-exposes each affected gauge under a **stable, suffix-free name** (`swarm_convergence_goal_score`, `swarm_governance_mode_active`, ...). Dashboards query only the stable names. If a future collector changes suffixes, edit `prometheus-rules.yml` only — dashboards stay intact.

## Quick start

```bash
pnpm run observability
# or
docker compose up -d otel-collector prometheus grafana
```

**Ports:** 3004 (Grafana), 9090 (Prometheus), 4317/4318 (OTLP), 8889 (scrape)

**When data appears:** Start the swarm hatchery (`pnpm run swarm:start` or `./scripts/ops/swarm-hatchery.sh`; not facts-only `pnpm run swarm`), run demo activity (feed documents), then open http://localhost:3004. Swarm emits metrics to `http://localhost:4318`; Prometheus scrapes the collector every 15s. Allow 30–60 seconds after the first document is processed.

**Troubleshooting (no data in Grafana):**
1. Ensure otel-collector, prometheus, and grafana are running: `docker compose ps`
2. Ensure swarm is running with `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` (default in swarm-hatchery.sh)
3. Run some activity (e.g. demo step 1) — metrics are produced when agents process documents
4. Check Prometheus targets: http://localhost:9090/targets — otel-collector should be UP
5. Grafana Explore: run `{__name__=~"swarm.*"}` to see available metrics

## Dashboards

Organized as four infrastructure pillars plus one application view:

| Dashboard | UID | Description |
|-----------|-----|-------------|
| Runs & Scopes | `swarm-runs` | Per-scope convergence, agent wall time, activations, and token consumption; collapsible governance-activity row |
| SGRS Core (Rust native) | `sgrs-core` | sgrs-core call latency (avg, p50/p95/p99) and call rate by operation |
| NATS | `nats-infra` | Connections, message/byte throughput, memory/CPU, JetStream job-bus stats |
| Postgres | `postgres-state` | Governed state store: connections vs max, transactions, cache hit ratio, table sizes/bloat |
| S3 / MinIO | `minio-s3` | Cluster health, capacity, per-bucket objects/size, S3 API throughput, node drives |

## Scope-aware metrics

Most run metrics carry a `scope_id` label so spend and progress can be attributed per run/scope: convergence, propagation, governance mode, E17, **agent wall-time latency**, **LLM tokens/calls**, **progress activations**, and **deltas**. The **Runs & Scopes** dashboard exposes a **Scope** template variable (`label_values(swarm_convergence_goal_score, scope_id)`) and every scope-scoped panel filters with `{scope_id=~"$scope_id"}`.

`scope_id` defaults to the active billing scope (`getActiveScopeId()` in `src/billingContext.ts`, set per scope by the hatchery/control plane), so record helpers attach it without threading it through every call site. Note: in the single-process hatchery the active scope is a module-global — accurate when one scope is processed at a time (the demo case); truly concurrent multi-scope attribution would need context propagation.

Proposal, governance-path, and state-transition counters remain global (no `scope_id`).

## Billing currency: deltas and tokens

Two units are metered per scope for billing:

- **Deltas** (`swarm_deltas_extracted_total{scope_id,channel}`) — cumulative material evidence deltas produced by the deltas agent (support/refutation). This is the primary unit of value produced by a run.
- **Tokens** (`swarm_llm_tokens_total{scope_id,role,direction,model}`) — metered LLM cost when a model is used.

Convenience recording rules (group `swarm_billing` in `prometheus-rules.yml`): `swarm:deltas:rate5m` (deltas/sec per scope), `swarm:llm_tokens:rate5m:by_scope`, and `swarm:agent_wall_ms:mean5m:by_scope`. The Runs & Scopes dashboard's **Billing Currency** row surfaces cumulative deltas, delta production rate, deltas-by-channel, total tokens, and tokens-per-delta (cost efficiency).

## Run liveness

The **Run Liveness** row answers "is the swarm processing right now?" — because gauges (goal score, epoch, etc.) retain their last value in the collector and look identical whether a run is active or idle. It shows Active Scopes (5m), Activations/min, Job Bus Δ (new JetStream messages via `delta(jetstream_stream_last_seq)`, which idle heartbeat does not advance), and per-scope activation rate. Empty = 0 (idle), never "No data".

The feed observability page (`/`) accepts `?scope_id=` and filters `/summary`, `/convergence`, and `/events` SSE for that scope. Demo default M&A scope is `deal-horizon`.

## Document lineage APIs

| Endpoint | Description |
|----------|-------------|
| `GET /studio/scopes/:id/documents/:seq/nodes` | Nodes whose `source_ref.document_seq` traces to WAL seq |
| `GET /studio/nodes/:id/provenance?scope_id=` | Provenance summary for one graph node |

Studio document rows are clickable to highlight derived nodes on the graph.

## SGRS dashboard metrics

The SGRS dashboard queries `swarm_sgrs_call_ms_milliseconds` (with `_bucket`, `_count`, `_sum`), labeled by `operation`. Metric names follow OTEL Prometheus export: scope prefix + unit suffix (e.g. `_milliseconds`).
