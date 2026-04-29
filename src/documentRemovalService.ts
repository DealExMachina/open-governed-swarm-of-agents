/**
 * Document removal service — cascade invalidation of claims, contradictions, and convergence.
 *
 * TODO(future-release): This module implements the "remove document" feature planned for a
 * future release. It is gated behind the ENABLE_DOCUMENT_MUTATION=true env var and must not
 * be called in production until that flag is set and the feature is fully validated.
 *
 * Cascade order when a context document is removed from a scope:
 *   1. Look up the original context_doc WAL event by seq to retrieve the document title.
 *   2. Mark claim nodes status="invalidated" where source_ref identifies the removed document.
 *   3. Transitively mark contradiction nodes status="invalidated" whose metadata or edges
 *      reference any invalidated claim (claim_source_id / claim_target_id / contradicts edges).
 *   4. Re-record a fresh convergence point reflecting the reduced claim set so that the
 *      Lyapunov V and dimension scores are consistent with the post-removal state.
 *   5. Emit a scope.document.removed SwarmEvent to NATS and append it to the context WAL.
 *
 * TODO(future-release): For exact claim-to-document traceability, update
 * factsToSemanticGraph.ts to store the originating WAL seq in source_ref, e.g.:
 *   source_ref: { source: "facts", document_seq: <walSeq> }
 * Until that is done, step 2 matches on title fields in source_ref (best-effort), which means
 * claims from a document that share a title with another may be over-invalidated, and claims
 * that were ingested before the source_ref schema was updated will be missed.
 */

import pg from "pg";
import { getPool } from "./db.js";
import { createSwarmEvent } from "./events.js";
import type { EventBus } from "./eventBus.js";
import { appendEvent } from "./contextWal.js";
import {
  loadFinalitySnapshot,
  loadFinalityConfig,
  computeGoalScore,
} from "./finalityEvaluator.js";
import {
  computeDimensionScores,
  computeLyapunovV,
  computePressure,
  recordConvergencePoint,
} from "./convergenceTracker.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocumentRemovalResult {
  /** WAL seq of the removed document. */
  document_seq: number;
  /** Title extracted from the original context_doc WAL event. */
  document_title: string;
  /** Claim nodes whose status was set to "invalidated". */
  claims_invalidated: number;
  /** Contradiction nodes transitively invalidated. */
  contradictions_invalidated: number;
  /** True when a fresh convergence point was recorded after removal. */
  convergence_recomputed: boolean;
  /** id of the emitted scope.document.removed SwarmEvent. */
  event_id: string;
}

// ---------------------------------------------------------------------------
// WAL lookup
// ---------------------------------------------------------------------------

/**
 * Resolve the document title from a context_doc WAL event.
 * Returns null if the event does not exist or is not a context_doc.
 */
export async function resolveDocumentTitle(
  documentSeq: number,
  pool?: pg.Pool,
): Promise<string | null> {
  const p = pool ?? getPool();
  const res = await p.query(
    `SELECT data FROM context_events WHERE seq = $1 LIMIT 1`,
    [documentSeq],
  );
  if (!res.rows.length) return null;
  const row = res.rows[0] as { data: Record<string, unknown> };
  const data = typeof row.data === "string" ? (JSON.parse(row.data) as Record<string, unknown>) : row.data;
  if (data.type !== "context_doc") return null;
  const payload = data.payload as Record<string, unknown> | undefined;
  const title = typeof payload?.title === "string" ? payload.title.trim() : "";
  return title || null;
}

// ---------------------------------------------------------------------------
// Cascade invalidation (transactional)
// ---------------------------------------------------------------------------

interface InvalidationResult {
  claimsInvalidated: number;
  contradictionsInvalidated: number;
  invalidatedClaimIds: string[];
}

/**
 * Within a DB transaction:
 *   1. Invalidate claims that reference the removed document (by WAL seq or title fallback).
 *   2. Transitively invalidate contradiction nodes that reference those claims.
 *
 * Uses the document_seq field in source_ref when available (forward-compatible with the
 * planned factsToSemanticGraph.ts update), and falls back to title-based matching.
 */
async function cascadeInvalidate(
  client: pg.PoolClient,
  scopeId: string,
  documentSeq: number,
  documentTitle: string,
): Promise<InvalidationResult> {
  // Step 1: invalidate claim nodes.
  // Primary match: source_ref->>'document_seq' (added by the future factsToSemanticGraph update).
  // Fallback: various title fields that an earlier ingestion path might have set.
  const claimsRes = await client.query<{ node_id: string }>(
    `UPDATE nodes
     SET
       status      = 'invalidated',
       updated_at  = now(),
       version     = version + 1,
       source_ref  = source_ref || '{"invalidated_by":"document_removal"}'::jsonb
     WHERE scope_id = $1
       AND type     = 'claim'
       AND status  != 'invalidated'
       AND superseded_at IS NULL
       AND (valid_to IS NULL OR valid_to > now())
       AND (
             (source_ref->>'document_seq') = $2::text
          OR source_ref->>'title'          = $3
          OR source_ref->>'doc_title'      = $3
          OR source_ref->>'source_doc'     = $3
          OR source_ref->>'document'       = $3
          OR source_ref->>'document_title' = $3
       )
     RETURNING node_id`,
    [scopeId, String(documentSeq), documentTitle],
  );

  const invalidatedClaimIds = claimsRes.rows.map((r) => r.node_id);
  const claimsInvalidated = invalidatedClaimIds.length;

  if (claimsInvalidated === 0) {
    return { claimsInvalidated: 0, contradictionsInvalidated: 0, invalidatedClaimIds: [] };
  }

  // Step 2: invalidate contradiction nodes that reference any invalidated claim.
  // A contradiction references claims either via:
  //   a) metadata->>'claim_source_id' / metadata->>'claim_target_id'  (canonical)
  //   b) contradicts edges sourced from or targeting the invalidated claim nodes
  const contraRes = await client.query<{ node_id: string }>(
    `UPDATE nodes
     SET
       status      = 'invalidated',
       updated_at  = now(),
       version     = version + 1,
       source_ref  = source_ref || '{"invalidated_by":"document_removal"}'::jsonb
     WHERE scope_id = $1
       AND type     = 'contradiction'
       AND status  != 'invalidated'
       AND superseded_at IS NULL
       AND (valid_to IS NULL OR valid_to > now())
       AND (
             metadata->>'claim_source_id' = ANY($2::text[])
          OR metadata->>'claim_target_id' = ANY($2::text[])
          OR node_id IN (
               SELECT DISTINCT e.source_id
               FROM edges e
               WHERE e.scope_id      = $1
                 AND e.edge_type     = 'contradicts'
                 AND e.superseded_at IS NULL
                 AND (e.valid_to IS NULL OR e.valid_to > now())
                 AND (
                       e.source_id = ANY($3::uuid[])
                    OR e.target_id = ANY($3::uuid[])
                 )
             )
       )
     RETURNING node_id`,
    [scopeId, invalidatedClaimIds, invalidatedClaimIds],
  );

  return {
    claimsInvalidated,
    contradictionsInvalidated: contraRes.rowCount ?? 0,
    invalidatedClaimIds,
  };
}

// ---------------------------------------------------------------------------
// Convergence re-computation
// ---------------------------------------------------------------------------

/**
 * Re-record a convergence point that reflects the scope state after document removal.
 * Non-fatal: errors here must not block the removal response.
 */
async function recomputeConvergence(scopeId: string): Promise<boolean> {
  try {
    const snapshot = await loadFinalitySnapshot(scopeId);
    const config = loadFinalityConfig();
    const gradientConfig = config.goal_gradient;

    const dimensionScores = computeDimensionScores(snapshot, gradientConfig);
    const lyapunovV = computeLyapunovV(snapshot);
    const pressure = computePressure(snapshot, gradientConfig?.weights);
    const goalScore = computeGoalScore(snapshot, gradientConfig);

    const pool = getPool();
    const epochRes = await pool.query<{ next_epoch: string }>(
      `SELECT COALESCE(MAX(epoch), 0) + 1 AS next_epoch
       FROM convergence_history WHERE scope_id = $1`,
      [scopeId],
    );
    const epoch = Number(epochRes.rows[0]?.next_epoch ?? 1);

    await recordConvergencePoint(
      scopeId,
      epoch,
      Math.max(0, Math.min(1, goalScore)),
      Math.max(0, lyapunovV),
      dimensionScores,
      pressure,
    );
    return true;
  } catch {
    // Non-fatal — convergence will be re-computed on the next agent cycle.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Remove a context document from a scope:
 *   1. Resolve the document title from the WAL.
 *   2. Cascade-invalidate claims and contradictions in a single transaction.
 *   3. Re-record a convergence point.
 *   4. Emit scope.document.removed to NATS and WAL.
 *
 * Throws when the document WAL event is not found or is not a context_doc.
 */
export async function removeDocument(
  scopeId: string,
  documentSeq: number,
  bus: EventBus,
): Promise<DocumentRemovalResult> {
  // Step 1 — resolve document title from WAL.
  const documentTitle = await resolveDocumentTitle(documentSeq);
  if (documentTitle === null) {
    throw Object.assign(
      new Error(`Document not found: no context_doc event at WAL seq ${documentSeq}`),
      { code: "DOCUMENT_NOT_FOUND", status: 404 },
    );
  }

  // Step 2 — cascade invalidation within a single DB transaction.
  const pool = getPool();
  const client = await pool.connect();
  let invalidation: InvalidationResult;
  try {
    await client.query("BEGIN");
    invalidation = await cascadeInvalidate(client, scopeId, documentSeq, documentTitle);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Step 3 — re-record convergence (best-effort, outside transaction).
  const convergenceRecomputed = await recomputeConvergence(scopeId);

  // Step 4 — emit scope.document.removed to NATS and WAL.
  const event = createSwarmEvent(
    "scope.document.removed",
    {
      scope_id: scopeId,
      document_seq: documentSeq,
      document_title: documentTitle,
      claims_invalidated: invalidation.claimsInvalidated,
      contradictions_invalidated: invalidation.contradictionsInvalidated,
      convergence_recomputed: convergenceRecomputed,
    },
    { source: "feed" },
  );

  await appendEvent(event as unknown as Record<string, unknown>);
  await bus.publishEvent(event);

  return {
    document_seq: documentSeq,
    document_title: documentTitle,
    claims_invalidated: invalidation.claimsInvalidated,
    contradictions_invalidated: invalidation.contradictionsInvalidated,
    convergence_recomputed: convergenceRecomputed,
    event_id: event.id,
  };
}
