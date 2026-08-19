import pg from "pg";
import { getPool } from "../db.js";
import type {
  AppendEdgeInput,
  QueryEdgesOptions,
  SemanticEdge,
} from "./types.js";
import {
  buildEdgeViewCondition,
  CURRENT_VIEW_EDGES,
  type Queryable,
} from "./view.js";

export async function appendEdge(
  input: AppendEdgeInput,
  client?: pg.PoolClient,
): Promise<string> {
  const p: Queryable = client ?? getPool();
  const hasBitemporal =
    input.valid_from !== undefined || input.valid_to !== undefined;
  const validFrom = input.valid_from ?? null;
  const validTo = input.valid_to ?? null;
  if (hasBitemporal) {
    const res = await p.query(
      `INSERT INTO edges (scope_id, source_id, target_id, edge_type, weight, metadata, created_by, valid_from, valid_to)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::timestamptz, $9::timestamptz)
       RETURNING edge_id`,
      [
        input.scope_id,
        input.source_id,
        input.target_id,
        input.edge_type,
        input.weight ?? 1.0,
        JSON.stringify(input.metadata ?? {}),
        input.created_by ?? null,
        validFrom,
        validTo,
      ],
    );
    return res.rows[0].edge_id;
  }
  const res = await p.query(
    `INSERT INTO edges (scope_id, source_id, target_id, edge_type, weight, metadata, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     RETURNING edge_id`,
    [
      input.scope_id,
      input.source_id,
      input.target_id,
      input.edge_type,
      input.weight ?? 1.0,
      JSON.stringify(input.metadata ?? {}),
      input.created_by ?? null,
    ],
  );
  return res.rows[0].edge_id;
}

/**
 * Append-over-update: mark the current edge row as superseded.
 * Requires migration 011.
 */
export async function supersedeEdge(
  scopeId: string,
  edgeId: string,
  client?: pg.PoolClient,
): Promise<number> {
  const q: Queryable = client ?? getPool();
  const res = await q.query(
    `UPDATE edges SET superseded_at = now() WHERE scope_id = $1 AND edge_id = $2 AND superseded_at IS NULL`,
    [scopeId, edgeId],
  );
  return res.rowCount ?? 0;
}

export async function queryEdges(
  opts: QueryEdgesOptions,
): Promise<SemanticEdge[]> {
  const p = getPool();
  const conditions: string[] = ["scope_id = $1"];
  const params: unknown[] = [opts.scope_id];
  let i = 2;
  if (opts.edge_type) {
    conditions.push(`edge_type = $${i++}`);
    params.push(opts.edge_type);
  }
  if (opts.source_id) {
    conditions.push(`source_id = $${i++}`);
    params.push(opts.source_id);
  }
  if (opts.target_id) {
    conditions.push(`target_id = $${i++}`);
    params.push(opts.target_id);
  }
  const edgeView = buildEdgeViewCondition(opts, params, i);
  i = edgeView.nextIdx;
  conditions.push(edgeView.clause);
  const limit = Math.min(opts.limit ?? 500, 5000);
  params.push(limit);
  const res = await p.query(
    `SELECT edge_id, scope_id, source_id, target_id, edge_type, weight, metadata, created_at, created_by
     FROM edges WHERE ${conditions.join(" AND ")}
     ORDER BY created_at DESC LIMIT $${i}`,
    params,
  );
  return res.rows.map((r) => ({
    edge_id: r.edge_id,
    scope_id: r.scope_id,
    source_id: r.source_id,
    target_id: r.target_id,
    edge_type: r.edge_type,
    weight: Number(r.weight),
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.created_at,
    created_by: r.created_by,
  }));
}

/** Check if a resolving edge exists for either side of a contradiction pair. */
export async function hasResolvingEdge(
  scopeId: string,
  sourceId: string,
  targetId: string,
  client?: pg.PoolClient,
): Promise<boolean> {
  const q: Queryable = client ?? getPool();
  const res = await q.query(
    `SELECT 1 FROM edges
     WHERE scope_id = $1 AND edge_type = 'resolves' AND (${CURRENT_VIEW_EDGES})
     AND (target_id = $2 OR target_id = $3)
     LIMIT 1`,
    [scopeId, sourceId, targetId],
  );
  return (res.rowCount ?? 0) > 0;
}
