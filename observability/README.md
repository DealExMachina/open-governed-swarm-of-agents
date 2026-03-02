# Observability

Prometheus scrapes the OpenTelemetry collector at `otel-collector:8889`. Grafana is provisioned with the Prometheus datasource and file-based dashboards from `grafana/dashboards/`.

## Dashboards

| Dashboard | UID | Description |
|-----------|-----|-------------|
| Swarm Governance | `swarm-governance` | Proposals, policy violations, agent latency, governance loop, throughput |
| SGRS Core (Rust native) | `sgrs-core` | sgrs-core call latency (avg, p50/p95/p99) and call rate by operation |

## SGRS dashboard metrics

The SGRS dashboard queries the histogram `swarm_swarm_sgrs_call_ms` (with `_bucket`, `_count`, `_sum`), labeled by `operation` (e.g. `analyze_convergence`, `gates`, `kernel`). If your OTEL collector exports under a different name (e.g. with a scope prefix or unit suffix), edit the panel queries in Grafana to match the actual Prometheus metric names.
