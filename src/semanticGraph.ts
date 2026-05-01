import pg from "pg";
import { z } from "zod";
import type { FinalitySnapshot } from "./finalityEvaluator.js";
import { getPool } from "./db.js";
import { GoalMatchItemSchema } from "./modelConfig.js";

export interface SemanticNode {
  node_id: string;
  scope_id: string;
  type: string;
  content: string;
  confidence: number;
  status: string;
  source_ref: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  version: number;
}

export interface SemanticEdge {
  edge_id: string;
  scope_id: string;
  source_id: string;
  target_id: string;
  edge_type: string;
  weight: number;
  metadata: Record<string, unknown>;
  created_at: string;
  created_by: string | null;
}

export interface AppendNodeInput {
  scope_id: string;
  type: string;
  content: string;
  confidence?: number;
  status?: string;
  source_ref?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  created_by?: string;
  embedding?: number[] | null;
  /** Bitemporal: valid time interval (optional; null = atemporal). */
  valid_from?: string | null;
  valid_to?: string | null;
}

type Queryable = pg.Pool | pg.PoolClient;

/** Bitemporal "current" view: not superseded and (valid now or open-ended). Use in node/edge SELECTs when migration 011 is applied. */
const CURRENT_VIEW_NODES = "superseded_at IS NULL AND (valid_to IS NULL OR valid_to > now())";
const CURRENT_VIEW_EDGES = "superseded_at IS NULL AND (valid_to IS NULL OR valid_to > now())";

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
  const hasBitemporal = input.valid_from !== undefined || input.valid_to !== undefined;
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

export interface AppendEdgeInput {
  scope_id: string;
  source_id: string;
  target_id: string;
  edge_type: string;
  weight?: number;
  metadata?: Record<string, unknown>;
  created_by?: string;
  /** Bitemporal: valid time interval (optional; null = atemporal). */
  valid_from?: string | null;
  valid_to?: string | null;
}

export async function appendEdge(
  input: AppendEdgeInput,
  client?: pg.PoolClient,
): Promise<string> {
  const p: Queryable = client ?? getPool();
  const hasBitemporal = input.valid_from !== undefined || input.valid_to !== undefined;
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

export interface QueryNodesOptions {
  scope_id: string;
  type?: string;
  status?: string;
  limit?: number;
  /** Time-travel: as-of valid time (ISO). When set, only rows valid at this time. */
  asOfValidTime?: string;
  /** Time-travel: as-of transaction time (ISO). When set, only rows recorded and not superseded at this time. */
  asOfRecordedAt?: string;
}

function buildNodeViewCondition(opts: QueryNodesOptions, params: unknown[], startIdx: number): { clause: string; nextIdx: number } {
  let idx = startIdx;
  if (opts.asOfValidTime || opts.asOfRecordedAt) {
    const parts: string[] = [];
    if (opts.asOfValidTime) {
      parts.push(`valid_from <= $${idx}::timestamptz AND (valid_to IS NULL OR valid_to > $${idx}::timestamptz)`);
      params.push(opts.asOfValidTime);
      idx++;
    }
    if (opts.asOfRecordedAt) {
      parts.push(`recorded_at <= $${idx}::timestamptz AND (superseded_at IS NULL OR superseded_at > $${idx}::timestamptz)`);
      params.push(opts.asOfRecordedAt);
      idx++;
    }
    return { clause: "(" + parts.join(" AND ") + ")", nextIdx: idx };
  }
  return { clause: `(${CURRENT_VIEW_NODES})`, nextIdx: idx };
}

function buildEdgeViewCondition(opts: QueryEdgesOptions, params: unknown[], startIdx: number): { clause: string; nextIdx: number } {
  let idx = startIdx;
  if (opts.asOfValidTime || opts.asOfRecordedAt) {
    const parts: string[] = [];
    if (opts.asOfValidTime) {
      parts.push(`valid_from <= $${idx}::timestamptz AND (valid_to IS NULL OR valid_to > $${idx}::timestamptz)`);
      params.push(opts.asOfValidTime);
      idx++;
    }
    if (opts.asOfRecordedAt) {
      parts.push(`recorded_at <= $${idx}::timestamptz AND (superseded_at IS NULL OR superseded_at > $${idx}::timestamptz)`);
      params.push(opts.asOfRecordedAt);
      idx++;
    }
    return { clause: "(" + parts.join(" AND ") + ")", nextIdx: idx };
  }
  return { clause: `(${CURRENT_VIEW_EDGES})`, nextIdx: idx };
}

export async function queryNodes(opts: QueryNodesOptions): Promise<SemanticNode[]> {
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

export interface QueryEdgesOptions {
  scope_id: string;
  edge_type?: string;
  source_id?: string;
  target_id?: string;
  limit?: number;
  /** Time-travel: as-of valid time (ISO). */
  asOfValidTime?: string;
  /** Time-travel: as-of transaction time (ISO). */
  asOfRecordedAt?: string;
}

export async function queryEdges(opts: QueryEdgesOptions): Promise<SemanticEdge[]> {
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

/**
 * Single-query aggregation for finality evaluation. Returns scope-level aggregates.
 */
export async function loadFinalitySnapshot(scopeId: string): Promise<FinalitySnapshot> {
  const startMs = Date.now();
  try {
    return await loadFinalitySnapshotImpl(scopeId);
  } finally {
    try {
      const { recordSemanticGraphQueryMs } = await import("./metrics.js");
      recordSemanticGraphQueryMs("loadFinalitySnapshot", Date.now() - startMs);
    } catch {
      /* no-op */
    }
  }
}

async function loadFinalitySnapshotImpl(scopeId: string): Promise<FinalitySnapshot> {
  const p = getPool();
  const nodeRes = await p.query(
    `SELECT
       COALESCE(MIN(confidence) FILTER (WHERE type = 'claim' AND status = 'active'), 1) AS claims_active_min_confidence,
       COUNT(*) FILTER (WHERE type = 'claim' AND status = 'active')::int AS claims_active_count,
       COALESCE(AVG(confidence) FILTER (WHERE type = 'claim' AND status = 'active'), 1)::float AS claims_active_avg_confidence,
       COUNT(*) FILTER (WHERE type = 'risk' AND status = 'active' AND (metadata->>'severity') = 'critical')::int AS risks_critical_active_count
     FROM nodes WHERE scope_id = $1 AND (${CURRENT_VIEW_NODES})`,
    [scopeId],
  );
  const row = nodeRes.rows[0] ?? {};

  const claimsCount = Number(row.claims_active_count ?? 0);

  const goalRes = await p.query(
    `SELECT
       COUNT(*) FILTER (WHERE type = 'goal' AND status = 'resolved')::int AS resolved,
       COUNT(*) FILTER (WHERE type = 'goal')::int AS total
     FROM nodes WHERE scope_id = $1 AND (${CURRENT_VIEW_NODES})`,
    [scopeId],
  );
  const goalRow = goalRes.rows[0] ?? {};
  const goalsTotal = Number(goalRow.total ?? 0);
  const goalsCompletionRatio = goalsTotal === 0 ? 1 : Number(goalRow.resolved ?? 0) / goalsTotal;

  if (claimsCount === 0) {
    const evidence_coverage = await getEvidenceCoverageForScope(scopeId, p);
    return {
      claims_active_min_confidence: 0,
      claims_active_count: 0,
      claims_active_avg_confidence: 0,
      contradictions_unresolved_count: 0,
      contradictions_total_count: 0,
      risks_critical_active_count: 0,
      goals_completion_ratio: goalsCompletionRatio,
      scope_risk_score: 0,
      contradiction_mass: 0,
      evidence_coverage,
    };
  }

  const assessmentRes = await p.query(
    `SELECT COALESCE(SUM((metadata->>'risk_delta')::float), 0)::float AS risk_score
     FROM nodes WHERE scope_id = $1 AND type = 'assessment' AND status = 'active' AND (${CURRENT_VIEW_NODES})`,
    [scopeId],
  );
  const scopeRiskScore = Math.min(1, Math.max(0, Number(assessmentRes.rows[0]?.risk_score ?? 0)));

  // Contradiction counts from nodes only (canonical source)
  const contraNodeRes = await p.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'active')::int AS unresolved,
       COUNT(*) FILTER (WHERE status IN ('active', 'resolved'))::int AS total
     FROM nodes
     WHERE scope_id = $1 AND type = 'contradiction' AND (${CURRENT_VIEW_NODES})`,
    [scopeId],
  );
  const contraRow = contraNodeRes.rows[0] ?? {};
  const contradictionsTotal = Number(contraRow.total ?? 0);
  const contradictionsUnresolved = Number(contraRow.unresolved ?? 0);

  // Gate B: contradiction mass (severity weight per unresolved; default 1.0 each).
  const contradiction_mass = contradictionsUnresolved * 1.0;

  // Gate B: evidence coverage from schema (default 1 if no schema or no required types).
  const evidence_coverage = await getEvidenceCoverageForScope(scopeId, p);

  return {
    claims_active_min_confidence: Number(row.claims_active_min_confidence ?? 1),
    claims_active_count: Number(row.claims_active_count ?? 0),
    claims_active_avg_confidence: Number(row.claims_active_avg_confidence ?? 1),
    contradictions_unresolved_count: contradictionsUnresolved,
    contradictions_total_count: contradictionsTotal,
    risks_critical_active_count: Number(row.risks_critical_active_count ?? 0),
    goals_completion_ratio: goalsCompletionRatio,
    scope_risk_score: scopeRiskScore,
    contradiction_mass,
    evidence_coverage,
  };
}

/** Load evidence_schemas and compute coverage ratio for scope (0-1). Returns 1 if no schema. Uses max_age_days for staleness when set. */
async function getEvidenceCoverageForScope(
  scopeId: string,
  p: pg.Pool,
): Promise<number> {
  try {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const { parse: parseYaml } = await import("yaml");
    const path = join(process.cwd(), "evidence_schemas.yaml");
    const raw = readFileSync(path, "utf-8");
    const schemas = parseYaml(raw) as {
      schemas?: Record<string, { evidence_types?: string[]; temporal_constraint?: { max_age_days?: number | null } }>;
    };
    const defaultSchema = schemas?.schemas?.default;
    const required = defaultSchema?.evidence_types ?? [];
    if (required.length === 0) return 1;
    const maxAgeDays = defaultSchema?.temporal_constraint?.max_age_days;
    let sql = `SELECT type, COUNT(*)::int AS c FROM nodes WHERE scope_id = $1 AND (${CURRENT_VIEW_NODES})`;
    const params: unknown[] = [scopeId];
    if (maxAgeDays != null && maxAgeDays > 0) {
      sql += ` AND (valid_to IS NULL OR valid_to >= now() - ($2 || ' days')::interval)`;
      params.push(String(maxAgeDays));
    }
    sql += " GROUP BY type";
    const typeRes = await p.query(sql, params);
    const present = new Set(typeRes.rows.map((r) => String(r.type)));
    const found = required.filter((t) => present.has(t)).length;
    return found / required.length;
  } catch {
    return 1;
  }
}

/** Confidence for human-provided resolutions (treated as authoritative facts). */
const HUMAN_RESOLUTION_CONFIDENCE = 0.95;

/** Parse contradiction content into two sides for "choose A" / "choose B" UI. */
function parseContradictionSides(content: string): [string, string] | null {
  const s = content.trim();
  const nli = /^NLI:\s*"(.*?)"\s+vs\s+"(.*?)"/s.exec(s);
  if (nli) return [nli[1].replace(/\.\.\.$/, "").trim(), nli[2].replace(/\.\.\.$/, "").trim()];
  const contradicts = /^(.*?)\s+contradicts?\s+(.*)$/i.exec(s);
  if (contradicts) return [contradicts[1].trim(), contradicts[2].trim()];
  const versus = /(.+?)\s+(?:versus|vs\.?)\s+(.+)/i.exec(s);
  if (versus) return [versus[1].trim(), versus[2].trim()];
  const butWhile = /(.+?),?\s+(?:but|while|whereas|however)\s+(.+)/i.exec(s);
  if (butWhile) return [butWhile[1].trim(), butWhile[2].trim()];
  return null;
}

export interface UnresolvedContradictionDetail {
  node_id: string;
  content: string;
  side_a?: string;
  side_b?: string;
  related_claims?: string[];
}

/** Load unresolved contradiction details for HITL, resolver, and finality.
 * Canonical source: contradiction nodes with status='active'.
 * For contradicts edges without a matching node, creates the missing node
 * so that all contradictions have a single resolution path via node. */
export async function loadUnresolvedContradictionDetails(
  scopeId: string,
  pool?: pg.Pool,
): Promise<UnresolvedContradictionDetail[]> {
  const p = pool ?? getPool();
  const seenPairs = new Set<string>();

  function pairKey(a: string, b: string): string {
    const [x, y] = [a.trim().toLowerCase(), b.trim().toLowerCase()];
    return x <= y ? `${x}::${y}` : `${y}::${x}`;
  }

  const out: UnresolvedContradictionDetail[] = [];

  const HITL_STOP = new Set([
    "the","and","for","are","was","were","has","have","had","not","but","its",
    "that","this","from","with","they","been","which","into","also","than",
    "will","can","may","who","how","all","any","each","some","such","very",
  ]);
  function hitlSigWords(s: string): Set<string> {
    return new Set(
      s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/)
        .filter((w) => w.length > 2 && !HITL_STOP.has(w))
        .map((w) => (w.length > 6 ? w.slice(0, 6) : w)),
    );
  }
  function isDuplicateContent(candidate: string): boolean {
    const cWords = hitlSigWords(candidate);
    if (cWords.size === 0) return false;
    for (const existing of out) {
      const eWords = hitlSigWords(existing.content);
      let overlap = 0;
      for (const w of cWords) if (eWords.has(w)) overlap++;
      if (overlap / Math.max(cWords.size, eWords.size) >= 0.5) return true;
    }
    return false;
  }

  // 1. Load contradiction nodes (canonical)
  const nodeRes = await p.query(
    `SELECT node_id, content, metadata FROM nodes
     WHERE scope_id = $1 AND type = 'contradiction' AND status = 'active'
     AND superseded_at IS NULL AND (valid_to IS NULL OR valid_to > now())
     ORDER BY created_at DESC LIMIT 20`,
    [scopeId],
  );
  for (const row of nodeRes.rows) {
    const r = row as { node_id: string; content: string; metadata?: { claim_source_id?: string; claim_target_id?: string } };
    if (isDuplicateContent(r.content)) continue;
    const sides = parseContradictionSides(r.content);
    const sa = sides?.[0] ?? "";
    const sb = sides?.[1] ?? "";
    if (sa || sb) seenPairs.add(pairKey(sa, sb));
    let related_claims: string[] | undefined;
    const srcId = (r.metadata as Record<string, unknown> | undefined)?.claim_source_id as string | undefined;
    const tgtId = (r.metadata as Record<string, unknown> | undefined)?.claim_target_id as string | undefined;
    if (srcId && tgtId) {
      const claimRes = await p.query(
        `SELECT content FROM nodes WHERE node_id = ANY($1::uuid[]) AND scope_id = $2`,
        [[srcId, tgtId], scopeId],
      );
      related_claims = claimRes.rows.map((c: { content: string }) => c.content).filter(Boolean);
    }
    out.push({
      node_id: r.node_id,
      content: r.content,
      side_a: sides?.[0],
      side_b: sides?.[1],
      related_claims,
    });
  }

  // 2. Find contradicts edges without a matching node — create missing nodes
  const edgeRes = await p.query(
    `SELECT e.source_id, e.target_id, n1.content AS claim_a, n2.content AS claim_b
     FROM edges e
     JOIN nodes n1 ON n1.node_id = e.source_id AND n1.scope_id = e.scope_id AND n1.superseded_at IS NULL
     JOIN nodes n2 ON n2.node_id = e.target_id AND n2.scope_id = e.scope_id AND n2.superseded_at IS NULL
     WHERE e.scope_id = $1 AND e.edge_type = 'contradicts' AND e.superseded_at IS NULL
     AND (e.valid_to IS NULL OR e.valid_to > now())
     AND (
       (n1.valid_from IS NULL AND n1.valid_to IS NULL) OR (n2.valid_from IS NULL AND n2.valid_to IS NULL)
       OR (n1.valid_from < COALESCE(n2.valid_to, 'infinity'::timestamptz) AND n2.valid_from < COALESCE(n1.valid_to, 'infinity'::timestamptz))
     )
     AND NOT EXISTS (
       SELECT 1 FROM edges r WHERE r.scope_id = e.scope_id AND r.edge_type = 'resolves'
       AND r.superseded_at IS NULL AND (r.valid_to IS NULL OR r.valid_to > now())
       AND (r.target_id = e.source_id OR r.target_id = e.target_id)
     )
     ORDER BY e.created_at DESC LIMIT 20`,
    [scopeId],
  );

  for (const row of edgeRes.rows) {
    const r = row as { source_id: string; target_id: string; claim_a: string; claim_b: string };
    const key = pairKey(r.claim_a || "", r.claim_b || "");
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    const sideA = (r.claim_a || "").trim();
    const sideB = (r.claim_b || "").trim();
    const content = `${sideA} contradicts ${sideB}`;
    if (!content.trim() || content === " contradicts ") continue;

    // Create the missing contradiction node so it becomes the canonical record
    const nodeId = await appendNode({
      scope_id: scopeId,
      type: "contradiction",
      content,
      status: "active",
      source_ref: { source: "edge-backfill" },
      metadata: { claim_source_id: r.source_id, claim_target_id: r.target_id },
      created_by: "edge-backfill",
    });

    if (nodeId) {
      out.push({
        node_id: nodeId,
        content,
        side_a: sideA,
        side_b: sideB,
        related_claims: [sideA, sideB].filter(Boolean),
      });
    }
  }

  return out;
}

export interface ContradictionWithResolution {
  node_id: string;
  content: string;
  status: string;
  side_a?: string;
  side_b?: string;
  resolution?: { by: string; reason: string; resolved_at: string };
}

/** Load all contradiction nodes (active + resolved) with resolution info for narrative/story. */
export async function loadAllContradictionsWithResolutions(
  scopeId: string,
  pool?: pg.Pool,
): Promise<ContradictionWithResolution[]> {
  const p = pool ?? getPool();
  const res = await p.query(
    `SELECT node_id, content, status, source_ref, metadata, updated_at
     FROM nodes WHERE scope_id = $1 AND type = 'contradiction'
     AND superseded_at IS NULL AND (valid_to IS NULL OR valid_to > now())
     ORDER BY created_at ASC`,
    [scopeId],
  );
  return res.rows.map((r: { node_id: string; content: string; status: string; source_ref?: Record<string, unknown> }) => {
    const sides = parseContradictionSides(r.content);
    const src = (r.source_ref as Record<string, unknown> | undefined) ?? {};
    const resolution =
      r.status === "resolved" && (src.resolved_by != null || src.resolution_reason != null)
        ? {
            by: String(src.resolved_by ?? ""),
            reason: String(src.resolution_reason ?? ""),
            resolved_at: String(src.resolved_at ?? ""),
          }
        : undefined;
    return {
      node_id: r.node_id,
      content: r.content,
      status: r.status,
      side_a: sides?.[0],
      side_b: sides?.[1],
      resolution,
    };
  });
}

/**
 * Add human resolution text as a claim (fact) with high confidence.
 * Resolutions are authoritative so they get higher confidence than LLM-extracted claims.
 */
export async function appendResolutionAsClaim(
  scopeId: string,
  decision: string,
  client?: pg.PoolClient,
): Promise<string | null> {
  const trimmed = decision.trim();
  if (!trimmed) return null;
  const q: Queryable = client ?? getPool();
  // Avoid duplicate: resolution content may already exist
  const exist = await q.query(
    `SELECT node_id FROM nodes WHERE scope_id = $1 AND type = 'claim' AND created_by = 'resolution'
     AND content = $2 AND status = 'active' LIMIT 1`,
    [scopeId, trimmed],
  );
  if (exist.rowCount && exist.rows[0]) return (exist.rows[0] as { node_id: string }).node_id;
  return appendNode(
    {
      scope_id: scopeId,
      type: "claim",
      content: trimmed,
      confidence: HUMAN_RESOLUTION_CONFIDENCE,
      status: "active",
      source_ref: { source: "resolution" },
      metadata: {},
      created_by: "resolution",
    },
    client,
  );
}

/**
 * Process a user resolution: one submission may contain multiple resolutions.
 *
 * Uses an LLM matching agent when available: sends the resolution text + active goals,
 * gets back which goals are addressed (fully/partially/not).
 * Falls back to deterministic tokenization + synonym matching when no LLM is configured.
 * Also adds the resolution text as a high-confidence claim (fact).
 */
export async function appendResolutionGoal(
  scopeId: string,
  decision: string,
  summary: string,
  client?: pg.PoolClient,
): Promise<string> {
  const q: Queryable = client ?? getPool();

  await appendResolutionAsClaim(scopeId, decision, client);

  const activeGoals = await q.query(
    `SELECT node_id, content FROM nodes
     WHERE scope_id = $1 AND type = 'goal' AND status = 'active'
     AND superseded_at IS NULL AND (valid_to IS NULL OR valid_to > now())`,
    [scopeId],
  );

  const goals = activeGoals.rows.map((r) => ({
    node_id: (r as { node_id: string }).node_id,
    content: (r as { content: string }).content,
  }));

  let matches: GoalMatch[];
  try {
    matches = await matchGoalsWithLLM(decision, goals);
  } catch {
    matches = matchGoalsDeterministic(decision, goals);
  }

  const matched: string[] = [];
  for (const m of matches) {
    if (m.status === "not_addressed") continue;
    const newStatus = m.status === "fully_resolved" ? "resolved" : "in_progress";
    await q.query(
      `UPDATE nodes SET status = $2, updated_at = now(), version = version + 1,
       source_ref = source_ref || $3::jsonb
       WHERE node_id = $1`,
      [m.node_id, newStatus, JSON.stringify({
        resolved_by: "resolution",
        match_confidence: m.confidence,
        decision_preview: decision.trim().slice(0, 200),
      })],
    );
    matched.push(m.node_id);
  }

  if (matched.length > 0) {
    return matched[0];
  }

  const content = summary.trim() || decision.trim().slice(0, 500);
  return appendNode(
    {
      scope_id: scopeId,
      type: "goal",
      content,
      confidence: 1.0,
      status: "resolved",
      source_ref: { source: "resolution", decision_preview: decision.trim().slice(0, 200) },
      metadata: {},
      created_by: "resolution",
    },
    client,
  );
}

/**
 * Evaluate active goals against current claims in the semantic graph.
 * Marks goals as resolved or in_progress when evidence supports completion.
 * Called by the planner agent to advance goal_completion dimension.
 */
export async function evaluateGoalsAgainstEvidence(
  scopeId: string,
  pool?: pg.Pool,
): Promise<{ evaluated: number; resolved: number; in_progress: number }> {
  const q: Queryable = pool ?? getPool();

  const goalsRes = await q.query(
    `SELECT node_id, content FROM nodes
     WHERE scope_id = $1 AND type = 'goal' AND status = 'active'
     AND superseded_at IS NULL AND (valid_to IS NULL OR valid_to > now())
     ORDER BY created_at ASC LIMIT 50`,
    [scopeId],
  );
  const goals = goalsRes.rows.map((r) => ({
    node_id: (r as { node_id: string }).node_id,
    content: (r as { content: string }).content,
  }));
  if (goals.length === 0) return { evaluated: 0, resolved: 0, in_progress: 0 };

  const claimsRes = await q.query(
    `SELECT content FROM nodes
     WHERE scope_id = $1 AND type = 'claim' AND status = 'active'
     AND superseded_at IS NULL AND (valid_to IS NULL OR valid_to > now())
     ORDER BY confidence DESC LIMIT 50`,
    [scopeId],
  );
  const claims = claimsRes.rows.map((r) => (r as { content: string }).content).filter(Boolean);
  const evidenceText = claims.join(". ").slice(0, 8000);

  let matches: GoalMatch[];
  try {
    matches = await matchGoalsAgainstEvidenceWithLLM(evidenceText, goals);
  } catch {
    matches = matchGoalsDeterministic(evidenceText, goals);
  }

  let resolved = 0;
  let inProgress = 0;
  for (const m of matches) {
    if (m.status === "not_addressed") continue;
    const newStatus = m.status === "fully_resolved" ? "resolved" : "in_progress";
    await q.query(
      `UPDATE nodes SET status = $2, updated_at = now(), version = version + 1,
       source_ref = source_ref || $3::jsonb
       WHERE node_id = $1`,
      [
        m.node_id,
        newStatus,
        JSON.stringify({
          resolved_by: "planner_goal_eval",
          match_confidence: m.confidence,
          evidence_preview: evidenceText.slice(0, 200),
        }),
      ],
    );
    if (newStatus === "resolved") resolved++;
    else inProgress++;
  }

  return { evaluated: goals.length, resolved, in_progress: inProgress };
}

async function matchGoalsAgainstEvidenceWithLLM(
  evidenceText: string,
  goals: Array<{ node_id: string; content: string }>,
): Promise<GoalMatch[]> {
  const { getChatModelConfig } = await import("./modelConfig.js");
  const config = getChatModelConfig();
  if (!config || goals.length === 0) return matchGoalsDeterministic(evidenceText, goals);

  const goalsText = goals.map((g, i) => `${i + 1}. [${g.node_id}] ${g.content}`).join("\n");
  const prompt = `Given these established facts (claims extracted from documents):

"""
${evidenceText.slice(0, 8000)}
"""

Here are the active goals:
${goalsText}

For each goal, decide if the available evidence addresses it. A goal is satisfied when the facts contain information relevant to its intent — it does not require an exact literal match.
Reply with ONLY a JSON array: [{"id":"<node_id>","status":"fully_resolved"|"partially_resolved"|"not_addressed","confidence":0.0-1.0}]

- "fully_resolved": the evidence meaningfully addresses this goal's intent (e.g. financial data present for a financial goal, risk factors identified for a risk goal)
- "partially_resolved": the evidence touches on the topic but key aspects are missing
- "not_addressed": the evidence is genuinely unrelated to this goal

Be pragmatic: if relevant facts exist for a goal's domain, mark it resolved. Only use not_addressed when there is truly no overlap. Reply with ONLY the JSON array, no other text.`;

  const url = `${config.url.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.id.replace(/^openai\//, ""),
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`LLM ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  const usage = data.usage;
  if (usage) {
    try {
      const { recordLLMTokens } = await import("./metrics.js");
      recordLLMTokens("planner_goal_eval", "input", usage.prompt_tokens ?? 0, config?.id);
      recordLLMTokens("planner_goal_eval", "output", usage.completion_tokens ?? 0, config?.id);
    } catch {
      /* no-op */
    }
  }

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("No JSON array in LLM response");

  const validated = z.array(GoalMatchItemSchema).safeParse(JSON.parse(jsonMatch[0]));
  if (!validated.success) throw new Error(`Goal match schema validation failed: ${validated.error.message}`);

  const goalIds = new Set(goals.map((g) => g.node_id));
  return validated.data
    .filter((p) => goalIds.has(p.id))
    .map((p) => ({
      node_id: p.id,
      status: p.status,
      confidence: p.confidence,
    }));
}

interface GoalMatch {
  node_id: string;
  status: "fully_resolved" | "partially_resolved" | "not_addressed";
  confidence: number;
}

async function matchGoalsWithLLM(
  decision: string,
  goals: Array<{ node_id: string; content: string }>,
): Promise<GoalMatch[]> {
  const { getChatModelConfig } = await import("./modelConfig.js");
  const config = getChatModelConfig();
  if (!config || goals.length === 0) return matchGoalsDeterministic(decision, goals);

  const goalsText = goals.map((g, i) => `${i + 1}. [${g.node_id}] ${g.content}`).join("\n");
  const prompt = `A user submitted this resolution:\n"${decision.trim()}"\n\nHere are the active goals:\n${goalsText}\n\nFor each goal, decide if the resolution addresses it. Reply with ONLY a JSON array, one object per goal:\n[{"id":"<node_id>","status":"fully_resolved"|"partially_resolved"|"not_addressed","confidence":0.0-1.0}]\n\n- "fully_resolved": the resolution clearly answers or completes this goal\n- "partially_resolved": the resolution provides relevant information but doesn't fully close the goal\n- "not_addressed": the resolution is unrelated to this goal\n\nBe generous: if the resolution mentions a topic related to the goal, mark it at least partially_resolved. Reply with ONLY the JSON array, no other text.`;

  const url = `${config.url.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.id.replace(/^openai\//, ""),
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`LLM ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  const usage = data.usage;
  if (usage) {
    try {
      const { recordLLMTokens } = await import("./metrics.js");
      recordLLMTokens("resolution", "input", usage.prompt_tokens ?? 0, config?.id);
      recordLLMTokens("resolution", "output", usage.completion_tokens ?? 0, config?.id);
    } catch {
      /* no-op */
    }
  }

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("No JSON array in LLM response");

  const validated = z.array(GoalMatchItemSchema).safeParse(JSON.parse(jsonMatch[0]));
  if (!validated.success) throw new Error(`Goal match schema validation failed: ${validated.error.message}`);

  const goalIds = new Set(goals.map(g => g.node_id));
  return validated.data
    .filter(p => goalIds.has(p.id))
    .map(p => ({
      node_id: p.id,
      status: p.status,
      confidence: p.confidence,
    }));
}

function matchGoalsDeterministic(
  decision: string,
  goals: Array<{ node_id: string; content: string }>,
): GoalMatch[] {
  const MATCH_THRESHOLD = 0.10;
  const sentences = splitIntoSentences(decision);
  const fullTokens = expandSynonyms(tokenize(decision));
  const sentenceTokenSets = sentences.map(s => expandSynonyms(tokenize(s)));
  const results: GoalMatch[] = [];

  for (const goal of goals) {
    const goalTokens = expandSynonyms(tokenize(goal.content));
    const score = bestMatchScore(fullTokens, sentenceTokenSets, goalTokens);
    if (score >= MATCH_THRESHOLD) {
      results.push({
        node_id: goal.node_id,
        status: score >= 0.20 ? "fully_resolved" : "partially_resolved",
        confidence: score,
      });
    }
  }
  return results;
}

const SYNONYMS: Record<string, string[]> = {
  ip: ["patents", "patent", "intellectual", "property"],
  patents: ["ip", "patent", "intellectual"],
  patent: ["ip", "patents", "intellectual"],
  cto: ["technical", "team", "chief", "officer"],
  technical: ["cto", "tech", "engineering"],
  retention: ["retain", "retaining", "departure", "departing"],
  arr: ["revenue", "recurring", "annual"],
  revenue: ["arr", "recurring", "financial"],
  compliance: ["regulatory", "regulation", "posture"],
  regulatory: ["compliance", "regulation"],
  ownership: ["own", "co-ownership", "ip"],
  valuation: ["value", "pricing", "worth"],
  due: ["diligence"],
  diligence: ["due"],
};

function expandSynonyms(tokens: Set<string>): Set<string> {
  const expanded = new Set(tokens);
  for (const t of tokens) {
    const syns = SYNONYMS[t];
    if (syns) for (const s of syns) expanded.add(s);
  }
  return expanded;
}

/**
 * Combined match score: max of Jaccard and coverage (fraction of goal tokens found in resolution).
 * Checks both the full text and individual sentences.
 */
function bestMatchScore(
  fullTokens: Set<string>,
  sentenceTokenSets: Set<string>[],
  goalTokens: Set<string>,
): number {
  const coverage = (src: Set<string>, goal: Set<string>) => {
    if (goal.size === 0) return 0;
    let hit = 0;
    for (const w of goal) if (src.has(w)) hit++;
    return hit / goal.size;
  };

  const fullJaccard = jaccardSimilarity(fullTokens, goalTokens);
  const fullCoverage = coverage(fullTokens, goalTokens);
  let best = Math.max(fullJaccard, fullCoverage);

  for (const st of sentenceTokenSets) {
    const j = jaccardSimilarity(st, goalTokens);
    const c = coverage(st, goalTokens);
    const s = Math.max(j, c);
    if (s > best) best = s;
  }
  return best;
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/[.!?;,]+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 5);
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "has", "have", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "this", "that", "these",
  "those", "it", "its", "not", "no", "all", "any", "each", "every",
  "both", "few", "more", "most", "other", "some", "such", "than",
  "too", "very", "just", "about", "above", "after", "before", "between",
  "into", "through", "during", "until", "against", "among", "out", "up",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9àâäéèêëïîôùûüÿçæœ€%]+/gi, " ")
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) {
    if (b.has(w)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
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

/** Lightweight counts by type for feed / state graph display. */
/**
 * Returns active node content grouped by type, with counts for all statuses.
 * Canonical source for UI panels that need both counts and text.
 */
export async function getKnowledgeState(scopeId: string): Promise<{
  counts: { claims: number; goals: number; contradictions: number; risks: number; contradictions_resolved: number };
  claims: string[];
  goals: string[];
  contradictions: string[];
  risks: string[];
}> {
  const p = getPool();
  const res = await p.query(
    `SELECT type, status, content, created_by FROM nodes
     WHERE scope_id = $1 AND type IN ('claim','goal','contradiction','risk') AND (${CURRENT_VIEW_NODES})
     ORDER BY created_at ASC`,
    [scopeId],
  );
  const claims: string[] = [];
  const claimSources: string[] = [];
  const goals: string[] = [];
  const contradictions: string[] = [];
  const risks: string[] = [];
  let contraResolved = 0;

  const KS_STOP = new Set([
    "the","and","for","are","was","were","has","have","had","not","but","its",
    "that","this","from","with","they","been","which","into","also","than",
    "will","can","may","who","how","all","any","each","some","such","very",
    "just","about","between","through","during","out","more","other",
  ]);

  function ksSigWords(s: string): Set<string> {
    return new Set(
      s.toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !KS_STOP.has(w))
        .map((w) => (w.length > 6 ? w.slice(0, 6) : w)),
    );
  }

  function isDuplicateClaim(existing: string[], candidate: string, candidateSource: string): boolean {
    const cw = ksSigWords(candidate);
    if (cw.size === 0) return true;
    for (let j = 0; j < existing.length; j++) {
      if (candidateSource !== "resolution" && claimSources[j] === "resolution") continue;
      const ew = ksSigWords(existing[j]);
      let overlap = 0;
      for (const w of cw) if (ew.has(w)) overlap++;
      const maxSz = Math.max(cw.size, ew.size);
      const minSz = Math.min(cw.size, ew.size);
      if (maxSz > 0 && overlap / maxSz >= 0.5) return true;
      if (minSz > 0 && overlap >= 2 && overlap / minSz >= 0.6) return true;
    }
    return false;
  }

  function isDuplicate(existing: string[], candidate: string): boolean {
    const cw = ksSigWords(candidate);
    if (cw.size === 0) return true;
    for (const e of existing) {
      const ew = ksSigWords(e);
      let overlap = 0;
      for (const w of cw) if (ew.has(w)) overlap++;
      const maxSz = Math.max(cw.size, ew.size);
      const minSz = Math.min(cw.size, ew.size);
      if (maxSz > 0 && overlap / maxSz >= 0.5) return true;
      if (minSz > 0 && overlap >= 2 && overlap / minSz >= 0.6) return true;
    }
    return false;
  }

  /**
   * Detect when a newer claim supersedes an older one about the same topic.
   * Returns the index of the superseded entry, or -1 if none.
   * Triggers when the candidate contains explicit correction language AND
   * shares key terms with an existing entry.
   */
  function findSuperseded(existing: string[], candidate: string): number {
    if (!/\b(adjust\w*|revis\w*|correct\w*|overstat\w*|downward|previously stated|not the .{3,40}previously)\b/i.test(candidate))
      return -1;
    const cw = ksSigWords(candidate);
    if (cw.size === 0) return -1;
    for (let i = 0; i < existing.length; i++) {
      const ew = ksSigWords(existing[i]);
      let overlap = 0;
      for (const w of cw) if (ew.has(w)) overlap++;
      if (overlap >= 2 && overlap / Math.min(cw.size, ew.size) >= 0.25) return i;
    }
    return -1;
  }

  const resolvedContraTexts: string[] = [];
  const resolutionClaimIndices: number[] = [];

  for (const r of res.rows) {
    const content = String(r.content ?? "").trim();
    if (!content) continue;
    const status = String(r.status ?? "active");
    const createdBy = String(r.created_by ?? "");
    switch (r.type) {
      case "claim":
        if (status === "active") {
          if (createdBy !== "resolution") {
            const supersededIdx = findSuperseded(claims, content);
            if (supersededIdx >= 0) {
              claims[supersededIdx] = content;
              claimSources[supersededIdx] = createdBy;
              break;
            }
          }
          if (isDuplicateClaim(claims, content, createdBy)) break;
          claims.push(content);
          claimSources.push(createdBy);
          if (createdBy === "resolution") resolutionClaimIndices.push(claims.length - 1);
        }
        break;
      case "goal":
        if (status === "active" && !isDuplicate(goals, content)) goals.push(content);
        break;
      case "contradiction":
        if (status === "active" && !isDuplicate(contradictions, content)) contradictions.push(content);
        else if (status === "resolved" && !isDuplicate(resolvedContraTexts, content)) {
          resolvedContraTexts.push(content);
          contraResolved++;
        }
        break;
      case "risk":
        if (status === "active" && !isDuplicate(risks, content)) risks.push(content);
        break;
    }
  }

  // Suppress resolution claims whose content is collectively covered by structured claims.
  // Multi-statement resolution text may span multiple facts-sync claims, so check
  // word-level coverage across ALL non-resolution claims rather than pairwise overlap.
  const suppressedIndices = new Set<number>();
  for (const ri of resolutionClaimIndices) {
    const rw = ksSigWords(claims[ri]);
    if (rw.size === 0) continue;
    let coveredWords = 0;
    for (const w of rw) {
      for (let i = 0; i < claims.length; i++) {
        if (i === ri || suppressedIndices.has(i) || claimSources[i] === "resolution") continue;
        if (ksSigWords(claims[i]).has(w)) { coveredWords++; break; }
      }
    }
    if (coveredWords >= 3 || (rw.size > 0 && coveredWords / rw.size >= 0.5)) suppressedIndices.add(ri);
  }
  const filteredClaims = claims.filter((_, i) => !suppressedIndices.has(i));

  return {
    counts: {
      claims: filteredClaims.length,
      goals: goals.length,
      contradictions: contradictions.length,
      risks: risks.length,
      contradictions_resolved: contraResolved,
    },
    claims: filteredClaims,
    goals,
    contradictions,
    risks,
  };
}

export async function getGraphSummary(scopeId: string): Promise<{ nodes: Record<string, number>; edges: Record<string, number> }> {
  const p = getPool();
  const nodeRes = await p.query(
    `SELECT type, COUNT(*)::int AS c FROM nodes WHERE scope_id = $1 AND (${CURRENT_VIEW_NODES}) GROUP BY type`,
    [scopeId],
  );
  const nodes: Record<string, number> = {};
  for (const r of nodeRes.rows) nodes[String(r.type)] = Number(r.c ?? 0);

  const edgeRes = await p.query(
    `SELECT edge_type, COUNT(*)::int AS c FROM edges WHERE scope_id = $1 AND (${CURRENT_VIEW_EDGES}) GROUP BY edge_type`,
    [scopeId],
  );
  const edges: Record<string, number> = {};
  for (const r of edgeRes.rows) edges[String(r.edge_type)] = Number(r.c ?? 0);

  return { nodes, edges };
}
