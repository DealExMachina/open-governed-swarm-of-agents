import pg from "pg";
import { getPool } from "../db.js";
import {
  matchGoalsDeterministic,
  matchGoalsWithLLM,
  type GoalMatch,
} from "./goalMatching.js";
import { appendNode } from "./nodes.js";
import type { Queryable } from "./view.js";

/** Confidence for human-provided resolutions (treated as authoritative facts). */
const HUMAN_RESOLUTION_CONFIDENCE = 0.95;

/**
 * Add human resolution text as a claim (fact) with high confidence.
 * Resolutions are authoritative so they get higher confidence than LLM-extracted claims.
 */
export async function appendResolutionAsClaim(
  scopeId: string,
  decision: string,
  client?: pg.PoolClient,
  resolutionSeq?: number,
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
  if (exist.rowCount && exist.rows[0])
    return (exist.rows[0] as { node_id: string }).node_id;
  // Issue #6: carry exact resolution provenance (the originating WAL resolution seq).
  const sourceRef: Record<string, unknown> =
    typeof resolutionSeq === "number"
      ? { source: "resolution", resolution_seq: resolutionSeq }
      : { source: "resolution" };
  return appendNode(
    {
      scope_id: scopeId,
      type: "claim",
      content: trimmed,
      confidence: HUMAN_RESOLUTION_CONFIDENCE,
      status: "active",
      source_ref: sourceRef,
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
  resolutionSeq?: number,
): Promise<string> {
  const q: Queryable = client ?? getPool();

  await appendResolutionAsClaim(scopeId, decision, client, resolutionSeq);

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
    const newStatus =
      m.status === "fully_resolved" ? "resolved" : "in_progress";
    await q.query(
      `UPDATE nodes SET status = $2, updated_at = now(), version = version + 1,
       source_ref = source_ref || $3::jsonb
       WHERE node_id = $1`,
      [
        m.node_id,
        newStatus,
        JSON.stringify({
          resolved_by: "resolution",
          match_confidence: m.confidence,
          decision_preview: decision.trim().slice(0, 200),
        }),
      ],
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
      source_ref: {
        source: "resolution",
        decision_preview: decision.trim().slice(0, 200),
        ...(typeof resolutionSeq === "number" ? { resolution_seq: resolutionSeq } : {}),
      },
      metadata: {},
      created_by: "resolution",
    },
    client,
  );
}
