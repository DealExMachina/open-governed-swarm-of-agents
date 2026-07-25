/**
 * Local, self-contained metering simulator (Metronome-shaped).
 *
 * Applies each billable delta against the tenant's plan: prepaid balance burns
 * down first, then overage is rated at the plan's per-token rate. Writes one
 * idempotent `metering_events` row per `delta_events` row. No external service.
 */
import type pg from "pg";
import { getPool, runInTransaction } from "../db.js";
import { logger } from "../logger.js";
import type {
  DeltaEventForMetering,
  MeteringProvider,
  OverageSummary,
  TenantBalance,
  UsageSummary,
} from "./meteringProvider.js";

export class LocalMeteringProvider implements MeteringProvider {
  readonly name = "local";

  async ingestDeltaEvent(
    evt: DeltaEventForMetering,
    pool?: pg.Pool,
  ): Promise<void> {
    if (!evt.tenantId) return; // no tenant => not billable (still produced)
    const p = pool ?? getPool();
    await runInTransaction(async (client) => {
      // Idempotent: skip if this delta was already metered.
      const existing = await client.query(
        `SELECT 1 FROM metering_events WHERE delta_event_id = $1`,
        [evt.id],
      );
      if ((existing.rowCount ?? 0) > 0) return;

      // Lock the subscription row so concurrent ingests compute consumption serially.
      const sub = await client.query<{
        prepaid_tokens: string;
        overage_rate_cents: number;
      }>(
        `SELECT prepaid_tokens, overage_rate_cents
         FROM tenant_subscriptions
         WHERE tenant_id = $1
         FOR UPDATE`,
        [evt.tenantId],
      );
      if (sub.rows.length === 0) {
        // No plan: record the delta as pure overage at rate 0 so usage is still
        // visible but nothing is charged.
        await client.query(
          `INSERT INTO metering_events
             (delta_event_id, tenant_id, scope_id, tokens, prepaid_applied, overage_applied, overage_cents, billed_against)
           VALUES ($1, $2, $3, $4, 0, $4, 0, 'overage')
           ON CONFLICT (delta_event_id) DO NOTHING`,
          [evt.id, evt.tenantId, evt.scopeId, evt.tokens],
        );
        return;
      }

      const prepaidTokens = Number(sub.rows[0].prepaid_tokens);
      const overageRateCents = Number(sub.rows[0].overage_rate_cents);

      const consumedRes = await client.query<{ consumed: string }>(
        `SELECT COALESCE(SUM(prepaid_applied), 0) AS consumed
         FROM metering_events
         WHERE tenant_id = $1`,
        [evt.tenantId],
      );
      const consumed = Number(consumedRes.rows[0]?.consumed ?? 0);
      const remaining = Math.max(0, prepaidTokens - consumed);

      const prepaidApplied = Math.min(evt.tokens, remaining);
      const overageApplied = evt.tokens - prepaidApplied;
      const overageCents = overageApplied * overageRateCents;
      const billedAgainst = overageApplied > 0 ? "overage" : "prepaid";

      await client.query(
        `INSERT INTO metering_events
           (delta_event_id, tenant_id, scope_id, tokens, prepaid_applied, overage_applied, overage_cents, billed_against)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (delta_event_id) DO NOTHING`,
        [
          evt.id,
          evt.tenantId,
          evt.scopeId,
          evt.tokens,
          prepaidApplied,
          overageApplied,
          overageCents,
          billedAgainst,
        ],
      );
    }, p);
  }

  async getBalance(
    tenantId: string,
    pool?: pg.Pool,
  ): Promise<TenantBalance | null> {
    const p = pool ?? getPool();
    const res = await p.query<{
      plan_name: string;
      prepaid_tokens: string;
      consumed: string;
      overage_tokens: string;
      overage_cents: string;
    }>(
      `SELECT s.plan_name,
              s.prepaid_tokens,
              COALESCE(SUM(m.prepaid_applied), 0) AS consumed,
              COALESCE(SUM(m.overage_applied), 0) AS overage_tokens,
              COALESCE(SUM(m.overage_cents), 0)   AS overage_cents
       FROM tenant_subscriptions s
       LEFT JOIN metering_events m ON m.tenant_id = s.tenant_id
       WHERE s.tenant_id = $1
       GROUP BY s.plan_name, s.prepaid_tokens`,
      [tenantId],
    );
    const row = res.rows[0];
    if (!row) return null;
    const prepaidTokens = Number(row.prepaid_tokens);
    const consumedTokens = Number(row.consumed);
    return {
      tenantId,
      planName: row.plan_name,
      prepaidTokens,
      consumedTokens,
      remainingTokens: Math.max(0, prepaidTokens - consumedTokens),
      overageTokens: Number(row.overage_tokens),
      overageCents: Number(row.overage_cents),
    };
  }

  async getOverage(tenantId: string, pool?: pg.Pool): Promise<OverageSummary> {
    const p = pool ?? getPool();
    const res = await p.query<{ tokens: string; cents: string }>(
      `SELECT COALESCE(SUM(overage_applied), 0) AS tokens,
              COALESCE(SUM(overage_cents), 0)   AS cents
       FROM metering_events
       WHERE tenant_id = $1`,
      [tenantId],
    );
    return {
      overageTokens: Number(res.rows[0]?.tokens ?? 0),
      overageCents: Number(res.rows[0]?.cents ?? 0),
    };
  }

  async getUsage(
    tenantId: string,
    scopeId?: string,
    pool?: pg.Pool,
  ): Promise<UsageSummary> {
    const p = pool ?? getPool();
    const res = scopeId
      ? await p.query<{ n: string }>(
          `SELECT COUNT(*) AS n FROM delta_events WHERE tenant_id = $1 AND scope_id = $2`,
          [tenantId, scopeId],
        )
      : await p.query<{ n: string }>(
          `SELECT COUNT(*) AS n FROM delta_events WHERE tenant_id = $1`,
          [tenantId],
        );
    return { billableDeltas: Number(res.rows[0]?.n ?? 0) };
  }
}

/** Convenience wrapper used by the ledger; swallows metering errors so a
 * billing hiccup never breaks the agent pipeline. */
export async function safeIngest(
  provider: MeteringProvider,
  evt: DeltaEventForMetering,
  pool?: pg.Pool,
): Promise<void> {
  try {
    await provider.ingestDeltaEvent(evt, pool);
  } catch (e) {
    logger.warn("metering_ingest_failed", {
      delta_event_id: evt.id,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
