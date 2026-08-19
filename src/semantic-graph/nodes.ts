import pg from "pg";
import { getPool } from "../db.js";
import type {
  AppendNodeInput,
  QueryNodesOptions,
  SemanticNode,
} from "./types.js";
import {
  buildNodeViewCondition,
  CURRENT_VIEW_NODES,
  type Queryable,
} from "./view.js";

/** Delete nodes (and their edges via FK CASCADE) by scope and created_by. Returns deleted count. */
export async function deleteNodesBySource(
  scopeId: string,
  createdBy: string,
  client?: pg.PoolClient,
): Promise<number> {
  const q = client ?? getPool();
  const res = await q.query(
    "DELETE FROM nodes WHERE scope_id = $1 AND created_by = $2",
    [scopeId, createdBy],
  );
  return res.rowCount ?? 0;
}

export async function appendNode(
  input: AppendNodeInput,
  client?: pg.PoolClient,
): Promise<string> {
  const p: Queryable = client ?? getPool();
  const embeddingParam =
    input.embedding && input.embedding.length > 0
      ? `[${input.embedding.join(",")}]`
      : null;
  const hasBitemporal =
    input.valid_from !== undefined || input.valid_to !== undefined;
  const validFrom = input.valid_from ?? null;
  const validTo = input.valid_to ?? null;
  if (hasBitemporal) {
    const res = await p.query(
      `INSERT INTO nodes (scope_id, type, content, confidence, status, source_ref, metadata, created_by, embedding, valid_from, valid_to)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9::vector, $10::timestamptz, $11::timestamptz)
       RETURNING node_id`,
      [
        input.scope_id,
        input.type,
        input.content,
        input.confidence ?? 1.0,
        input.status ?? "active",
        JSON.stringify(input.source_ref ?? {}),
        JSON.stringify(input.metadata ?? {}),
        input.created_by ?? null,
        embeddingParam,
        validFrom,
        validTo,
      ],
    );
    return res.rows[0].node_id;
  }
  const res = await p.query(
    `INSERT INTO nodes (scope_id, type, content, confidence, status, source_ref, metadata, created_by, embedding)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9::vector)
     RETURNING node_id`,
    [
      input.scope_id,
      input.type,
      input.content,
      input.confidence ?? 1.0,
      input.status ?? "active",
      JSON.stringify(input.source_ref ?? {}),
      JSON.stringify(input.metadata ?? {}),
      input.created_by ?? null,
      embeddingParam,
    ],
  );
  return res.rows[0].node_id;
}

/**
 * Append-over-update: mark the current row as superseded (sets superseded_at).
 * Call this before inserting a new version of the same logical node.
 * No-op if the row is already superseded. Requires migration 011.
 */
export async function supersedeNode(
  scopeId: string,
  nodeId: string,
  client?: pg.PoolClient,
): Promise<number> {
  const q: Queryable = client ?? getPool();
  const res = await q.query(
    `UPDATE nodes SET superseded_at = now() WHERE scope_id = $1 AND node_id = $2 AND superseded_at IS NULL`,
    [scopeId, nodeId],
  );
  return res.rowCount ?? 0;
}

export async function queryNodes(
  opts: QueryNodesOptions,
): Promise<SemanticNode[]> {
  const p = getPool();
  const conditions: string[] = ["scope_id = $1"];
  const params: unknown[] = [opts.scope_id];
  let i = 2;
  if (opts.type) {
    conditions.push(`type = $${i++}`);
    params.push(opts.type);
  }
  if (opts.status) {
    conditions.push(`status = $${i++}`);
    params.push(opts.status);
  }
  const { clause, nextIdx } = buildNodeViewCondition(opts, params, i);
  i = nextIdx;
  conditions.push(clause);
  const limit = Math.min(opts.limit ?? 500, 5000);
  params.push(limit);
  const res = await p.query(
    `SELECT node_id, scope_id, type, content, confidence, status, source_ref, metadata, created_at, updated_at, created_by, version
     FROM nodes WHERE ${conditions.join(" AND ")}
     ORDER BY created_at DESC LIMIT $${i}`,
    params,
  );
  return res.rows.map((r) => ({
    node_id: r.node_id,
    scope_id: r.scope_id,
    type: r.type,
    content: r.content,
    confidence: Number(r.confidence),
    status: r.status,
    source_ref: (r.source_ref as Record<string, unknown>) ?? {},
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.created_at,
    updated_at: r.updated_at,
    created_by: r.created_by,
    version: Number(r.version),
  }));
}

/** Update a node's content (e.g. after an approved equivalence merge). */
export async function updateNodeContent(
  nodeId: string,
  content: string,
  client?: pg.PoolClient,
): Promise<void> {
  const q: Queryable = client ?? getPool();
  await q.query(
    `UPDATE nodes SET content = $2, updated_at = now(), version = version + 1
     WHERE node_id = $1`,
    [nodeId, content],
  );
}

/** Update a node's confidence (monotonic upsert: only if new confidence >= existing). */
export async function updateNodeConfidence(
  nodeId: string,
  confidence: number,
  client?: pg.PoolClient,
): Promise<void> {
  const q: Queryable = client ?? getPool();
  await q.query(
    `UPDATE nodes SET confidence = $2, updated_at = now(), version = version + 1
     WHERE node_id = $1 AND confidence <= $2`,
    [nodeId, confidence],
  );
}

/** Update a node's status. */
export async function updateNodeStatus(
  nodeId: string,
  status: string,
  client?: pg.PoolClient,
): Promise<void> {
  const q: Queryable = client ?? getPool();
  await q.query(
    `UPDATE nodes SET status = $2, updated_at = now(), version = version + 1
     WHERE node_id = $1`,
    [nodeId, status],
  );
}

/** Query nodes by creator, optionally filtered by type. Returns all matching nodes. */
export async function queryNodesByCreator(
  scopeId: string,
  createdBy: string,
  type?: string,
  client?: pg.PoolClient,
): Promise<SemanticNode[]> {
  const q: Queryable = client ?? getPool();
  const conditions = ["scope_id = $1", "created_by = $2"];
  const params: unknown[] = [scopeId, createdBy];
  if (type) {
    conditions.push("type = $3");
    params.push(type);
  }
  conditions.push(`(${CURRENT_VIEW_NODES})`);
  const res = await q.query(
    `SELECT node_id, scope_id, type, content, confidence, status, source_ref, metadata, created_at, updated_at, created_by, version
     FROM nodes WHERE ${conditions.join(" AND ")}
     ORDER BY created_at ASC`,
    params,
  );
  return res.rows.map((r) => ({
    node_id: r.node_id,
    scope_id: r.scope_id,
    type: r.type,
    content: r.content,
    confidence: Number(r.confidence),
    status: r.status,
    source_ref: (r.source_ref as Record<string, unknown>) ?? {},
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.created_at,
    updated_at: r.updated_at,
    created_by: r.created_by,
    version: Number(r.version),
  }));
}
