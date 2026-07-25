/**
 * Delta ledger: persist net-new billable deltas and meter them.
 *
 * "Net-new" means the material evidence value for a (role, dimension, channel)
 * changed beyond the material threshold versus the last-billed snapshot (or is
 * brand new). This is the fix for the raw deltasAgent re-emitting every cycle:
 * only genuinely new value is appended to `delta_events` and metered, so the
 * same evidence never bills twice.
 */
import type pg from "pg";
import { getPool, runInTransaction } from "../db.js";
import { logger } from "../logger.js";
import { recordBillableDeltasMetric } from "../metrics.js";
import { getMeteringProvider } from "./meteringProvider.js";
import { safeIngest } from "./localMeteringProvider.js";

/** Structural shape of a delta (compatible with deltasAgent's Delta). */
export interface LedgerDelta {
  role_id: string;
  dimension: string;
  channel: string;
  value: number;
  v_time: { start: string; end: string | null };
  t_time: string;
}

/** Materiality threshold for treating a value change as net-new (billable). */
const BILLABLE_THRESHOLD = Number(
  process.env.BILLABLE_DELTA_THRESHOLD ?? "0.05",
);

export interface RecordBillableResult {
  /** Number of net-new billable deltas persisted this call. */
  billable: number;
  /** Number of candidate deltas considered. */
  considered: number;
}

function snapshotKey(role: string, dimension: string, channel: string): string {
  return `${role}|${dimension}|${channel}`;
}

/**
 * Persist net-new billable deltas for (tenant, scope, epoch) and meter them.
 * Idempotent per (scope, epoch, role, dimension, channel).
 */
export async function recordBillableDeltas(
  tenantId: string | null,
  scopeId: string,
  epoch: number,
  deltas: ReadonlyArray<LedgerDelta>,
  pool?: pg.Pool,
): Promise<RecordBillableResult> {
  const p = pool ?? getPool();
  if (deltas.length === 0) return { billable: 0, considered: 0 };

  // Load the last-billed snapshot for this scope.
  const snapRes = await p.query<{
    role: string;
    dimension: string;
    channel: string;
    value: number;
  }>(
    `SELECT role, dimension, channel, value FROM billed_delta_snapshot WHERE scope_id = $1`,
    [scopeId],
  );
  const snapshot = new Map<string, number>();
  for (const r of snapRes.rows) {
    snapshot.set(snapshotKey(r.role, r.dimension, r.channel), Number(r.value));
  }

  const netNew = deltas.filter((d) => {
    const prev = snapshot.get(snapshotKey(d.role_id, d.dimension, d.channel));
    return prev === undefined || Math.abs(d.value - prev) > BILLABLE_THRESHOLD;
  });
  if (netNew.length === 0) {
    return { billable: 0, considered: deltas.length };
  }

  // Insert net-new deltas + advance snapshot, all in one transaction.
  const inserted: Array<{
    id: number;
    scopeId: string;
    tenantId: string | null;
    channel: string;
    tokens: number;
    timestamp: string;
  }> = [];

  await runInTransaction(async (client) => {
    for (const d of netNew) {
      const weight = 1;
      const ins = await client.query<{ id: number }>(
        `INSERT INTO delta_events
           (tenant_id, scope_id, epoch, role, dimension, channel, value, weight, v_from, v_to, t_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (scope_id, epoch, role, dimension, channel) DO NOTHING
         RETURNING id`,
        [
          tenantId,
          scopeId,
          epoch,
          d.role_id,
          d.dimension,
          d.channel,
          d.value,
          weight,
          d.v_time.start,
          d.v_time.end,
          d.t_time,
        ],
      );
      const row = ins.rows[0];
      if (row) {
        inserted.push({
          id: Number(row.id),
          scopeId,
          tenantId,
          channel: d.channel,
          tokens: weight,
          timestamp: d.t_time,
        });
      }
      // Advance the last-billed snapshot regardless of insert/conflict so a
      // re-run at a higher epoch with the same value is not re-billed.
      await client.query(
        `INSERT INTO billed_delta_snapshot (scope_id, role, dimension, channel, value, epoch)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (scope_id, role, dimension, channel)
         DO UPDATE SET value = EXCLUDED.value, epoch = EXCLUDED.epoch, updated_at = now()`,
        [scopeId, d.role_id, d.dimension, d.channel, d.value, epoch],
      );
    }
  }, p);

  if (inserted.length === 0) {
    return { billable: 0, considered: deltas.length };
  }

  // Meter each freshly inserted billable delta (prepaid burn-down + overage).
  const provider = getMeteringProvider();
  for (const evt of inserted) {
    await safeIngest(
      provider,
      {
        id: evt.id,
        tenantId: evt.tenantId,
        scopeId: evt.scopeId,
        tokens: evt.tokens,
        timestamp: evt.timestamp,
        channel: evt.channel,
      },
      p,
    );
  }

  // Emit the distinct billable-delta metric (separate from raw produced deltas).
  recordBillableDeltasMetric(
    scopeId,
    tenantId,
    inserted.map((e) => ({ channel: e.channel })),
  );

  logger.info("billable_deltas_recorded", {
    scope_id: scopeId,
    tenant_id: tenantId,
    epoch,
    billable: inserted.length,
    considered: deltas.length,
  });

  return { billable: inserted.length, considered: deltas.length };
}
