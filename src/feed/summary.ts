import { makeS3, s3GetText } from "../s3.js";
import { tailEventsForScope } from "../contextWal.js";
import { loadState } from "../stateGraph.js";
import { buildFinalizationReport } from "../finalizationReport.js";
import {
  loadPolicies,
  getGovernanceForScope,
  evaluateRules,
} from "../governance.js";
import {
  evaluateFinality,
  computeGoalScoreForScope,
  loadFinalityConfig,
  loadFinalitySnapshot,
  scopeHasFinalityContent,
} from "../finalityEvaluator.js";
import {
  getConvergenceState,
  type ConvergenceState,
} from "../convergenceTracker.js";
import {
  getGraphSummary,
  loadAllContradictionsWithResolutions,
  getKnowledgeState,
} from "../semanticGraph.js";
import { scopeDriftKey, scopeFactsKey } from "../scopeStorage.js";
import {
  getLatestFinalityDecision,
  getAllFinalityDecisions,
} from "../finalityDecisions.js";
import {
  getGovernancePolicyVersion,
  getFinalityPolicyVersion,
} from "../policyVersions.js";
import { getLatestCertificate } from "../finalityCertificates.js";
import { GOVERNANCE_PATH, S3_BUCKET } from "./config.js";

function toFactStringList(val: unknown): string[] {
  if (val == null) return [];
  if (Array.isArray(val)) {
    return val
      .map((item) => {
        if (typeof item === "string") return item.trim() || null;
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const obj = item as Record<string, unknown>;
          const s =
            (obj.claim as string) ??
            (obj.risk as string) ??
            (obj.goal as string) ??
            (obj.assumption as string) ??
            (obj.contradiction as string) ??
            (obj.text as string) ??
            (obj.entity as string);
          if (typeof s === "string") return s.trim() || null;
        }
        return null;
      })
      .filter((s): s is string => typeof s === "string" && s.length > 0);
  }
  if (typeof val === "string") return val.trim() ? [val.trim()] : [];
  return [];
}

/**
 * Build studio/demo summary JSON for a scope (shared by feed and control plane).
 */
export async function buildScopeSummaryForScope(
  scopeId: string,
): Promise<Record<string, unknown>> {
  const state = await loadState(scopeId);
  const recent = await tailEventsForScope(scopeId, 20);
  const knowledge = await getKnowledgeState(scopeId).catch(() => null);
  const knowledgeCount = knowledge
    ? knowledge.counts.claims +
      knowledge.counts.goals +
      knowledge.counts.contradictions +
      knowledge.counts.risks
    : 0;

  let facts: Record<string, unknown> | null = null;
  let drift: Record<string, unknown> | null = null;

  if (knowledge && knowledgeCount > 0) {
    facts = {
      goals: knowledge.goals,
      claims: knowledge.claims,
      risks: knowledge.risks,
      contradictions: knowledge.contradictions,
      assumptions: [],
      confidence: null,
      hash: null,
      keys: [],
    };
  } else if (S3_BUCKET) {
    try {
      const s3 = makeS3();
      const factsRaw = await s3GetText(s3, S3_BUCKET, scopeFactsKey(scopeId));
      const driftRaw = await s3GetText(s3, S3_BUCKET, scopeDriftKey(scopeId));
      if (factsRaw) facts = JSON.parse(factsRaw) as Record<string, unknown>;
      if (driftRaw) drift = JSON.parse(driftRaw) as Record<string, unknown>;
    } catch {
      // S3 optional for summary
    }
  }
  return {
    scope_id: scopeId,
    state: state
      ? {
          lastNode: state.lastNode,
          epoch: state.epoch,
          runId: state.runId,
          updatedAt: state.updatedAt,
        }
      : null,
    facts: facts
      ? {
          goals: toFactStringList(facts.goals),
          claims: toFactStringList(facts.claims),
          risks: toFactStringList(facts.risks),
          contradictions: toFactStringList(facts.contradictions),
          assumptions: toFactStringList(facts.assumptions),
          confidence: facts.confidence ?? null,
          hash: (facts as { hash?: string }).hash ?? null,
          keys: Object.keys(facts).filter(
            (k) =>
              ![
                "hash",
                "goals",
                "confidence",
                "claims",
                "risks",
                "contradictions",
                "assumptions",
              ].includes(k),
          ),
        }
      : null,
    drift: (() => {
      if (!drift) return null;
      const level = String(drift.level ?? "unknown");
      const types = (drift.types as string[]) ?? [];
      const notes = (drift.notes as string[]) ?? [];
      let suggested_actions: string[] = [];
      try {
        const config = getGovernanceForScope(
          scopeId,
          loadPolicies(GOVERNANCE_PATH),
        );
        suggested_actions = evaluateRules({ level, types }, config);
      } catch {
        // governance file optional for summary
      }
      const references =
        (drift.references as Array<{
          type?: string;
          doc?: string;
          excerpt?: string;
        }>) ?? [];
      return { level, types, notes, suggested_actions, references };
    })(),
    what_changed: recent
      .filter((e) =>
        [
          "state_transition",
          "facts_extracted",
          "drift_analyzed",
          "context_doc",
          "bootstrap",
          "resolution",
        ].includes((e.data as { type?: string })?.type ?? ""),
      )
      .slice(-10)
      .map((e) => ({
        seq: e.seq,
        type: (e.data as { type?: string }).type,
        ts: e.ts,
        payload:
          (e.data as { payload?: Record<string, unknown> }).payload ?? {},
      })),
    finality: await (async () => {
      try {
        const config = loadFinalityConfig();
        const near = config.goal_gradient?.near_finality_threshold ?? 0.75;
        const auto = config.goal_gradient?.auto_finality_threshold ?? 0.92;
        const goal_score = await computeGoalScoreForScope(scopeId);
        const result = await evaluateFinality(scopeId);
        const status =
          result?.kind === "status"
            ? result.status
            : result?.kind === "review"
              ? "near_finality"
              : "ACTIVE";
        let last_decision: { option: string; created_at: string } | null = null;
        try {
          const decision = await getLatestFinalityDecision(scopeId);
          if (decision)
            last_decision = {
              option: decision.option,
              created_at: decision.created_at,
            };
        } catch {
          // table may not exist
        }
        let convergence: Record<string, unknown> | null = null;
        try {
          const convConfig = config.convergence ?? {};
          const convState: ConvergenceState = await getConvergenceState(
            scopeId,
            convConfig,
            auto,
          );
          convergence = {
            rate: convState.convergence_rate,
            estimated_rounds: convState.estimated_rounds,
            is_plateaued: convState.is_plateaued,
            plateau_rounds: convState.plateau_rounds,
            lyapunov_v:
              convState.history.length > 0
                ? convState.history[convState.history.length - 1].lyapunov_v
                : null,
            highest_pressure: convState.highest_pressure_dimension,
            is_monotonic: convState.is_monotonic,
            trajectory_quality: convState.trajectory_quality,
            oscillation_detected: convState.oscillation_detected,
            history: convState.history.map((p) => ({
              epoch: p.epoch,
              score: p.goal_score,
              v: p.lyapunov_v,
            })),
          };
        } catch {
          // convergence_history table may not exist
        }

        let policy_version:
          | { governance?: string; finality?: string }
          | undefined;
        let finality_certificate: {
          decision: string;
          timestamp: string;
          has_jws: boolean;
        } | null = null;
        try {
          policy_version = {
            governance: getGovernancePolicyVersion(),
            finality: getFinalityPolicyVersion(),
          };
        } catch {
          // optional
        }
        try {
          const cert = await getLatestCertificate(scopeId);
          if (cert && status === "RESOLVED") {
            finality_certificate = {
              decision: cert.payload.decision,
              timestamp: cert.payload.timestamp,
              has_jws: !!cert.certificate_jws,
            };
          }
        } catch {
          // table may not exist
        }
        const dimensions = await (async () => {
          try {
            const snap = await loadFinalitySnapshot(scopeId);
            const hasContent = await scopeHasFinalityContent(scopeId, snap);
            if (!hasContent) {
              return {
                claim_avg_confidence: 0,
                contradiction_resolution_ratio: 0,
                goal_completion_ratio: 0,
                risk_score_inverse: 0,
              };
            }
            const contraTotal = snap.contradictions_total_count || 0;
            const contraResolved =
              contraTotal === 0
                ? 1
                : 1 - snap.contradictions_unresolved_count / contraTotal;
            return {
              claim_avg_confidence: snap.claims_active_avg_confidence,
              contradiction_resolution_ratio: contraResolved,
              goal_completion_ratio: snap.goals_completion_ratio,
              risk_score_inverse: 1 - Math.min(snap.scope_risk_score, 1),
            };
          } catch {
            return null;
          }
        })();
        return {
          goal_score: Math.round(goal_score * 100) / 100,
          status,
          near_threshold: near,
          auto_threshold: auto,
          resolved: status === "RESOLVED",
          dimension_breakdown:
            result?.kind === "review"
              ? result.request.dimension_breakdown
              : null,
          blockers: result?.kind === "review" ? result.request.blockers : null,
          last_decision: last_decision ?? undefined,
          policy_version: policy_version ?? undefined,
          finality_certificate: finality_certificate ?? undefined,
          convergence,
          dimensions,
        };
      } catch {
        return null;
      }
    })(),
    finalization_report: await (async () => {
      try {
        const hasContent = await scopeHasFinalityContent(scopeId);
        if (!hasContent) return null;
        const config = loadFinalityConfig();
        const near = config.goal_gradient?.near_finality_threshold ?? 0.75;
        const goal_score = await computeGoalScoreForScope(scopeId);
        const result = await evaluateFinality(scopeId);
        const status =
          result?.kind === "status"
            ? result.status
            : result?.kind === "review"
              ? "near_finality"
              : "ACTIVE";
        const showReport =
          status === "RESOLVED" ||
          status === "near_finality" ||
          status === "ESCALATED" ||
          goal_score >= near;
        if (!showReport) return null;
        const reportStatus =
          status === "ACTIVE" && goal_score >= near ? "near_finality" : status;
        return await buildFinalizationReport(scopeId, { status: reportStatus });
      } catch {
        return null;
      }
    })(),
    state_graph: await (async () => {
      try {
        return await getGraphSummary(scopeId);
      } catch {
        return null;
      }
    })(),
    contradictions: await (async () => {
      try {
        return await loadAllContradictionsWithResolutions(scopeId);
      } catch {
        return null;
      }
    })(),
    human_decisions: await (async () => {
      try {
        return await getAllFinalityDecisions(scopeId);
      } catch {
        return [];
      }
    })(),
  };
}
