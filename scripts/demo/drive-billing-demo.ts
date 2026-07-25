/**
 * Drive the delta billing demo per (tenant, scope).
 *
 * Two modes (env DRIVE_MODE):
 *   - synthetic (default): deterministically mint net-new billable deltas so the
 *     outcome is reproducible without a running swarm or model. Meridian stays
 *     within its plan; Orion blows deep into overage.
 *   - real: rebind the hatchery to each (tenant, scope), reset it, and drive the
 *     clean contradiction-free corpus so the actual agent pipeline mints deltas.
 *     Outcome depends on the model and number of cycles.
 *
 * Idempotent: by default (BILLING_DEMO_RESET=1) it clears prior billing rows for
 * the demo scopes so re-runs produce the same result.
 *
 * Usage:
 *   pnpm run drive:billing-demo               # synthetic (guaranteed explode)
 *   DRIVE_MODE=real pnpm run drive:billing-demo
 */
import "dotenv/config";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getPool } from "../../src/db.js";
import { initTelemetry, shutdownTelemetry } from "../../src/telemetry.js";
import { recordBillableDeltas } from "../../src/billing/deltaLedger.js";
import { getMeteringProvider } from "../../src/billing/meteringProvider.js";
import { startBillingMetricsExporter } from "../../src/billing/metricsExporter.js";
import { requestRuntimeControl } from "../../src/runtimeControlRpc.js";
import { resetScopeAndReinit } from "../../src/scopeReset.js";
import { scopeStoragePrefix } from "../../src/scopeStorage.js";
import { makeS3 } from "../../src/s3.js";
import { makeEventBus } from "../../src/eventBus.js";
import { appendEvent } from "../../src/contextWal.js";
import { createSwarmEvent } from "../../src/events.js";
import {
  BILLING_TENANTS,
  scopeIdsForTenant,
  type BillingTenantConfig,
} from "./billing-demo-config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLEAN_DOCS_DIR = join(
  __dirname,
  "..",
  "..",
  "demo",
  "scenario",
  "docs-basic-example",
);

const DRIVE_MODE = (process.env.DRIVE_MODE ?? "synthetic").toLowerCase();
const RESET = process.env.BILLING_DEMO_RESET ?? "1";
const PUSH_METRICS = (process.env.PUSH_METRICS ?? "1") === "1";
const REAL_DELAY_MS = parseInt(process.env.DEMO_DELAY_MS ?? "8000", 10);
const REAL_WAIT_MS = parseInt(process.env.BILLING_REAL_WAIT_MS ?? "20000", 10);

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface ResolvedTenant {
  config: BillingTenantConfig;
  tenantId: string;
  scopeIds: string[];
}

async function resolveTenants(): Promise<ResolvedTenant[]> {
  const pool = getPool();
  const out: ResolvedTenant[] = [];
  for (const config of BILLING_TENANTS) {
    const res = await pool.query<{ id: string }>(
      `SELECT id FROM tenants WHERE name = $1 ORDER BY created_at ASC LIMIT 1`,
      [config.name],
    );
    const tenantId = res.rows[0]?.id;
    if (!tenantId) {
      throw new Error(
        `Tenant "${config.name}" not found. Run: pnpm run seed:billing-demo`,
      );
    }
    out.push({ config, tenantId, scopeIds: scopeIdsForTenant(config) });
  }
  return out;
}

async function resetBillingState(scopeIds: string[]): Promise<void> {
  const pool = getPool();
  // metering_events cascades from delta_events; delete explicitly for clarity.
  await pool.query(`DELETE FROM metering_events WHERE scope_id = ANY($1)`, [
    scopeIds,
  ]);
  await pool.query(`DELETE FROM delta_events WHERE scope_id = ANY($1)`, [
    scopeIds,
  ]);
  await pool.query(`DELETE FROM billed_delta_snapshot WHERE scope_id = ANY($1)`, [
    scopeIds,
  ]);
}

/** Deterministically mint `target` net-new billable deltas for a scope. */
async function mintSynthetic(
  tenantId: string,
  scopeId: string,
  target: number,
): Promise<number> {
  const KEYS_PER_EPOCH = 10;
  let minted = 0;
  let epoch = 1;
  while (minted < target) {
    const now = new Date().toISOString();
    const batch = [];
    for (let k = 0; k < KEYS_PER_EPOCH && minted < target; k++, minted++) {
      batch.push({
        role_id: `agent_${k}`,
        dimension: "d0",
        channel: k % 2 === 0 ? "support" : "refutation",
        // Bump value each epoch beyond the net-new threshold so every epoch bills.
        value: 0.1 + epoch * 0.2,
        v_time: { start: now, end: null as string | null },
        t_time: now,
      });
    }
    await recordBillableDeltas(tenantId, scopeId, epoch, batch);
    epoch++;
  }
  return minted;
}

async function driveRealScope(
  tenantId: string,
  scopeId: string,
  docsPerScope: number,
): Promise<void> {
  const pool = getPool();
  const bucket = process.env.S3_BUCKET;
  await resetScopeAndReinit(pool, scopeId, {
    s3: bucket && process.env.S3_ENDPOINT ? makeS3() : undefined,
    bucket: bucket ?? undefined,
    storagePrefix: scopeStoragePrefix(scopeId),
  });

  const rpc = await requestRuntimeControl({
    action: "start",
    scope_id: scopeId,
    tenant_id: tenantId,
  });
  if (!rpc.ok) {
    console.warn(
      `  [real] hatchery rebind failed for ${scopeId}: ${rpc.error}. Start it: pnpm run swarm:start`,
    );
  }

  const files = readdirSync(CLEAN_DOCS_DIR)
    .filter((f) => f.endsWith(".txt"))
    .sort();
  const bus = await makeEventBus();
  for (let i = 0; i < docsPerScope; i++) {
    const file = files[i % files.length];
    const text = readFileSync(join(CLEAN_DOCS_DIR, file), "utf-8");
    const event = createSwarmEvent(
      "context_doc",
      {
        text,
        title: file.replace(".txt", ""),
        filename: file,
        source: "billing-demo",
        scope_id: scopeId,
      },
      { source: "drive-billing-demo" },
    );
    const seq = await appendEvent(event as unknown as Record<string, unknown>);
    await bus.publish("swarm.context", { seq, ...event });
    if (i < docsPerScope - 1) await delay(REAL_DELAY_MS);
  }
  await bus.close();
  // Give the pipeline time to propagate and extract deltas.
  await delay(REAL_WAIT_MS);
}

async function printSummary(tenants: ResolvedTenant[]): Promise<void> {
  const provider = getMeteringProvider();
  console.log("\n=== Delta Billing Demo — Per-Tenant Summary ===\n");
  for (const t of tenants) {
    const bal = await provider.getBalance(t.tenantId);
    if (!bal) {
      console.log(`${t.config.name}: no subscription found`);
      continue;
    }
    const status = bal.overageTokens > 0 ? "OVERAGE (exploded)" : "within plan";
    console.log(`${t.config.name}  [${bal.planName}]  ->  ${status}`);
    console.log(`  prepaid plan     : ${bal.prepaidTokens} tokens`);
    console.log(`  consumed         : ${bal.consumedTokens} tokens`);
    console.log(`  balance remaining: ${bal.remainingTokens} tokens`);
    console.log(`  overage tokens   : ${bal.overageTokens}`);
    console.log(
      `  overage cost     : $${(bal.overageCents / 100).toFixed(2)}\n`,
    );
  }
}

async function main(): Promise<void> {
  // Init telemetry before minting so the billable-delta counter and billing
  // gauges are exported to the collector -> Prometheus -> Grafana, even without
  // the hatchery running (self-contained synthetic demo).
  if (PUSH_METRICS) {
    initTelemetry();
    startBillingMetricsExporter();
  }

  const pool = getPool();
  const tenants = await resolveTenants();
  const allScopes = tenants.flatMap((t) => t.scopeIds);

  console.log(`Driving delta billing demo (mode=${DRIVE_MODE})...\n`);

  if (RESET === "1") {
    console.log(`Clearing prior billing state for ${allScopes.length} scopes...`);
    await resetBillingState(allScopes);
  }

  for (const t of tenants) {
    console.log(`\nTenant: ${t.config.name} (${t.scopeIds.length} scopes)`);
    for (const scopeId of t.scopeIds) {
      if (DRIVE_MODE === "real") {
        // Real mode rebinds the hatchery to (tenant, scope) inside driveRealScope.
        console.log(`  [real] driving ${scopeId} (${t.config.docsPerScope} docs)`);
        await driveRealScope(t.tenantId, scopeId, t.config.docsPerScope);
      } else {
        const n = await mintSynthetic(
          t.tenantId,
          scopeId,
          t.config.syntheticDeltasPerScope,
        );
        console.log(`  [synthetic] ${scopeId}: minted ${n} billable deltas`);
      }
    }
  }

  await printSummary(tenants);

  if (PUSH_METRICS) {
    // Let the periodic reader push at least once, then flush on shutdown so
    // Prometheus can scrape the billing metrics for the dashboard.
    console.log("Flushing billing metrics to the collector...");
    await delay(3000);
    await shutdownTelemetry();
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
