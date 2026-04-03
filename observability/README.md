# Observability

Prometheus scrapes the OpenTelemetry collector at `otel-collector:8889`. Grafana is provisioned with the Prometheus datasource and file-based dashboards from `grafana/dashboards/`.

## Quick start

```bash
pnpm run observability
# or
docker compose up -d otel-collector prometheus grafana
```

**Ports:** 3004 (Grafana), 9090 (Prometheus), 4317/4318 (OTLP), 8889 (scrape)

**When data appears:** Start the swarm (`pnpm run swarm`), run demo activity (feed documents), then open http://localhost:3004. Swarm emits metrics to `http://localhost:4318`; Prometheus scrapes the collector every 15s. Allow 30–60 seconds after the first document is processed.

**Troubleshooting (no data in Grafana):**
1. Ensure otel-collector, prometheus, and grafana are running: `docker compose ps`
2. Ensure swarm is running with `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` (default in swarm-hatchery.sh)
3. Run some activity (e.g. demo step 1) — metrics are produced when agents process documents
4. Check Prometheus targets: http://localhost:9090/targets — otel-collector should be UP
5. Grafana Explore: run `{__name__=~"swarm.*"}` to see available metrics

## Dashboards

| Dashboard | UID | Description |
|-----------|-----|-------------|
| Swarm Governance | `swarm-governance` | Proposals, policy violations, agent latency, governance loop, throughput |
| SGRS Core (Rust native) | `sgrs-core` | sgrs-core call latency (avg, p50/p95/p99) and call rate by operation |

## SGRS dashboard metrics

The SGRS dashboard queries `swarm_sgrs_call_ms_milliseconds` (with `_bucket`, `_count`, `_sum`), labeled by `operation`. Metric names follow OTEL Prometheus export: scope prefix + unit suffix (e.g. `_milliseconds`).
