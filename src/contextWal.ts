import pg from "pg";
import { getPool } from "./db.js";

export interface ContextEvent {
  seq: number;
  ts: string;
  data: Record<string, unknown>;
}

let _tableEnsured = false;

export function _resetTableEnsured(): void {
  _tableEnsured = false;
}

const SCHEMA_REQUIRED_MSG =
  "Table context_events does not exist. Run schema migrations first (e.g. pnpm run ensure-schema or pnpm run swarm:start).";

export async function ensureContextTable(pool?: pg.Pool): Promise<void> {
  if (_tableEnsured) return;
  const p = pool ?? getPool();
  const res = await p.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'context_events'",
  );
  if ((res.rowCount ?? 0) === 0) {
    throw new Error(SCHEMA_REQUIRED_MSG);
  }
  _tableEnsured = true;
}

export async function appendEvent(
  data: Record<string, unknown>,
  pool?: pg.Pool,
): Promise<number> {
  const p = pool ?? getPool();
  await ensureContextTable(p);
  const res = await p.query(
    "INSERT INTO context_events (data) VALUES ($1::jsonb) RETURNING seq",
    [JSON.stringify(data)],
  );
  return parseInt(res.rows[0].seq, 10);
}

export async function tailEvents(
  limit: number = 200,
  pool?: pg.Pool,
): Promise<ContextEvent[]> {
  const p = pool ?? getPool();
  await ensureContextTable(p);
  const res = await p.query(
    "SELECT seq, ts, data FROM context_events ORDER BY seq DESC LIMIT $1",
    [limit],
  );
  return res.rows
    .map((r: any) => ({
      seq: parseInt(r.seq, 10),
      ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
      data: typeof r.data === "string" ? JSON.parse(r.data) : r.data,
    }))
    .reverse();
}

export async function eventsSince(
  afterSeq: number,
  limit: number = 1000,
  pool?: pg.Pool,
): Promise<ContextEvent[]> {
  const p = pool ?? getPool();
  await ensureContextTable(p);
  const res = await p.query(
    "SELECT seq, ts, data FROM context_events WHERE seq > $1 ORDER BY seq ASC LIMIT $2",
    [afterSeq, limit],
  );
  return res.rows.map((r: any) => ({
    seq: parseInt(r.seq, 10),
    ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
    data: typeof r.data === "string" ? JSON.parse(r.data) : r.data,
  }));
}

/** Event types that represent pipeline progress (new content/state). Used so governance rejections do not retrigger facts. */
const PIPELINE_EVENT_TYPES = [
  "bootstrap",
  "state_transition",
  "facts_extracted",
  "drift_analyzed",
  "actions_planned",
  "status_summarized",
];

/**
 *
 * Returns the latest WAL seq among events that represent pipeline progress (not governance decisions).
 * Prevents proposal_rejected from retriggering the facts agent and causing a proposal loop.
 */
export async function getLatestPipelineWalSeq(pool?: pg.Pool): Promise<number> {
  const p = pool ?? getPool();
  await ensureContextTable(p);
  const placeholders = PIPELINE_EVENT_TYPES.map((_, i) => `$${i + 1}`).join(", ");
  const res = await p.query(
    `SELECT seq FROM context_events WHERE data->>'type' IN (${placeholders}) ORDER BY seq DESC LIMIT 1`,
    PIPELINE_EVENT_TYPES,
  );
  if (!res.rowCount || !res.rows[0]) return 0;
  return parseInt(res.rows[0].seq, 10);
}

/**
 * Latest WAL seq for facts agent: new context (bootstrap, context_doc, resolution) or cycle wrap
 * (state_transition to DeltasExtracted). So facts run when new docs arrive and when we complete
 * a full cycle, allowing it to propose DeltasExtracted → ContextIngested. Other state_transitions
 * are ignored so governance rejections do not retrigger facts.
 */
export async function getLatestPipelineWalSeqForFacts(pool?: pg.Pool): Promise<number> {
  const p = pool ?? getPool();
  await ensureContextTable(p);
  const res = await p.query(
    `SELECT seq FROM context_events
     WHERE (data->>'type' IN ('bootstrap','context_doc','resolution'))
        OR (data->>'type' = 'state_transition' AND data->'payload'->>'to' = 'DeltasExtracted')
     ORDER BY seq DESC LIMIT 1`,
  );
  if (!res.rowCount || !res.rows[0]) return 0;
  return parseInt(res.rows[0].seq, 10);
}
