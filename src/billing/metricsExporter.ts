/**
 * Billing metrics exporter.
 *
 * Registers OpenTelemetry observable gauges that snapshot the billing state
 * (prepaid balance, consumed tokens, overage, per-scope billable deltas) from
 * Postgres each export interval. These flow through the OTEL collector to
 * Prometheus and power the Delta Billing Grafana board.
 *
 * Distinct from the `swarm.billable_deltas` counter (incremented at mint time):
 * these gauges are absolute balances, resilient across process restarts because
 * they are recomputed from the durable ledger.
 */
import { getMeter } from "../telemetry.js";
import { getPool } from "../db.js";
import { logger } from "../logger.js";

let started = false;

interface TenantRow {
  id: string;
  name: string;
  plan_name: string;
  prepaid_tokens: string;
  consumed: string;
  overage_tokens: string;
  overage_cents: string;
}

interface ScopeRow {
  tenant_id: string;
  name: string | null;
  scope_id: string;
  n: string;
}

/** Register billing observable gauges. Safe to call once per process. */
export function startBillingMetricsExporter(): void {
  if (started) return;
  started = true;

  const meter = getMeter();

  const prepaidGauge = meter.createObservableGauge(
    "swarm.billing.prepaid_tokens",
    { description: "Prepaid delta-token plan size per tenant", unit: "1" },
  );
  const consumedGauge = meter.createObservableGauge(
    "swarm.billing.delta_tokens_consumed",
    { description: "Prepaid delta-tokens consumed this period", unit: "1" },
  );
  const balanceGauge = meter.createObservableGauge(
    "swarm.billing.delta_token_balance",
    { description: "Remaining prepaid delta-token balance", unit: "1" },
  );
  const overageTokensGauge = meter.createObservableGauge(
    "swarm.billing.overage_tokens",
    { description: "Delta-tokens billed as overage", unit: "1" },
  );
  const overageCentsGauge = meter.createObservableGauge(
    "swarm.billing.overage_cents",
    { description: "Projected overage spend in cents", unit: "1" },
  );
  const billableDeltasGauge = meter.createObservableGauge(
    "swarm.billing.billable_deltas",
    {
      description: "Cumulative net-new billable deltas per tenant and scope",
      unit: "1",
    },
  );

  meter.addBatchObservableCallback(
    async (observer) => {
      let pool;
      try {
        pool = getPool();
      } catch {
        return; // DATABASE_URL not configured
      }
      try {
        const tenants = await pool.query<TenantRow>(
          `SELECT t.id, t.name, s.plan_name, s.prepaid_tokens,
                  COALESCE(SUM(m.prepaid_applied), 0) AS consumed,
                  COALESCE(SUM(m.overage_applied), 0) AS overage_tokens,
                  COALESCE(SUM(m.overage_cents), 0)   AS overage_cents
           FROM tenant_subscriptions s
           JOIN tenants t ON t.id = s.tenant_id
           LEFT JOIN metering_events m ON m.tenant_id = s.tenant_id
           GROUP BY t.id, t.name, s.plan_name, s.prepaid_tokens`,
        );

        for (const r of tenants.rows) {
          const attrs = {
            tenant: r.name,
            tenant_id: r.id,
            plan: r.plan_name,
          };
          const prepaid = Number(r.prepaid_tokens);
          const consumed = Number(r.consumed);
          observer.observe(prepaidGauge, prepaid, attrs);
          observer.observe(consumedGauge, consumed, attrs);
          observer.observe(
            balanceGauge,
            Math.max(0, prepaid - consumed),
            attrs,
          );
          observer.observe(overageTokensGauge, Number(r.overage_tokens), attrs);
          observer.observe(overageCentsGauge, Number(r.overage_cents), attrs);
        }

        const scopes = await pool.query<ScopeRow>(
          `SELECT d.tenant_id, t.name, d.scope_id, COUNT(*) AS n
           FROM delta_events d
           LEFT JOIN tenants t ON t.id = d.tenant_id
           WHERE d.tenant_id IS NOT NULL
           GROUP BY d.tenant_id, t.name, d.scope_id`,
        );
        for (const r of scopes.rows) {
          observer.observe(billableDeltasGauge, Number(r.n), {
            tenant: r.name ?? "unknown",
            tenant_id: r.tenant_id,
            scope_id: r.scope_id,
          });
        }
      } catch (e) {
        // Tables may not exist yet (pre-migration) — log once at debug level.
        logger.warn("billing_exporter_query_failed", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [
      prepaidGauge,
      consumedGauge,
      balanceGauge,
      overageTokensGauge,
      overageCentsGauge,
      billableDeltasGauge,
    ],
  );

  logger.info("billing_metrics_exporter_started");
}
