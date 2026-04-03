import { readFileSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import { getFinalityThresholds } from "./modelConfig.js";
import {
  computeGoalScore as rustComputeGoalScore,
  evaluateOne as rustEvaluateOne,
} from "./sgrsAdapter.js";
import { emitContribution } from "./causalEmit.js";

/** Severity/materiality for contradiction mass (Gate B). */
export type ContradictionSeverity = "low" | "medium" | "high" | "material";

/**
 * Snapshot of scope-level aggregates used for finality conditions and goal score.
 * When semanticGraph exists, loadFinalitySnapshot should run a single aggregation query.
 */
export interface FinalitySnapshot {
  /** Min confidence among active claims (0–1). */
  claims_active_min_confidence: number;
  /** Number of active claims. */
  claims_active_count: number;
  /** Average confidence of active claims (for goal score). */
  claims_active_avg_confidence: number;
  /** Number of unresolved contradictions. */
  contradictions_unresolved_count: number;
  /** Total contradiction pairs (for resolution ratio). */
  contradictions_total_count: number;
  /** Number of active critical risks. */
  risks_critical_active_count: number;
  /** Goals completion ratio (0–1): resolved / total. */
  goals_completion_ratio: number;
  /** Scope-level risk score (0–1). */
  scope_risk_score: number;
  /** Optional: idle cycles / last delta age for BLOCKED/EXPIRED. */
  scope_idle_cycles?: number;
  scope_last_delta_age_ms?: number;
  scope_last_active_age_ms?: number;
  assessments_critical_unaddressed_count?: number;
  /** Gate B: weighted contradiction mass (severity × materiality); optional until Phase 1. */
  contradiction_mass?: number;
  /** Gate B: evidence coverage ratio (0–1); optional until Phase 1. */
  evidence_coverage?: number;
  /** Coordination signal (agent-to-agent); optional until Phase 2. */
  coordination_signal?: CoordinationSignal | null;
}

/** Coordination signal payload (placeholder for Phase 2). */
export interface CoordinationSignal {
  signal_type: string;
  value?: number;
  metadata?: Record<string, unknown>;
}

/** Payload for finality certificate (JWS signing in Phase 4). */
export interface FinalityCertificatePayload {
  scope_id: string;
  decision: "RESOLVED" | "ESCALATED" | "BLOCKED" | "EXPIRED";
  timestamp: string;
  policy_version_hashes?: { governance?: string; finality?: string };
  dimensions_snapshot?: Record<string, number>;
  /** Issue #18: 'scalar' or 'vector' finality mode used. */
  finality_mode?: "scalar" | "vector";
  /** Issue #18: per-dimension pass/fail results (vector mode). */
  per_dimension_results?: {
    dimension: string;
    score: number;
    threshold: number;
    passed: boolean;
    is_veto: boolean;
    gate_a: boolean;
    gate_c: boolean;
  }[];
  /** Issue #18: veto dimensions that blocked finality. */
  veto_causes?: string[];
}

export type CaseStatus =
  | "ACTIVE"
  | "RESOLVED"
  | "ESCALATED"
  | "BLOCKED"
  | "SUSPENDED"
  | "SUPERSEDED"
  | "EXPIRED";

export interface FinalityConditionRule {
  mode: "all" | "any";
  conditions: string[];
  description?: string;
  auto_threshold?: number;
}

export interface GoalGradientConfig {
  weights: {
    claim_confidence: number;
    contradiction_resolution: number;
    goal_completion: number;
    risk_score_inverse: number;
  };
  near_finality_threshold: number;
  auto_finality_threshold: number;
}

export interface ConvergenceYamlConfig {
  beta?: number;
  tau?: number;
  ema_alpha?: number;
  plateau_threshold?: number;
  history_depth?: number;
  divergence_rate?: number;
}

/** Gate D: quiescence heuristic. When both are 0, quiescence is not required. */
export interface QuiescenceConfig {
  /** Minimum idle cycles (no state change) before RESOLVED can apply. */
  idle_cycles_min: number;
  /** Minimum ms since last state change (scope.last_delta_age_ms). */
  window_ms: number;
}

/**
 * Per-dimension (vector) finality configuration.
 * When enabled, RESOLVED requires every required dimension to independently
 * satisfy its threshold + epsilon, with per-dimension gates GA_d and GC_d.
 * Scalar finality remains as fallback when disabled.
 *
 * F*(t) = AND_d[e_d <= eps_d AND GA_d AND GC_d] AND GB AND GD AND GE
 */
export interface PerDimensionFinalityConfig {
  /** Enable vector finality predicate (default: false for backward compat). */
  enabled: boolean;
  /** Dimensions that must individually pass for RESOLVED. */
  required_dimensions: string[];
  /** Per-dimension score thresholds (tau_d). */
  dimension_thresholds: Record<string, number>;
  /** Dimensions whose failure vetoes finality regardless of other dimensions. */
  veto_dimensions: string[];
  /** Per-dimension epsilon tolerances. e_d(t) = max(0, tau_d - mu_d(t)) <= eps_d. */
  epsilon: Record<string, number>;
}

/** Result of per-dimension vector finality evaluation. */
export interface VectorFinalityResult {
  dimension_results: DimensionFinalityResult[];
  all_required_passed: boolean;
  veto_triggered: boolean;
  veto_causes: string[];
  global_gates_passed: boolean;
}

/** Per-dimension finality outcome. */
export interface DimensionFinalityResult {
  dimension: string;
  score: number;
  threshold: number;
  gap: number;
  epsilon: number;
  passed: boolean;
  is_veto: boolean;
  is_required: boolean;
  gate_a_monotonic: boolean;
  gate_c_trajectory_ok: boolean;
}

/** Stage 2 Phase 3: ISS cascade monitoring (sheaf propagation stability). */
export interface ISSCascadeConfig {
  enabled?: boolean;
  max_contradiction_rate?: number;
  practical_stability_alert_threshold?: number;
  small_gain_violation_action?: "escalate" | "warn" | "block";
}

export interface FinalityConfig {
  goal_gradient?: GoalGradientConfig;
  convergence?: ConvergenceYamlConfig;
  /** Gate D: optional quiescence; 0/0 = disabled. */
  quiescence?: QuiescenceConfig;
  /** Stage 2: ISS cascade (propagation stability). */
  iss_cascade?: ISSCascadeConfig;
  /** Per-dimension (vector) finality; when enabled replaces scalar threshold. */
  per_dimension_finality?: PerDimensionFinalityConfig;
  finality: Record<CaseStatus, FinalityConditionRule>;
}

const DEFAULT_SNAPSHOT: FinalitySnapshot = {
  claims_active_min_confidence: 0,
  claims_active_count: 0,
  claims_active_avg_confidence: 0,
  contradictions_unresolved_count: 0,
  contradictions_total_count: 0,
  risks_critical_active_count: 0,
  goals_completion_ratio: 0,
  scope_risk_score: 0,
};

/**
 * Load scope snapshot for finality evaluation. Uses semanticGraph.loadFinalitySnapshot when
 * the semantic graph (nodes/edges) exists; otherwise returns default snapshot.
 */
export async function loadFinalitySnapshot(scopeId: string): Promise<FinalitySnapshot> {
  try {
    const { loadFinalitySnapshot: loadFromGraph } = await import("./semanticGraph.js");
    return await loadFromGraph(scopeId);
  } catch {
    return { ...DEFAULT_SNAPSHOT };
  }
}

const FINALITY_PATH = process.env.FINALITY_PATH ?? join(process.cwd(), "finality.yaml");

export function loadFinalityConfig(): FinalityConfig {
  try {
    const raw = readFileSync(FINALITY_PATH, "utf-8");
    const parsed = parseYaml(raw) as FinalityConfig;
    if (!parsed.finality || typeof parsed.finality !== "object") {
      return { finality: {} as Record<CaseStatus, FinalityConditionRule> };
    }
    return parsed;
  } catch {
    return { finality: {} as Record<CaseStatus, FinalityConditionRule> };
  }
}

function evaluateOne(condition: string, snapshot: FinalitySnapshot): boolean {
  return rustEvaluateOne(condition, snapshot);
}

/**
 * Weighted goal score (0–1) for the scope. Used for Path B (goal gradient HITL).
 * Formula: claim_confidence * w1 + contradiction_resolution * w2 + goal_completion * w3 + risk_inverse * w4.
 */
export function computeGoalScore(snapshot: FinalitySnapshot, config?: GoalGradientConfig): number {
  return rustComputeGoalScore(snapshot, config);
}

/**
 * Compute goal score for a scope (loads snapshot and config).
 */
export async function computeGoalScoreForScope(scopeId: string): Promise<number> {
  const snapshot = await loadFinalitySnapshot(scopeId);
  const config = loadFinalityConfig();
  return computeGoalScore(snapshot, config.goal_gradient);
}

/** Normalize condition to "key: op value" string (YAML may give object). */
function conditionToString(c: string | Record<string, unknown>): string {
  if (typeof c === "string") return c;
  const entries = Object.entries(c);
  if (entries.length === 0) return "";
  const [k, v] = entries[0];
  return `${k}: ${typeof v === "string" ? v : String(v)}`;
}

/**
 * Path A: threshold convergence (all conditions met) -> RESOLVED.
 * Path B: goal score in [near, auto) -> return FinalityReviewRequest for HITL.
 */
export interface ConvergenceData {
  rate: number;
  estimated_rounds: number | null;
  plateau_rounds: number;
  lyapunov_v: number;
  highest_pressure: string;
  is_monotonic: boolean;
  is_plateaued: boolean;
  score_history: number[];
  /** Gate C: trajectory quality 0–1; required >= 0.7 for auto RESOLVED. */
  trajectory_quality: number;
  /** Gate C: oscillation detected (blocks or downgrades auto-resolve). */
  oscillation_detected: boolean;
  /** GA_d: per-dimension monotonicity (Issue #18). */
  per_dimension_monotonic?: boolean[];
  /** GC_d: per-dimension trajectory quality (Issue #18). */
  per_dimension_trajectory_quality?: number[];
}

export interface FinalityReviewRequest {
  type: "finality_review";
  scope_id: string;
  goal_score: number;
  near_threshold: number;
  auto_threshold: number;
  gap: number;
  dimension_breakdown: {
    name: string;
    score: number;
    weight: number;
    status: "ok" | "partial" | "blocking";
    detail: string;
  }[];
  blockers: {
    type: string;
    node_ids: string[];
    description: string;
    /** For unresolved_contradiction: full contradiction text. */
    content?: string;
    /** For unresolved_contradiction: parsed sides for "Choose A" / "Choose B" UI. */
    choices?: Array<{ id: string; label: string }>;
  }[];
  llm_explanation: string;
  suggested_actions: string[];
  options: FinalityOption[];
  convergence?: ConvergenceData;
}

export type FinalityOption =
  | { action: "approve_finality"; label: string }
  | { action: "provide_resolution"; label: string }
  | { action: "escalate"; label: string }
  | { action: "defer"; days: number; label: string };

export type FinalityResult =
  | { kind: "status"; status: CaseStatus }
  | { kind: "review"; request: FinalityReviewRequest };

/**
 * Loaded inputs for finality evaluation. Separates I/O (load) from gate logic (evaluate)
 * so callers can test gate behaviour with plain objects.
 */
export interface FinalityInput {
  scopeId: string;
  snapshot: FinalitySnapshot;
  config: FinalityConfig;
  near: number;
  auto: number;
  goalScore: number;
  convergenceData?: ConvergenceData;
  epoch: number;
  hasContent: boolean;
  /** When true, convergence rate indicates divergence; caller should record gate state and return ESCALATED. */
  divergenceDetected?: boolean;
}

/**
 * Load snapshot, config, thresholds, and convergence state for finality evaluation.
 * Records the current convergence point. Does not perform gate evaluation or side effects
 * (emit certificate, record gate state for non-divergence outcomes).
 */
export async function loadFinalityInput(scopeId: string): Promise<FinalityInput> {
  const snapshot = await loadFinalitySnapshot(scopeId);
  const config = loadFinalityConfig();
  const thresholds = getFinalityThresholds();
  const near = config.goal_gradient?.near_finality_threshold ?? thresholds.nearFinalityThreshold;
  const auto = config.goal_gradient?.auto_finality_threshold ?? thresholds.autoFinalityThreshold;
  const goalScore = computeGoalScore(snapshot, config.goal_gradient);

  let epoch = 0;
  try {
    const { loadState } = await import("./stateGraph.js");
    const st = await loadState(scopeId);
    epoch = st?.epoch ?? 0;
  } catch {
    /* state table may not exist */
  }

  const hasContent = snapshot.claims_active_count > 0 || snapshot.goals_completion_ratio < 1;

  let convergenceData: ConvergenceData | undefined;
  let divergenceDetected = false;
  try {
    const {
      computeLyapunovV,
      computePressure,
      computeDimensionScores,
      recordConvergencePoint,
      getConvergenceState,
      DEFAULT_CONVERGENCE_CONFIG,
    } = await import("./convergenceTracker.js");

    const lyapunovV = computeLyapunovV(snapshot, undefined, config.goal_gradient?.weights);
    const pressure = computePressure(snapshot, config.goal_gradient?.weights);
    const dimensionScores = computeDimensionScores(snapshot, config.goal_gradient);

    let contextSeq: number | null = null;
    try {
      const { getLatestPipelineWalSeqForFacts } = await import("./contextWal.js");
      contextSeq = await getLatestPipelineWalSeqForFacts();
    } catch {
      /* WAL table may not exist */
    }
    await recordConvergencePoint(scopeId, epoch, goalScore, lyapunovV, dimensionScores, pressure, undefined, contextSeq);

    const convConfig = {
      ...DEFAULT_CONVERGENCE_CONFIG,
      ...(config.convergence ?? {}),
    };
    const convergence = await getConvergenceState(scopeId, convConfig, auto);
    const divergenceRate = config.convergence?.divergence_rate ?? DEFAULT_CONVERGENCE_CONFIG.divergence_rate;

    try {
      const { recordConvergenceStateMetrics } = await import("./metrics.js");
      recordConvergenceStateMetrics(scopeId, convergence);
    } catch {
      /* metrics may be unavailable */
    }

    convergenceData = {
      rate: convergence.convergence_rate,
      estimated_rounds: convergence.estimated_rounds,
      plateau_rounds: convergence.plateau_rounds,
      lyapunov_v: lyapunovV,
      highest_pressure: convergence.highest_pressure_dimension,
      is_monotonic: convergence.is_monotonic,
      is_plateaued: convergence.is_plateaued,
      score_history: convergence.history.map((p) => p.goal_score),
      trajectory_quality: convergence.trajectory_quality,
      oscillation_detected: convergence.oscillation_detected,
      per_dimension_monotonic: convergence.per_dimension_monotonic,
      per_dimension_trajectory_quality: convergence.per_dimension_trajectory_quality,
    };

    if (convergence.convergence_rate < divergenceRate && convergence.history.length >= 3) {
      divergenceDetected = true;
    }
  } catch (err) {
    try {
      const { logger } = await import("./logger.js");
      logger.warn("convergence tracking unavailable in loadFinalityInput", { scopeId, error: String(err) });
    } catch {
      /* logger unavailable */
    }
  }

  return {
    scopeId,
    snapshot,
    config,
    near,
    auto,
    goalScore,
    convergenceData,
    epoch,
    hasContent,
    divergenceDetected,
  };
}

/** Gate D: true when quiescence is disabled or snapshot meets idle_cycles and window_ms. */
function isQuiescent(snapshot: FinalitySnapshot, quiescence?: QuiescenceConfig): boolean {
  if (!quiescence || (quiescence.idle_cycles_min <= 0 && quiescence.window_ms <= 0)) return true;
  const idle = snapshot.scope_idle_cycles ?? 0;
  const ageMs = snapshot.scope_last_delta_age_ms ?? 0;
  return idle >= quiescence.idle_cycles_min && ageMs >= quiescence.window_ms;
}

async function emitSessionFinalized(scopeId: string): Promise<void> {
  try {
    const { appendEvent } = await import("./contextWal.js");
    await appendEvent({ type: "session_finalized", scope_id: scopeId });
  } catch {
    // WAL may be unavailable
  }
  await emitContribution("finality-evaluator", "assessment", {
    outcome: "RESOLVED",
  }, { scopeId });
}

async function emitFinalityCertificate(scopeId: string): Promise<void> {
  try {
    const { buildCertificatePayload, signCertificate, persistCertificate } = await import("./finalityCertificates.js");
    const payload = buildCertificatePayload(scopeId, "RESOLVED");
    const jws = signCertificate(payload);
    await persistCertificate(scopeId, jws, payload);
  } catch {
    // table or key may be unavailable
  }
}

/** Record gate state for Exp 1/3. No-op if convergence table or columns missing. */
async function recordGateStateIfAvailable(
  scopeId: string,
  epoch: number,
  snapshot: FinalitySnapshot,
  convergence: { is_monotonic: boolean; trajectory_quality: number },
  config: FinalityConfig,
  finalityState: string,
): Promise<void> {
  try {
    const { updateConvergenceGateState } = await import("./convergenceTracker.js");
    const gateB = (snapshot.contradiction_mass ?? 0) === 0 && (snapshot.evidence_coverage ?? 1) >= 0.99;
    await updateConvergenceGateState(scopeId, epoch, {
      gate_a_monotonic: convergence.is_monotonic,
      gate_b_evidence: gateB,
      gate_c_trajectory_ok: convergence.trajectory_quality >= 0.7,
      gate_d_quiescent: isQuiescent(snapshot, config.quiescence),
      gate_e_has_content: snapshot.claims_active_count > 0 || snapshot.goals_completion_ratio < 1,
      finality_state: finalityState,
      unresolved_contradictions: snapshot.contradictions_unresolved_count,
      trajectory_quality: convergence.trajectory_quality,
    });
  } catch (err) {
    try {
      const { logger } = await import("./logger.js");
      logger.warn("recordGateStateIfAvailable failed", { scopeId, epoch, finalityState, error: String(err) });
    } catch {
      /* logger unavailable */
    }
  }
}

/** Seconds to suppress HITL after provide_resolution/defer so resolution can be submitted and processed. */
const HITL_COOLDOWN_SEC = Number(process.env.HITL_RESOLUTION_COOLDOWN_SEC ?? "90");

export async function evaluateFinality(scopeId: string): Promise<FinalityResult | null> {
  // Human-approved finality: skip re-HITL and treat as RESOLVED
  try {
    const { getLatestFinalityDecision } = await import("./finalityDecisions.js");
    const latest = await getLatestFinalityDecision(scopeId);
    if (latest?.option === "approve_finality") {
      await emitSessionFinalized(scopeId);
      await emitFinalityCertificate(scopeId);
      return { kind: "status", status: "RESOLVED" };
    }
    // Cooldown after provide_resolution or defer: avoid re-queuing HITL before resolution is processed
    if (
      HITL_COOLDOWN_SEC > 0 &&
      (latest?.option === "provide_resolution" || latest?.option === "defer")
    ) {
      const createdAt = latest.created_at ? new Date(latest.created_at).getTime() : 0;
      if (Date.now() - createdAt < HITL_COOLDOWN_SEC * 1000) {
        return null; // stay ACTIVE, do not trigger HITL again yet
      }
    }
  } catch {
    // table may not exist or DATABASE_URL unset
  }

  const input = await loadFinalityInput(scopeId);
  const { snapshot, config, near, auto, goalScore, convergenceData, epoch, hasContent } = input;

  // When drift blocks the transition AND there are contradictions to solve, trigger HITL.
  // Only pause for contradictions; otherwise let the flow continue.
  const hasContradictions = (snapshot.contradictions_unresolved_count ?? 0) > 0;
  const BLOCKING_DRIFT_LEVELS = ["high", "critical"];
  try {
    const { loadState } = await import("./stateGraph.js");
    const { makeS3, s3GetText } = await import("./s3.js");
    const st = await loadState(scopeId);
    const lastNode = st?.lastNode;
    if (hasContradictions && (lastNode === "DriftChecked" || lastNode === "EvidencePropagated")) {
      const bucket = process.env.S3_BUCKET ?? "swarm-facts";
      const s3 = makeS3();
      const driftRaw = await s3GetText(s3, bucket, "drift/latest.json");
      const drift = driftRaw
        ? (JSON.parse(driftRaw) as { level?: string; types?: string[]; recommend_hitl?: boolean })
        : { level: "none", types: [] as string[], recommend_hitl: false };
      const driftBlocksAdvancement = (drift.level && BLOCKING_DRIFT_LEVELS.includes(drift.level.toLowerCase())) || drift.recommend_hitl === true;
      if (driftBlocksAdvancement) {
        if (convergenceData) {
          await recordGateStateIfAvailable(scopeId, epoch, snapshot, convergenceData, config, "HITL");
        }
        const dimension_breakdown = buildDimensionBreakdown(snapshot, config.goal_gradient);
        const blockers = await buildBlockers(scopeId, snapshot);
        blockers.push({
          type: "drift_blocking",
          node_ids: [],
          description: `Drift is ${drift.level}; governance blocks advancement until resolved. Provide a resolution to unblock.`,
        });
        return {
          kind: "review",
          request: {
            type: "finality_review",
            scope_id: scopeId,
            goal_score: goalScore,
            near_threshold: near,
            auto_threshold: auto,
            gap: auto - goalScore,
            dimension_breakdown,
            blockers,
            llm_explanation: "",
            suggested_actions: ["Provide a resolution to address the drift and unblock the pipeline"],
            options: [
              { action: "approve_finality", label: "Mark as Resolved now" },
              { action: "provide_resolution", label: "Add resolution to unblock drift" },
              { action: "escalate", label: "Escalate to authority" },
              { action: "defer", days: 7, label: "Defer review (7 days)" },
            ],
            convergence: convergenceData,
          },
        };
      }
    }
  } catch {
    /* S3 or state unavailable — continue with normal flow */
  }

  if (input.divergenceDetected && input.convergenceData) {
    await recordGateStateIfAvailable(
      scopeId,
      input.epoch,
      input.snapshot,
      input.convergenceData,
      input.config,
      "ESCALATED",
    );
    return { kind: "status", status: "ESCALATED" };
  }

  // Gate E: minimum content — do not auto-resolve or trigger HITL when there's no meaningful content.
  if (!hasContent) {
    if (convergenceData) {
      await recordGateStateIfAvailable(scopeId, epoch, snapshot, convergenceData, config, "ACTIVE");
    }
    return { kind: "status", status: "ACTIVE" };
  }

  // Stage 2 Phase 3: ISS cascade monitoring (sheaf propagation stability).
  // When enabled, check small-gain condition; act based on small_gain_violation_action.
  const issConfig = config.iss_cascade;
  if (issConfig?.enabled) {
    try {
      const { loadPropagationHistory } = await import("./evidenceStateManager.js");
      const { computeISSCascadeResult } = await import("./issBridge.js");
      const { PropagationEngine } = await import("./propagationEngine.js");

      const history = await loadPropagationHistory(scopeId, 20);
      if (history.length > 0) {
        const engine = PropagationEngine.create();
        const noiseHistory = history.map((h) => h.perturbation_norm);
        const contradictionHistory = history.map((h) => h.kappa);
        const initialDisagreement = history[0].disagreement_after;
        const issAnalysis = engine.analyzeISS(noiseHistory, contradictionHistory, initialDisagreement);

        const cascadeResult = computeISSCascadeResult({
          psi: 1 - goalScore,
          monotone: convergenceData?.is_monotonic ?? true,
          omega: history[history.length - 1].disagreement_after,
          iss: issAnalysis,
          burden: snapshot.contradictions_unresolved_count,
        });

        if (!cascadeResult.cascade_stable) {
          const action = issConfig.small_gain_violation_action ?? "warn";
          if (action === "escalate") {
            if (convergenceData) {
              await recordGateStateIfAvailable(scopeId, epoch, snapshot, convergenceData, config, "ESCALATED");
            }
            return { kind: "status", status: "ESCALATED" };
          }
          if (action === "block") {
            if (convergenceData) {
              await recordGateStateIfAvailable(scopeId, epoch, snapshot, convergenceData, config, "ACTIVE");
            }
            return null;
          }
          // action === "warn": log and continue
          try {
            const { logger } = await import("./logger.js");
            logger.warn("iss_cascade_violation", { scopeId, cascade_stable: false });
          } catch { /* logger unavailable */ }
        }
      }
    } catch {
      // Propagation not available (no history, missing tables) — graceful degradation
    }
  }

  // Path A: RESOLVED if all hard conditions hold and goal score >= auto
  // Monotonicity gate (Aegean): require stable non-decreasing score for β rounds
  // Gate C: trajectory quality >= 0.7 (no oscillation / spike-drop)
  // Gate D: quiescence (idle_cycles + last_delta_age window) when configured
  const resolvedRule = config.finality?.RESOLVED;
  if (resolvedRule?.conditions?.length) {
    const conditions = resolvedRule.conditions.map(conditionToString);
    const allMet = resolvedRule.mode === "all" && conditions.every((c) => evaluateOne(c, snapshot));
    const gatesDisabled = process.env.FINALITY_GATES_DISABLED === "1";
    const isMonotonic = gatesDisabled || (convergenceData?.is_monotonic ?? true);
    const trajectoryOk = gatesDisabled || ((convergenceData?.trajectory_quality ?? 1) >= 0.7);
    const quiescent = gatesDisabled || isQuiescent(snapshot, config.quiescence);

    const perDimConfig = config.per_dimension_finality;
    const vectorEnabled = perDimConfig?.enabled && !gatesDisabled;

    if (vectorEnabled && convergenceData) {
      // --- Vector (per-dimension) finality: Issue #18 ---
      // F*(t) = AND_d[e_d <= eps_d AND GA_d AND GC_d] AND GB AND GD AND GE
      try {
        const { evaluateVectorFinality } = await import("./sgrsAdapter.js");
        const { computeDimensionScores } = await import("./convergenceTracker.js");
        const dimScores = computeDimensionScores(snapshot, config.goal_gradient);
        const vectorResult = evaluateVectorFinality(
          dimScores,
          perDimConfig,
          convergenceData.per_dimension_monotonic ?? [false, false, false, false],
          convergenceData.per_dimension_trajectory_quality ?? [1, 1, 1, 1],
          {
            a_monotonic: isMonotonic,
            b_evidence: (snapshot.contradiction_mass ?? 0) === 0 && (snapshot.evidence_coverage ?? 1) >= 0.99,
            c_trajectory: trajectoryOk,
            d_quiescent: quiescent,
            e_has_content: hasContent,
            all_passed: false, // computed downstream
          },
          goalScore,
          auto,
        );

        if (allMet && vectorResult.all_required_passed && vectorResult.global_gates_passed && !vectorResult.veto_triggered) {
          await recordGateStateIfAvailable(scopeId, epoch, snapshot, convergenceData, config, "RESOLVED");
          await emitSessionFinalized(scopeId);
          await emitFinalityCertificate(scopeId);
          return { kind: "status", status: "RESOLVED" };
        }

        // Compensation detection: scalar aggregate exceeds threshold but vector blocks.
        // We intentionally do NOT require allMet here — the whole point of compensation
        // is that the weighted average hides a weak dimension.  The hard conditions in
        // finality.RESOLVED overlap with (and are stricter than) the vector thresholds,
        // so requiring allMet would make this check structurally unreachable.
        // Instead we check: scalar score looks good enough + gates stable → but vector disagrees.
        const scalarWouldPass = goalScore >= auto && isMonotonic && trajectoryOk && quiescent;
        if (scalarWouldPass && (!vectorResult.all_required_passed || vectorResult.veto_triggered)) {
          const compensationPayload = {
            scopeId,
            epoch,
            goalScore,
            scalarThreshold: auto,
            hardConditionsMet: allMet,
            vectorResult: {
              all_required_passed: vectorResult.all_required_passed,
              veto_triggered: vectorResult.veto_triggered,
              veto_causes: vectorResult.veto_causes,
              dimension_results: vectorResult.dimension_results,
            },
          };
          try {
            const { logger } = await import("./logger.js");
            logger.warn("compensation_detected", compensationPayload);
          } catch { /* logger unavailable */ }
          // Emit structured event for experiment result collection
          try {
            const { appendEvent } = await import("./contextWal.js");
            await appendEvent({ type: "compensation_detected", ...compensationPayload });
          } catch { /* WAL unavailable */ }
        }
      } catch {
        // Vector finality unavailable (e.g. Rust addon not built) — fall through to scalar
      }
    } else if (allMet && goalScore >= auto && isMonotonic && trajectoryOk && quiescent) {
      // --- Scalar finality (backward compatible) ---
      if (convergenceData) {
        await recordGateStateIfAvailable(scopeId, epoch, snapshot, convergenceData, config, "RESOLVED");
      }
      await emitSessionFinalized(scopeId);
      await emitFinalityCertificate(scopeId);
      return { kind: "status", status: "RESOLVED" };
    }
  }

  // Path B: HITL only when there are unresolved contradictions. Human resolves, flow resumes.
  // Do not block on low confidence, goals, or drift alone.
  const hasBlockingContradictions = (snapshot.contradictions_unresolved_count ?? 0) > 0;
  const hitlMinEpochWhenContra = Number(process.env.HITL_MIN_EPOCH_WHEN_CONTRADICTIONS ?? "0");
  const epochOk = hitlMinEpochWhenContra <= 0 || epoch >= hitlMinEpochWhenContra;
  if (hasBlockingContradictions && goalScore >= near && goalScore < auto && epochOk) {
    if (convergenceData) {
      await recordGateStateIfAvailable(scopeId, epoch, snapshot, convergenceData, config, "HITL");
    }
    const dimension_breakdown = buildDimensionBreakdown(snapshot, config.goal_gradient);
    const blockers = await buildBlockers(scopeId, snapshot);
    const request: FinalityReviewRequest = {
      type: "finality_review",
      scope_id: scopeId,
      goal_score: goalScore,
      near_threshold: near,
      auto_threshold: auto,
      gap: auto - goalScore,
      dimension_breakdown,
      blockers,
      llm_explanation: "",
      suggested_actions: [],
      options: [
        { action: "approve_finality", label: "Mark as Resolved now" },
        { action: "provide_resolution", label: "Add missing resolutions" },
        { action: "escalate", label: "Escalate to authority" },
        { action: "defer", days: 7, label: "Defer review (7 days)" },
      ],
      convergence: convergenceData,
    };
    return { kind: "review", request };
  }

  // Other finality states (ESCALATED, BLOCKED, EXPIRED)
  for (const [status, rule] of Object.entries(config.finality ?? {})) {
    if (status === "RESOLVED" || !rule?.conditions?.length) continue;
    const conditions = rule.conditions.map(conditionToString);
    const matched =
      rule.mode === "all"
        ? conditions.every((c) => evaluateOne(c, snapshot))
        : conditions.some((c) => evaluateOne(c, snapshot));
    if (matched) {
      if (convergenceData) {
        await recordGateStateIfAvailable(scopeId, epoch, snapshot, convergenceData, config, status);
      }
      return { kind: "status", status: status as CaseStatus };
    }
  }

  if (convergenceData) {
    await recordGateStateIfAvailable(scopeId, epoch, snapshot, convergenceData, config, "ACTIVE");
  }
  return null; // ACTIVE
}

function buildDimensionBreakdown(
  snapshot: FinalitySnapshot,
  goalGradient?: GoalGradientConfig,
): FinalityReviewRequest["dimension_breakdown"] {
  const w = goalGradient?.weights ?? {
    claim_confidence: 0.3,
    contradiction_resolution: 0.3,
    goal_completion: 0.25,
    risk_score_inverse: 0.15,
  };
  const clampedRatio = (v: number, t: number) => Math.min(v / t, 1);
  const claimScore = clampedRatio(snapshot.claims_active_avg_confidence, 0.85);
  const contraScore =
    snapshot.contradictions_total_count === 0
      ? 1
      : 1 - snapshot.contradictions_unresolved_count / snapshot.contradictions_total_count;
  const goalScore = snapshot.goals_completion_ratio;
  const riskScore = 1 - Math.min(snapshot.scope_risk_score, 1);

  return [
    {
      name: "claim_confidence",
      score: claimScore,
      weight: w.claim_confidence ?? 0.3,
      status: snapshot.claims_active_min_confidence >= 0.85 ? "ok" : snapshot.claims_active_min_confidence >= 0.65 ? "partial" : "blocking",
      detail: `min ${(snapshot.claims_active_min_confidence * 100).toFixed(0)}%, avg ${(snapshot.claims_active_avg_confidence * 100).toFixed(0)}%`,
    },
    {
      name: "contradiction_resolution",
      score: contraScore,
      weight: w.contradiction_resolution ?? 0.3,
      status: snapshot.contradictions_unresolved_count === 0 ? "ok" : "blocking",
      detail: `${snapshot.contradictions_unresolved_count} of ${snapshot.contradictions_total_count} contradictions unresolved`,
    },
    {
      name: "goal_completion",
      score: goalScore,
      weight: w.goal_completion ?? 0.25,
      status: goalScore >= 0.9 ? "ok" : goalScore >= 0.7 ? "partial" : "blocking",
      detail: `completion ratio ${(goalScore * 100).toFixed(0)}%`,
    },
    {
      name: "risk_score_inverse",
      score: riskScore,
      weight: w.risk_score_inverse ?? 0.15,
      status: snapshot.scope_risk_score < 0.2 ? "ok" : snapshot.scope_risk_score < 0.5 ? "partial" : "blocking",
      detail: `scope risk score ${(snapshot.scope_risk_score * 100).toFixed(0)}%`,
    },
  ];
}

async function buildBlockers(
  scopeId: string,
  snapshot: FinalitySnapshot,
): Promise<FinalityReviewRequest["blockers"]> {
  const out: FinalityReviewRequest["blockers"] = [];
  if (snapshot.contradictions_unresolved_count > 0) {
    try {
      const { loadUnresolvedContradictionDetails } = await import("./semanticGraph.js");
      const details = await loadUnresolvedContradictionDetails(scopeId);
      for (const d of details) {
        const choices: Array<{ id: string; label: string }> = [];
        if (d.side_a) choices.push({ id: "a", label: d.side_a.slice(0, 120) + (d.side_a.length > 120 ? "…" : "") });
        if (d.side_b) choices.push({ id: "b", label: d.side_b.slice(0, 120) + (d.side_b.length > 120 ? "…" : "") });
        const nodeIds = d.node_id ? [d.node_id] : [];
        out.push({
          type: "unresolved_contradiction",
          node_ids: nodeIds,
          description: d.content.slice(0, 200) + (d.content.length > 200 ? "…" : ""),
          content: d.content,
          choices: choices.length > 0 ? choices : undefined,
        });
      }
    } catch {
      out.push({
        type: "unresolved_contradiction",
        node_ids: [],
        description: `${snapshot.contradictions_unresolved_count} unresolved contradiction(s)`,
      });
    }
  }
  if (snapshot.risks_critical_active_count > 0) {
    out.push({
      type: "critical_risk",
      node_ids: [],
      description: `${snapshot.risks_critical_active_count} critical risk(s) active`,
    });
  }
  // Only block on genuinely low confidence (<65%); 80%+ claims are acceptable
  const claimHitlThreshold = 0.65;
  if (snapshot.claims_active_min_confidence < claimHitlThreshold) {
    out.push({
      type: "low_confidence_claims",
      node_ids: [],
      description: `min claim confidence ${(snapshot.claims_active_min_confidence * 100).toFixed(0)}% (need ${claimHitlThreshold * 100}%)`,
    });
  }
  // Goals are aspirational; do not block finality on unresolved goals
  return out;
}

