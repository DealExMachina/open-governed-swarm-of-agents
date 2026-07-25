# PRD: Delta Billing Demo (Billed Tenant, Per Scope)

Status: Draft (demo branch `feat/delta-billing-demo`)
Owner: Platform / Billing
Related plan: `.cursor/plans/delta_currency_billing_2e17805c.plan.md`

## 1. Summary

Deltas (net-new material evidence changes produced by a governed run) are the
unit of value the platform sells. This demo turns deltas into a billable
currency ("delta-tokens") and shows two paying tenants, each running five
scopes, billed under a hybrid **prepaid + overage** model. One tenant stays
within its plan; the other deliberately "explodes" its subscription deep into
overage. A per-tenant / per-scope Grafana board makes the value flow, balances,
and the overage breach visible.

Billing runs on a **local, Metronome-shaped simulator** so the demo is fully
self-contained (no external accounts). The metering provider is behind an
interface so a real Metronome/Stripe provider can drop in later without
touching the accounting core.

## 2. Goals

- Make each demo's deltas an auditable, billable currency attributed to the
  correct `(tenant, scope)`.
- Fix the current re-emit-every-cycle double-count by billing only **net-new**
  material deltas versus the last-billed evidence snapshot.
- Demonstrate a hybrid plan: prepaid balance burns down first, then overage is
  metered at a per-token rate.
- Show a realistic "exploding subscription": a small plan driven hard goes far
  into overage, flagged on the dashboard.
- Keep it reproducible: one command seeds and drives the whole scenario.

## 3. Non-goals (this demo)

- Real Metronome/Stripe wiring, invoices, payments, checkout, or tax. The
  provider interface is ready but not connected.
- Production key management, webhooks, and nightly reconciliation jobs
  (deferred to the full billing plan).
- Changing the governance gate. Adversarial/high-drift scopes correctly mint
  zero deltas; that behavior is unchanged and out of scope here.

## 4. Personas

- **Tenant admin (buyer).** Purchases a prepaid delta-token plan, wants to see
  remaining balance, burn rate, and any overage before it becomes a surprise
  invoice.
- **Platform operator (seller).** Monitors delta production and revenue across
  all tenants and scopes; needs to spot a tenant heading into overage.
- **Finance / RevOps.** Needs an auditable ledger tying each billed token back
  to the exact `(tenant, scope, epoch, role, dimension, channel)` that produced
  it.

## 5. Delta-token model

- **Billable unit.** One net-new material delta = 1 delta-token. A `weight`
  column is kept on the ledger so pricing can evolve later (e.g. weight by
  `|value|`), but the demo uses weight = 1.
- **Net-new semantics.** After `extractDeltas`, the run diffs the latest
  evidence against the last-billed snapshot per `(role, dimension, channel)`.
  Only material changes (absolute value change above the material threshold, or
  a brand-new key) are appended to the ledger and metered. Re-processing the
  same evidence bills nothing.
- **Channels.** Both `support` and `refutation` deltas count; the channel is
  recorded for reporting. The governance gate already ensures deltas only mint
  on legitimate propagation.
- **Hybrid billing.** Each billable delta burns prepaid balance first; once the
  prepaid balance reaches zero, further deltas are rated as overage at the
  plan's `overage_rate_cents` per token.

## 6. Scenario spec (2 tenants x 5 scopes = 10 scopes)

| Tenant | Plan | Prepaid tokens/period | Overage rate | Scopes | Drive volume | Expected outcome |
|--------|------|----------------------:|-------------:|:------:|:------------:|------------------|
| Meridian Capital | Growth | 1,000 | 5c/token | 5 | normal | Stays within prepaid; healthy burn-down, no overage |
| Orion Advisory | Starter | 150 | 10c/token | 5 | heavy | Billable deltas far exceed 150 -> deep overage ("exploding subscription") |

All ten scopes are driven with the same clean, contradiction-free (low-drift)
corpus so deltas mint reliably. Only the drive volume differs, so the outcome
difference is purely a function of plan size versus usage.

## 7. Data flow

```
drive-billing-demo (per tenant+scope)
  -> rebind hatchery to (tenant, scope)   [runtime-control RPC]
  -> clean low-drift run -> deltas mint    [deltasAgent]
  -> net-new diff vs last-billed snapshot
  -> delta_events ledger (tenant, scope)   [append-only, idempotent]
  -> meteringProvider.ingest               [local simulator]
       -> prepaid burn-down + overage      [tenant_subscriptions, metering_events]
  -> billing metrics exporter -> Prometheus -> Grafana (Delta Billing board)
```

## 8. Functional requirements

1. A migration adds `delta_events`, `billed_delta_snapshot`,
   `tenant_subscriptions`, and `metering_events`.
2. `deltasAgent` computes net-new billable deltas and persists only those to
   `delta_events`, attributed to the active `(tenant, scope, epoch)`.
3. A `MeteringProvider` interface with a `localMeteringProvider` implements
   prepaid burn-down then overage, writing idempotent `metering_events` (one per
   `delta_event`).
4. A new metric `swarm_billable_deltas_total{tenant,scope,channel}` is emitted,
   distinct from the raw `swarm_deltas_extracted_total`.
5. A billing metrics exporter exposes per-tenant/per-scope balance, consumed,
   overage tokens, overage cents, and prepaid plan size.
6. A seed script creates the two tenants, ten scopes, and subscriptions.
7. A driver script rebinds the hatchery per `(tenant, scope)` and drives the
   clean corpus (light for Meridian, heavy for Orion), then prints a per-tenant
   summary.
8. A Grafana board shows per-tenant balance/burn-down and per-scope cost, with
   Orion's overage clearly flagged.

## 9. Acceptance criteria

- One command (`scripts/demo/run-billing-demo.sh`) seeds and drives the full
  scenario.
- `delta_events` shows net-new billable deltas attributed to the correct
  `(tenant, scope)` with no per-cycle double-counting (re-running a scope with
  unchanged evidence adds zero rows).
- Meridian Capital ends within its prepaid balance (overage = 0).
- Orion Advisory ends in overage (billable deltas > 150; overage tokens > 0).
- The Grafana Delta Billing board shows per-tenant balance/burn-down and
  per-scope cost, with Orion's overage panel flagged red.
- PRD and runbook are committed on `feat/delta-billing-demo`.

## 10. Demo script (operator walkthrough)

1. Bring up the stack and observability (`docker compose up -d`, then the
   swarm hatchery in a terminal).
2. Run `scripts/demo/run-billing-demo.sh`.
3. Open the Delta Billing dashboard; select Meridian Capital (green burn-down)
   then Orion Advisory (balance hits zero, overage panel turns red).
4. Show the `delta_events` and `metering_events` ledgers to tie tokens back to
   the runs that produced them.

## 11. Risks and notes

- **Net-new is the crux.** Without it the same evidence bills every cycle;
  Phase 1 (ledger + net-new) must land before metering.
- **Per-scope rebinding is sequential.** Raw event injection attributes to the
  hatchery's active scope, so the driver rebinds and runs each of the ten
  scopes one at a time. Keep per-scope volume small (larger only for Orion) to
  keep the demo fast.
- **Tenant attribution** requires binding scopes to a tenant via the runtime
  lease (`cluster_runtime_lease.active_tenant_id`) plus `setActiveBillingContext`;
  the runtime-control RPC path (hosted by the hatchery) must be up.

## 12. Future work (full billing plan)

- Swap `localMeteringProvider` for a real `metronomeProvider` (ingest, credits,
  customers) invoiced through Stripe.
- Purchase/balance/webhook APIs on the control plane, restricted keys, and
  nightly reconciliation between `delta_events` and the metering platform.
