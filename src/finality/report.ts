/**
 * Business-facing finalization report: prose narrative of a resolved (or near-final) scope.
 */
import { getPool } from "../db.js";
import { getKnowledgeState } from "../semanticGraph.js";
import { computeGoalScoreForScope, loadFinalitySnapshot } from "./evaluator.js";
import { getLatestFinalityDecision } from "./decisions.js";
import { getStudioCatalogScope } from "../studioCatalog.js";

export interface FinalizationReport {
  scope_id: string;
  scope_name: string;
  status: string;
  headline: string;
  narrative: string;
  key_facts: string[];
  objectives: string[];
  open_contradictions: string[];
  resolved_contradictions_count: number;
  risks: string[];
  human_resolutions: string[];
  scores: {
    finality_pct: number;
    fact_confidence_pct: number | null;
    contradictions_resolved_pct: number | null;
    goals_complete_pct: number | null;
    risk_control_pct: number | null;
  };
  next_steps: string;
}

function pct(n: number | null | undefined): number | null {
  if (n == null || Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

async function loadHumanResolutions(scopeId: string): Promise<string[]> {
  const pool = getPool();
  try {
    const res = await pool.query(
      `SELECT data->'payload'->>'decision' AS decision,
              data->'payload'->>'text' AS text
       FROM context_events
       WHERE coalesce(data->>'type', data->'payload'->>'type') = 'resolution'
         AND coalesce(data->'payload'->>'scope_id', data->>'scope_id') = $1
       ORDER BY seq ASC
       LIMIT 20`,
      [scopeId],
    );
    return res.rows
      .map((r) => String(r.decision || r.text || "").trim())
      .filter((s) => s.length > 0)
      .map((s) => (s.length > 280 ? s.slice(0, 277) + "…" : s));
  } catch {
    return [];
  }
}

/**
 * Build a plain-language report of the finalized (or current) situation for a scope.
 */
export async function buildFinalizationReport(
  scopeId: string,
  opts?: { status?: string },
): Promise<FinalizationReport> {
  const catalog = await getStudioCatalogScope(scopeId).catch(() => null);
  const scopeName = catalog?.name ?? scopeId;
  const knowledge = await getKnowledgeState(scopeId);
  const snap = await loadFinalitySnapshot(scopeId);
  const goalScore = await computeGoalScoreForScope(scopeId);
  const humanResolutions = await loadHumanResolutions(scopeId);
  const lastDecision = await getLatestFinalityDecision(scopeId).catch(
    () => null,
  );

  const contraTotal =
    knowledge.counts.contradictions + knowledge.counts.contradictions_resolved;
  const contraResolvedPct =
    contraTotal === 0
      ? 100
      : Math.round(
          (knowledge.counts.contradictions_resolved / contraTotal) * 100,
        );

  const status =
    opts?.status ??
    (goalScore >= 0.92
      ? "RESOLVED"
      : goalScore >= 0.4
        ? "ESCALATED"
        : "ACTIVE");

  const claims = knowledge.counts.claims;
  const openContra = knowledge.counts.contradictions;
  const risks = knowledge.counts.risks;
  const goals = knowledge.counts.goals;
  const gsPct = Math.round(goalScore * 100);

  const parts: string[] = [];
  parts.push(
    `For ${scopeName}, the swarm reviewed the available documents and assembled a knowledge position with ${claims} verified fact${claims === 1 ? "" : "s"}, ${goals} objective${goals === 1 ? "" : "s"}, and ${risks} risk${risks === 1 ? "" : "s"} on the board.`,
  );

  if (openContra > 0) {
    parts.push(
      `${openContra} contradiction${openContra === 1 ? "" : "s"} remain open — sources still disagree on material points that block a clean close.`,
    );
  } else if (knowledge.counts.contradictions_resolved > 0) {
    parts.push(
      `Earlier conflicts (${knowledge.counts.contradictions_resolved} contradiction${knowledge.counts.contradictions_resolved === 1 ? "" : "s"}) were reconciled; no open contradictions remain.`,
    );
  } else {
    parts.push(
      `No material contradictions were left open at the time of this report.`,
    );
  }

  if (humanResolutions.length > 0) {
    parts.push(
      `Human reviewers entered ${humanResolutions.length} resolution${humanResolutions.length === 1 ? "" : "s"} that the system folded back into the graph.`,
    );
  } else if (lastDecision?.option === "approve_finality") {
    parts.push(
      `A human reviewer approved finality without additional written resolutions.`,
    );
  }

  if (status === "RESOLVED") {
    parts.push(
      `The position is closed at ${gsPct}% finality. Treat the facts, objectives, and risks below as the agreed situation for this scope.`,
    );
  } else if (status === "ESCALATED" || status === "near_finality") {
    parts.push(
      `Finality sits at ${gsPct}% — high enough to need judgment, not high enough to auto-close. The open items below are what still need a human call.`,
    );
  } else {
    parts.push(
      `Work is still in progress (finality ${gsPct}%). The lists below reflect the current picture, not a closed case.`,
    );
  }

  let next_steps: string;
  if (status === "RESOLVED") {
    next_steps =
      "Archive or hand off this scope. Use the key facts and human resolutions as the audit trail for the decision.";
  } else if (openContra > 0) {
    next_steps =
      "Resolve the open contradictions (Choose A/B or write a resolution), then re-check finality.";
  } else {
    next_steps =
      "Review remaining risks and objectives, or approve finality if the business is satisfied with the current position.";
  }

  const headline =
    status === "RESOLVED"
      ? `${scopeName}: situation finalized`
      : status === "ESCALATED" || status === "near_finality"
        ? `${scopeName}: needs human review`
        : `${scopeName}: in progress`;

  return {
    scope_id: scopeId,
    scope_name: scopeName,
    status,
    headline,
    narrative: parts.join(" "),
    key_facts: knowledge.claims.slice(0, 12),
    objectives: knowledge.goals.slice(0, 10),
    open_contradictions: knowledge.contradictions.slice(0, 10),
    resolved_contradictions_count: knowledge.counts.contradictions_resolved,
    risks: knowledge.risks.slice(0, 10),
    human_resolutions: humanResolutions,
    scores: {
      finality_pct: gsPct,
      fact_confidence_pct: pct(snap.claims_active_avg_confidence),
      contradictions_resolved_pct: contraResolvedPct,
      goals_complete_pct: pct(snap.goals_completion_ratio),
      risk_control_pct: pct(1 - Math.min(snap.scope_risk_score, 1)),
    },
    next_steps,
  };
}

/** Persist catalog state/score when a scope reaches RESOLVED (best-effort). */
export async function markStudioCatalogResolved(
  scopeId: string,
  score: number,
): Promise<void> {
  try {
    await getPool().query(
      `UPDATE studio_catalog_scopes
       SET state = 'resolved', score = $2, updated_at = now()
       WHERE id = $1`,
      [scopeId, score],
    );
  } catch {
    /* table may not exist */
  }
}
