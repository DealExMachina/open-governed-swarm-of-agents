/**
 * Seed the delta billing demo: 2 tenants, 10 scopes (5 each), subscriptions.
 *
 *   Meridian Capital - Growth plan, 1000 prepaid tokens (stays within budget)
 *   Orion Advisory   - Starter plan, 150 prepaid tokens (explodes into overage)
 *
 * Idempotent: safe to re-run. Prints the created tenant ids + scope ids.
 *
 * Usage: pnpm run seed:billing-demo
 */
import "dotenv/config";
import { getPool } from "../../src/db.js";
import { scopeStoragePrefix } from "../../src/scopeStorage.js";
import {
  BILLING_TENANTS,
  scopeIdsForTenant,
  type BillingTenantConfig,
} from "./billing-demo-config.js";

async function upsertTenant(t: BillingTenantConfig): Promise<string> {
  const pool = getPool();
  // Tenants have no unique(name); look up first for idempotency.
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM tenants WHERE name = $1 ORDER BY created_at ASC LIMIT 1`,
    [t.name],
  );
  let tenantId: string;
  if (existing.rows[0]) {
    tenantId = existing.rows[0].id;
  } else {
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO tenants (name, status) VALUES ($1, 'active') RETURNING id`,
      [t.name],
    );
    tenantId = ins.rows[0].id;
  }

  // Subscription (hybrid prepaid + overage).
  await pool.query(
    `INSERT INTO tenant_subscriptions
       (tenant_id, plan_name, prepaid_tokens, overage_rate_cents, period_start, period_end)
     VALUES ($1, $2, $3, $4, now(), now() + interval '30 days')
     ON CONFLICT (tenant_id) DO UPDATE SET
       plan_name = EXCLUDED.plan_name,
       prepaid_tokens = EXCLUDED.prepaid_tokens,
       overage_rate_cents = EXCLUDED.overage_rate_cents,
       updated_at = now()`,
    [tenantId, t.planName, t.prepaidTokens, t.overageRateCents],
  );

  // Control-plane scopes for this tenant.
  const scopeIds = scopeIdsForTenant(t);
  for (let i = 0; i < scopeIds.length; i++) {
    const id = scopeIds[i];
    await pool.query(
      `INSERT INTO cp_scopes (id, tenant_id, slug, display_name, status, storage_prefix)
       VALUES ($1, $2, $3, $4, 'idle', $5)
       ON CONFLICT (id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         display_name = EXCLUDED.display_name,
         updated_at = now()`,
      [
        id,
        tenantId,
        id,
        `${t.name} - Scope ${i + 1}`,
        scopeStoragePrefix(id),
      ],
    );
  }

  return tenantId;
}

async function main(): Promise<void> {
  const pool = getPool();
  console.log("Seeding delta billing demo (2 tenants x 5 scopes)...\n");

  for (const t of BILLING_TENANTS) {
    const tenantId = await upsertTenant(t);
    const scopeIds = scopeIdsForTenant(t);
    console.log(`Tenant: ${t.name}`);
    console.log(`  id       : ${tenantId}`);
    console.log(`  plan     : ${t.planName} (${t.prepaidTokens} prepaid tokens, ${t.overageRateCents}c/token overage)`);
    console.log(`  scopes   : ${scopeIds.join(", ")}`);
    console.log(`  docs/scope: ${t.docsPerScope}\n`);
  }

  console.log("Seed complete. Drive the scenario with: pnpm run drive:billing-demo");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
