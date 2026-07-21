/**
 * Document ingestion progress for Studio (context_doc WAL → facts extracted).
 */
import { getPool } from "./db.js";
import { markContextDocsAnalyzed } from "./factsToSemanticGraph.js";

export type DocProcessingStatus =
  | "processed"
  | "processing"
  | "pending"
  | "stalled";

export type ScopeDocumentRow = {
  seq: number;
  title: string;
  ingested_at: string;
  source: string;
  status: DocProcessingStatus;
};

export type ScopeDocumentProgress = {
  total: number;
  processed: number;
  processing: number;
  pending: number;
  stalled: number;
};

const STALL_MS = 8 * 60 * 1000;
const SWARM_IDLE_NODES = new Set([
  "DriftChecked",
  "NearFinality",
  "Resolved",
  "Escalated",
  "ContextIngested",
]);

export function normalizeDocTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\.[^.]+$/i, "")
    .replace(/\s+/g, " ");
}

export function assignDocumentStatuses(
  docs: Array<Omit<ScopeDocumentRow, "status">>,
  processedKeys: Set<string>,
  opts?: {
    claimCount?: number;
    swarmLastNode?: string;
    swarmUpdatedAt?: Date | null;
    now?: number;
  },
): { documents: ScopeDocumentRow[]; progress: ScopeDocumentProgress } {
  const ordered = [...docs].sort((a, b) => a.seq - b.seq);
  const now = opts?.now ?? Date.now();
  const claimCount = opts?.claimCount ?? 0;
  const swarmUpdatedAt = opts?.swarmUpdatedAt ?? null;
  const swarmLastNode = opts?.swarmLastNode;
  const swarmIdle =
    swarmLastNode != null &&
    (SWARM_IDLE_NODES.has(String(swarmLastNode)) ||
      (swarmUpdatedAt != null && now - swarmUpdatedAt.getTime() > 120_000));

  let firstPendingIdx = -1;
  const withStatus: ScopeDocumentRow[] = ordered.map((doc, idx) => {
    const key = normalizeDocTitle(doc.title);
    const processed =
      processedKeys.has(key) || processedKeys.has(`seq:${doc.seq}`);
    if (!processed && firstPendingIdx === -1) firstPendingIdx = idx;
    return { ...doc, status: processed ? "processed" : "pending" };
  });

  if (firstPendingIdx >= 0) {
    const doc = withStatus[firstPendingIdx];
    const ageMs = now - new Date(doc.ingested_at).getTime();
    if (
      claimCount === 0 &&
      Number.isFinite(ageMs) &&
      ageMs >= STALL_MS &&
      swarmIdle
    ) {
      doc.status = "stalled";
    } else if (claimCount > 0 && swarmIdle) {
      doc.status = "stalled";
    } else {
      doc.status = "processing";
    }
  }

  const processed = withStatus.filter((d) => d.status === "processed").length;
  const processing = withStatus.filter((d) => d.status === "processing").length;
  const stalled = withStatus.filter((d) => d.status === "stalled").length;
  const pending = withStatus.filter((d) => d.status === "pending").length;

  return {
    documents: withStatus.sort((a, b) => b.seq - a.seq),
    progress: {
      total: withStatus.length,
      processed,
      processing,
      pending,
      stalled,
    },
  };
}

async function inferBatchProcessedKeys(
  scopeId: string,
  docs: Array<Omit<ScopeDocumentRow, "status">>,
): Promise<Set<string>> {
  const keys = new Set<string>();
  if (docs.length === 0) return keys;

  const pool = getPool();
  const [claimRes, swarmRes] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS n FROM nodes
       WHERE scope_id = $1 AND type = 'claim' AND created_by = 'facts-sync'
         AND superseded_at IS NULL AND status = 'active'`,
      [scopeId],
    ),
    pool.query(
      `SELECT last_node, updated_at FROM swarm_state WHERE scope_id = $1`,
      [scopeId],
    ),
  ]);
  const claimCount = Number(claimRes.rows[0]?.n ?? 0);
  if (claimCount === 0) return keys;

  const swarmRow = swarmRes.rows[0] as
    | { last_node?: string; updated_at?: Date }
    | undefined;
  const swarmUpdatedAt = swarmRow?.updated_at
    ? new Date(swarmRow.updated_at)
    : null;
  if (!swarmUpdatedAt) return keys;

  const ordered = [...docs].sort((a, b) => a.seq - b.seq);
  const ingestSpread =
    ordered.length > 1
      ? new Date(ordered[ordered.length - 1].ingested_at).getTime() -
        new Date(ordered[0].ingested_at).getTime()
      : 0;
  const batchLoad = ingestSpread <= 5000;
  const firstIngest = new Date(ordered[0].ingested_at).getTime();
  if (!batchLoad || firstIngest > swarmUpdatedAt.getTime()) return keys;

  for (const doc of ordered) {
    keys.add(`seq:${doc.seq}`);
    keys.add(normalizeDocTitle(doc.title));
  }

  try {
    const claimRes = await pool.query(
      `SELECT node_id FROM nodes
       WHERE scope_id = $1 AND type = 'claim' AND created_by = 'facts-sync'
         AND superseded_at IS NULL AND status = 'active'`,
      [scopeId],
    );
    const claimIds = claimRes.rows.map((row: { node_id: string }) =>
      String(row.node_id),
    );
    await markContextDocsAnalyzed(
      scopeId,
      ordered.map((d) => ({ title: d.title, contextSeq: d.seq })),
      claimIds,
      { attachClaimsToAll: true },
    );
  } catch {
    /* progress inference still works for this response */
  }

  return keys;
}

export async function listScopeDocumentProgress(scopeId: string): Promise<{
  documents: ScopeDocumentRow[];
  progress: ScopeDocumentProgress;
}> {
  const pool = getPool();
  const docsRes = await pool.query(
    `SELECT seq, ts, data
     FROM context_events
     WHERE data->>'type' = 'context_doc'
       AND COALESCE(data->'payload'->>'scope_id', data->>'scope_id') = $1
     ORDER BY seq ASC`,
    [scopeId],
  );

  const docs = docsRes.rows.map((row) => {
    const data = row.data as Record<string, unknown>;
    const payload = (data.payload as Record<string, unknown>) ?? {};
    const title =
      typeof payload.title === "string" ? payload.title : "document";
    const source =
      typeof payload.source === "string" ? payload.source : "studio";
    const ts = row.ts instanceof Date ? row.ts.toISOString() : String(row.ts);
    return {
      seq: Number(row.seq),
      title,
      ingested_at: ts,
      source,
    };
  });

  const nodeRes = await pool.query(
    `SELECT content, metadata
     FROM nodes
     WHERE scope_id = $1
       AND type = 'doc'
       AND superseded_at IS NULL
       AND status = 'active'`,
    [scopeId],
  );

  const processedKeys = new Set<string>();
  for (const row of nodeRes.rows as Array<{
    content: string;
    metadata: Record<string, unknown> | null;
  }>) {
    processedKeys.add(normalizeDocTitle(String(row.content || "")));
    const seq = row.metadata?.context_seq;
    if (typeof seq === "number") processedKeys.add(`seq:${seq}`);
  }

  if (processedKeys.size === 0 && docs.length > 0) {
    const inferred = await inferBatchProcessedKeys(scopeId, docs);
    for (const key of inferred) processedKeys.add(key);
  }

  const claimRes = await pool.query(
    `SELECT count(*)::int AS n FROM nodes
     WHERE scope_id = $1 AND type = 'claim' AND created_by = 'facts-sync'
       AND superseded_at IS NULL AND status = 'active'`,
    [scopeId],
  );
  const swarmRes = await pool.query(
    `SELECT last_node, updated_at FROM swarm_state WHERE scope_id = $1`,
    [scopeId],
  );
  const swarmRow = swarmRes.rows[0] as
    | { last_node?: string; updated_at?: Date }
    | undefined;

  return assignDocumentStatuses(docs, processedKeys, {
    claimCount: Number(claimRes.rows[0]?.n ?? 0),
    swarmLastNode: swarmRow?.last_node ? String(swarmRow.last_node) : undefined,
    swarmUpdatedAt: swarmRow?.updated_at ? new Date(swarmRow.updated_at) : null,
  });
}
