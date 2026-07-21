import type pg from "pg";
import type { FinalitySnapshot } from "../finalityEvaluator.js";
import { getPool } from "../db.js";
import { CURRENT_VIEW_NODES } from "./view.js";

/**
 * Single-query aggregation for finality evaluation. Returns scope-level aggregates.
 */
export async function loadFinalitySnapshot(
  scopeId: string,
): Promise<FinalitySnapshot> {
  const startMs = Date.now();
  try {
    return await loadFinalitySnapshotImpl(scopeId);
  } finally {
    try {
      const { recordSemanticGraphQueryMs } = await import("../metrics.js");
      recordSemanticGraphQueryMs("loadFinalitySnapshot", Date.now() - startMs);
    } catch {
      /* no-op */
    }
  }
}

async function loadFinalitySnapshotImpl(
  scopeId: string,
): Promise<FinalitySnapshot> {
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
  const goalsCompletionRatio =
    goalsTotal === 0 ? 1 : Number(goalRow.resolved ?? 0) / goalsTotal;

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
  const scopeRiskScore = Math.min(
    1,
    Math.max(0, Number(assessmentRes.rows[0]?.risk_score ?? 0)),
  );

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
      schemas?: Record<
        string,
        {
          evidence_types?: string[];
          temporal_constraint?: { max_age_days?: number | null };
        }
      >;
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
