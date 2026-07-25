# Delta Billing Demo Runbook

Demonstrates deltas as a billable currency: two tenants, five scopes each,
billed in delta-tokens under a hybrid prepaid + overage model. One tenant stays
within plan; the other "explodes" its subscription into overage.

See the PRD at [`docs/product/PRD-delta-billing-demo.md`](../../product/PRD-delta-billing-demo.md).

## What it shows

| Tenant | Plan | Prepaid | Overage rate | Outcome |
|--------|------|--------:|-------------:|---------|
| Meridian Capital | Growth | 1,000 tokens | 5c/token | Within plan (0 overage) |
| Orion Advisory | Starter | 150 tokens | 10c/token | Deep overage (exploding subscription) |

Billing runs on a local, Metronome-shaped simulator (`src/billing/localMeteringProvider.ts`)
selected via `METERING_PROVIDER=local` (default). The `MeteringProvider`
interface is ready for a real Metronome/Stripe provider later.

## Quick start (one command)

```bash
./scripts/demo/run-billing-demo.sh
```

This ensures Postgres + observability are up, applies migrations, seeds the two
tenants / ten scopes, drives the scenario, and prints a per-tenant summary.

Default mode is `synthetic`: it deterministically mints net-new billable deltas
so the "explode" outcome is reproducible without a running swarm or model, and
pushes billing metrics to the collector so the Grafana board populates.

Expected summary:

```
Meridian Capital  [Growth]   -> within plan   (consumed 200 / 1000, overage 0,   $0.00)
Orion Advisory    [Starter]  -> OVERAGE        (consumed 150 / 150,  overage 150, $15.00)
```

## Modes

- Synthetic (default): `./scripts/demo/run-billing-demo.sh`
- Real pipeline: `DRIVE_MODE=real ./scripts/demo/run-billing-demo.sh`
  - Requires the swarm hatchery running (`pnpm run swarm:start`) so each
    `(tenant, scope)` can be rebound and the agent pipeline mints real deltas.
  - Outcome depends on the model and number of cycles (not guaranteed to explode).

Useful env vars:

- `DRIVE_MODE=synthetic|real` (default `synthetic`)
- `BILLING_DEMO_RESET=1|0` (default `1`) — clear prior billing rows for the demo scopes first
- `PUSH_METRICS=1|0` (default `1`) — push billing metrics to the collector on finish
- `DEMO_SKIP_DOCKER=1` — assume services are already running

## Individual steps

```bash
pnpm run ensure-schema        # applies migration 031_delta_billing_demo.sql
pnpm run seed:billing-demo    # 2 tenants, 10 scopes, subscriptions
pnpm run drive:billing-demo   # mint + meter (synthetic by default)
```

## Grafana

Open Grafana at http://localhost:3004 -> Dashboards -> **Delta Billing**.
Select a tenant in the top-right variable:

- Balance Remaining, Tokens Consumed, Prepaid Burn-down gauge
- Overage Tokens / Projected Overage Spend (turn red for Orion)
- Billable deltas rate and per-scope cost table
- "Overage by Tenant" bar gauge highlights the exploding subscription

If the board is empty, ensure the driver ran with `PUSH_METRICS=1` (or the
hatchery is running), and that Prometheus has loaded the recording rules
(`curl -XPOST http://localhost:9090/-/reload`). The dashboard queries the
stable, suffix-free metric names produced by `observability/prometheus-rules.yml`
(the OTEL exporter appends `_ratio` to `unit="1"` gauges; the recording rules
re-expose them without the suffix).

## Inspecting the ledgers

```sql
-- Net-new billable deltas per tenant/scope
SELECT t.name, d.scope_id, COUNT(*) 
FROM delta_events d JOIN tenants t ON t.id = d.tenant_id
GROUP BY t.name, d.scope_id ORDER BY t.name, d.scope_id;

-- Prepaid vs overage split per tenant
SELECT t.name,
       SUM(m.prepaid_applied) AS prepaid,
       SUM(m.overage_applied) AS overage,
       SUM(m.overage_cents)/100.0 AS overage_usd
FROM metering_events m JOIN tenants t ON t.id = m.tenant_id
GROUP BY t.name ORDER BY t.name;
```

## How billing stays correct

- **Net-new only.** After `extractDeltas`, `deltaLedger.recordBillableDeltas`
  diffs the latest evidence against `billed_delta_snapshot` per
  `(role, dimension, channel)` and persists only material changes. Re-processing
  the same evidence bills nothing (also enforced by the
  `UNIQUE (scope_id, epoch, role, dimension, channel)` constraint on
  `delta_events`).
- **Idempotent metering.** `metering_events.delta_event_id` is `UNIQUE`, so each
  billable delta is metered exactly once (prepaid burn-down first, then overage).
- **Governance gate unchanged.** Adversarial / high-drift scopes still mint zero
  deltas; only legitimate propagation produces billable currency.

## Cleanup

```bash
# Remove demo billing rows (keeps tenants/scopes)
BILLING_DEMO_RESET=1 pnpm run drive:billing-demo   # re-run resets first
```

## Out of scope (future work)

Real Metronome/Stripe wiring, invoices, payments, checkout, webhooks, and
nightly reconciliation. The provider interface is ready; only `local` is
implemented for this demo.
