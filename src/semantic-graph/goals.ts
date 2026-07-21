import pg from "pg";
import { getPool } from "../db.js";
import {
  matchGoalsAgainstEvidenceWithLLM,
  matchGoalsDeterministic,
  type GoalMatch,
} from "./goalMatching.js";
import type { Queryable } from "./view.js";

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
  const claims = claimsRes.rows
    .map((r) => (r as { content: string }).content)
    .filter(Boolean);
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
