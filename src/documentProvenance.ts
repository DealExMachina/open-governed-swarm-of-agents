/**
 * Document -> claim provenance helpers (issue #6).
 *
 * Facts-derived nodes carry exact provenance in `source_ref`:
 *   { source: "facts", document_seq, document_seqs?, document_title?, document_content_hash? }
 * Resolution-derived nodes carry:
 *   { source: "resolution", resolution_seq }
 *
 * This module is the read-side seam consumed by the document lifecycle work
 * (issue #5): the impact analyzer resolves "which nodes came from document seq N?"
 * via `queryNodeIdsByDocumentSeq`, and falls back cleanly to a human-judgement
 * message for pre-migration documents that have no exact provenance (Option A).
 */

import pg from "pg";
import { getPool } from "./db.js";

export interface NodeDocumentProvenance {
  document_seq?: number;
  document_seqs?: number[];
  document_title?: string;
  document_content_hash?: string;
  resolution_seq?: number;
}

/** Human-facing sentinel surfaced by the lifecycle impact analyzer (issue #5). */
export const PROVENANCE_UNAVAILABLE_MESSAGE =
  "pre-migration document, exact provenance unavailable — removal must rely on HITL judgement of the best-effort impact report";

export interface ProvenanceDescription {
  /** True when the node carries an exact originating document_seq. */
  exact: boolean;
  document_seq?: number;
  document_seqs?: number[];
  document_title?: string;
  document_content_hash?: string;
  resolution_seq?: number;
  /** Present only when exact === false; safe to show to a human approver. */
  message?: string;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

/** Parse a node's `source_ref` JSON into typed provenance fields. */
export function readNodeProvenance(
  sourceRef: Record<string, unknown> | null | undefined,
): NodeDocumentProvenance {
  const ref = sourceRef ?? {};
  const out: NodeDocumentProvenance = {};
  const seq = asNumber(ref.document_seq);
  if (seq !== undefined) out.document_seq = seq;
  if (Array.isArray(ref.document_seqs)) {
    const seqs = ref.document_seqs.map(asNumber).filter((n): n is number => n !== undefined);
    if (seqs.length) out.document_seqs = seqs;
  }
  if (typeof ref.document_title === "string") out.document_title = ref.document_title;
  if (typeof ref.document_content_hash === "string") {
    out.document_content_hash = ref.document_content_hash;
  }
  const resSeq = asNumber(ref.resolution_seq);
  if (resSeq !== undefined) out.resolution_seq = resSeq;
  return out;
}

/**
 * Describe a node's provenance for the lifecycle impact analyzer. Returns
 * `exact: false` with a human-readable message when no document_seq is present
 * (Option A: pre-migration documents are handled by the HITL safety net).
 */
export function describeNodeProvenance(
  sourceRef: Record<string, unknown> | null | undefined,
): ProvenanceDescription {
  const prov = readNodeProvenance(sourceRef);
  if (prov.document_seq === undefined) {
    return { exact: false, message: PROVENANCE_UNAVAILABLE_MESSAGE, ...prov };
  }
  return { exact: true, ...prov };
}

/**
 * Resolve all node ids in a scope that originated from a given document WAL seq,
 * including nodes whose provenance lists it among multiple sources
 * (source_ref.document_seqs). Backed by the indexes in migration 030.
 */
export async function queryNodeIdsByDocumentSeq(
  scopeId: string,
  documentSeq: number,
  client?: pg.PoolClient,
): Promise<string[]> {
  const q: pg.Pool | pg.PoolClient = client ?? getPool();
  const res = await q.query(
    `SELECT node_id FROM nodes
     WHERE scope_id = $1
       AND (
         (source_ref->>'document_seq') = $2
         OR source_ref @> $3::jsonb
       )`,
    [scopeId, String(documentSeq), JSON.stringify({ document_seqs: [documentSeq] })],
  );
  return res.rows.map((r: { node_id: string }) => r.node_id);
}
