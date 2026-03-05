/**
 * Adapter between v1 TypeScript types and the Rust sgrs-core native addon.
 *
 * Handles the naming convention differences:
 *   - v1 TS: snake_case record keys (claim_confidence, risk_score_inverse)
 *   - Rust bridge DTOs: camelCase (claimConfidence, riskScoreInverse) via napi-rs convention
 *
 * All functions are thin wrappers — no logic, just type conversion.
 */

import {
  computeDimensionScores as rustComputeDimensionScores,
  computeScalarV as rustComputeScalarV,
  computePressure as rustComputePressure,
  analyzeConvergenceBridge,
  computeGoalScoreBridge as rustComputeGoalScore,
  evaluateGatesBridge as rustEvaluateGates,
  evaluateConditionsBridge as rustEvaluateConditions,
  evaluateSingleCondition as rustEvaluateSingleCondition,
  evaluateGovernanceRules as rustEvaluateGovernanceRules,
  canGovernanceTransition as rustCanGovernanceTransition,
  evaluateKernel as rustEvaluateKernel,
  evaluateVectorFinalityBridge as rustEvaluateVectorFinality,
} from "../sgrs-core/index.js";
import type {
  FinalitySnapshotDto,
  FinalitySnapshotFullDto,
  WeightsDto,
  ConvergencePointDto,
  ConvergenceConfigDto,
  ConvergenceOutputDto,
  GateConfigDto,
  GateStateDto,
  ConditionResultDto,
  GovernanceRulesConfigDto,
  KernelInputDto,
  KernelOutputDto,
  TransitionDecisionDto,
  LatticePointDto,
} from "../sgrs-core/index.js";
import type {
  FinalitySnapshot,
  GoalGradientConfig,
  QuiescenceConfig,
  PerDimensionFinalityConfig,
  VectorFinalityResult,
} from "./finalityEvaluator.js";
import type { ConvergencePoint, ConvergenceConfig, ConvergenceState } from "./convergenceTracker.js";
import type { GovernanceConfig, DriftInput, TransitionDecision, PolicyRule, TransitionRule } from "./governance.js";
import { recordSgrsCall } from "./metrics.js";

function timedSgrs<T>(operation: string, fn: () => T): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    recordSgrsCall(operation, performance.now() - start);
  }
}

// ---------------------------------------------------------------------------
// Input conversion: v1 TS → Rust DTOs
// ---------------------------------------------------------------------------

function toSnapshotDto(snapshot: FinalitySnapshot): FinalitySnapshotDto {
  return {
    claimsActiveAvgConfidence: snapshot.claims_active_avg_confidence,
    contradictionsUnresolvedCount: snapshot.contradictions_unresolved_count,
    contradictionsTotalCount: snapshot.contradictions_total_count,
    goalsCompletionRatio: snapshot.goals_completion_ratio,
    scopeRiskScore: snapshot.scope_risk_score,
    claimsActiveCount: snapshot.claims_active_count,
    claimsActiveMinConfidence: snapshot.claims_active_min_confidence,
    risksCriticalActiveCount: snapshot.risks_critical_active_count,
  };
}

function toWeightsDto(
  weights?: GoalGradientConfig["weights"],
): WeightsDto | undefined {
  if (!weights) return undefined;
  return {
    claimConfidence: weights.claim_confidence,
    contradictionResolution: weights.contradiction_resolution,
    goalCompletion: weights.goal_completion,
    riskScoreInverse: weights.risk_score_inverse,
  };
}

function toConvergencePointDto(point: ConvergencePoint): ConvergencePointDto {
  const ds = point.dimension_scores;
  const pr = point.pressure;
  return {
    epoch: point.epoch,
    goalScore: point.goal_score,
    lyapunovV: point.lyapunov_v,
    claimConfidence: ds.claim_confidence ?? 0,
    contradictionResolution: ds.contradiction_resolution ?? 0,
    goalCompletion: ds.goal_completion ?? 0,
    riskScoreInverse: ds.risk_score_inverse ?? 0,
    pressureClaimConfidence: pr.claim_confidence ?? 0,
    pressureContradictionResolution: pr.contradiction_resolution ?? 0,
    pressureGoalCompletion: pr.goal_completion ?? 0,
    pressureRiskScoreInverse: pr.risk_score_inverse ?? 0,
    contextSeq: point.context_seq ?? undefined,
  };
}

function toConvergenceConfigDto(config: ConvergenceConfig): ConvergenceConfigDto {
  return {
    beta: config.beta,
    tau: config.tau,
    emaAlpha: config.ema_alpha,
    plateauThreshold: config.plateau_threshold,
    divergenceRate: config.divergence_rate,
    historyDepth: config.history_depth,
    qDirectionPenalty: config.q_direction_penalty,
    qMaxDirections: config.q_max_directions,
    qAutocorrThreshold: config.q_autocorr_threshold,
    qOscillationCap: config.q_oscillation_cap,
    qSpikeDropCap: config.q_spike_drop_cap,
  };
}

function toFinalitySnapshotFullDto(snapshot: FinalitySnapshot): FinalitySnapshotFullDto {
  return {
    claimsActiveAvgConfidence: snapshot.claims_active_avg_confidence,
    claimsActiveMinConfidence: snapshot.claims_active_min_confidence,
    claimsActiveCount: snapshot.claims_active_count,
    contradictionsUnresolvedCount: snapshot.contradictions_unresolved_count,
    contradictionsTotalCount: snapshot.contradictions_total_count,
    risksCriticalActiveCount: snapshot.risks_critical_active_count,
    goalsCompletionRatio: snapshot.goals_completion_ratio,
    scopeRiskScore: snapshot.scope_risk_score,
    scopeIdleCycles: snapshot.scope_idle_cycles,
    scopeLastDeltaAgeMs: snapshot.scope_last_delta_age_ms,
    scopeLastActiveAgeMs: snapshot.scope_last_active_age_ms,
    assessmentsCriticalUnaddressedCount: snapshot.assessments_critical_unaddressed_count,
    contradictionMass: snapshot.contradiction_mass,
    evidenceCoverage: snapshot.evidence_coverage,
  };
}

function toGateConfigDto(config?: {
  gate_b_enforced?: boolean;
  trajectory_quality_threshold?: number;
  quiescence?: QuiescenceConfig;
}): GateConfigDto {
  return {
    gateBEnforced: config?.gate_b_enforced ?? false,
    trajectoryQualityThreshold: config?.trajectory_quality_threshold ?? 0.7,
    quiescenceMaxUnresolved: config?.quiescence?.idle_cycles_min != null ? 999 : 0,
    quiescenceMaxRisks: config?.quiescence?.window_ms != null ? 999 : 0,
  };
}

// ---------------------------------------------------------------------------
// Output conversion: Rust DTOs → v1 TS
// ---------------------------------------------------------------------------

function fromDimensionScoresDto(
  dto: { claimConfidence: number; contradictionResolution: number; goalCompletion: number; riskScoreInverse: number },
): Record<string, number> {
  return {
    claim_confidence: dto.claimConfidence,
    contradiction_resolution: dto.contradictionResolution,
    goal_completion: dto.goalCompletion,
    risk_score_inverse: dto.riskScoreInverse,
  };
}

function fromConvergenceOutputDto(
  dto: ConvergenceOutputDto,
  history: ConvergencePoint[],
): ConvergenceState {
  return {
    history,
    convergence_rate: dto.convergenceRate,
    alpha_intra: dto.alphaIntra,
    cross_epoch_count: dto.crossEpochCount,
    cross_epoch_v_delta_avg: dto.crossEpochVDeltaAvg,
    stalled_dimensions: dto.stalledDimensions,
    estimated_rounds: dto.estimatedRounds ?? null,
    is_monotonic: dto.isMonotonic,
    is_plateaued: dto.isPlateaued,
    plateau_rounds: dto.plateauRounds,
    highest_pressure_dimension: dto.highestPressureDimension,
    oscillation_detected: dto.oscillationDetected,
    trajectory_quality: dto.trajectoryQuality,
    autocorrelation_lag1: dto.autocorrelationLag1 ?? null,
    coordination_signal: dto.highestPressureDimension
      ? {
          signal_type: "convergence",
          value: dto.estimatedRounds ?? undefined,
          metadata: {
            highest_pressure_dimension: dto.highestPressureDimension,
            oscillation_detected: dto.oscillationDetected,
            trajectory_quality: dto.trajectoryQuality,
            autocorrelation_lag1: dto.autocorrelationLag1 ?? undefined,
          },
        }
      : null,
    // Per-dimension gates (Issue #18: non-scalar finality)
    per_dimension_monotonic: dto.perDimensionMonotonic ?? [false, false, false, false],
    per_dimension_trajectory_quality: dto.perDimensionTrajectoryQuality ?? [1.0, 1.0, 1.0, 1.0],
  };
}

// ---------------------------------------------------------------------------
// Public API — drop-in replacements for v1 pure functions
// ---------------------------------------------------------------------------

export function computeDimensionScores(
  snapshot: FinalitySnapshot,
  _config?: GoalGradientConfig,
): Record<string, number> {
  const dto = timedSgrs("dimension_scores", () => rustComputeDimensionScores(toSnapshotDto(snapshot)));
  return fromDimensionScoresDto(dto);
}

export function computeLyapunovV(
  snapshot: FinalitySnapshot,
  _targets?: unknown,
  weights?: GoalGradientConfig["weights"],
): number {
  return timedSgrs("scalar_v", () => rustComputeScalarV(toSnapshotDto(snapshot), toWeightsDto(weights)));
}

export function computePressure(
  snapshot: FinalitySnapshot,
  weights?: GoalGradientConfig["weights"],
): Record<string, number> {
  const dto = timedSgrs("pressure", () => rustComputePressure(toSnapshotDto(snapshot), toWeightsDto(weights)));
  return fromDimensionScoresDto(dto);
}

export function analyzeConvergence(
  history: ConvergencePoint[],
  config: ConvergenceConfig,
  autoThreshold: number = 0.92,
): ConvergenceState {
  return timedSgrs("analyze_convergence", () => {
    if (history.length === 0) {
      return fromConvergenceOutputDto(
        analyzeConvergenceBridge([], toConvergenceConfigDto(config), autoThreshold),
        history,
      );
    }
    const pointDtos = history.map(toConvergencePointDto);
    const outputDto = analyzeConvergenceBridge(
      pointDtos,
      toConvergenceConfigDto(config),
      autoThreshold,
    );
    return fromConvergenceOutputDto(outputDto, history);
  });
}

// ---------------------------------------------------------------------------
// Phase 1: Finality — drop-in replacements
// ---------------------------------------------------------------------------

export function computeGoalScore(
  snapshot: FinalitySnapshot,
  config?: GoalGradientConfig,
): number {
  return timedSgrs("goal_score", () => rustComputeGoalScore(toSnapshotDto(snapshot), toWeightsDto(config?.weights)));
}

export interface GateState {
  a_monotonic: boolean;
  b_evidence: boolean;
  c_trajectory: boolean;
  d_quiescent: boolean;
  e_has_content: boolean;
  all_passed: boolean;
}

export function evaluateGates(
  snapshot: FinalitySnapshot,
  isMonotonic: boolean,
  trajectoryQuality: number,
  config?: {
    gate_b_enforced?: boolean;
    trajectory_quality_threshold?: number;
    quiescence?: QuiescenceConfig;
  },
): GateState {
  const dto = timedSgrs("gates", () =>
    rustEvaluateGates(
      toFinalitySnapshotFullDto(snapshot),
      isMonotonic,
      trajectoryQuality,
      toGateConfigDto(config),
    ),
  );
  return {
    a_monotonic: dto.aMonotonic,
    b_evidence: dto.bEvidence,
    c_trajectory: dto.cTrajectory,
    d_quiescent: dto.dQuiescent,
    e_has_content: dto.eHasContent,
    all_passed: dto.allPassed,
  };
}

export function evaluateConditions(
  conditions: string[],
  mode: "all" | "any",
  snapshot: FinalitySnapshot,
): boolean {
  return timedSgrs("conditions", () =>
    rustEvaluateConditions(conditions, mode, toFinalitySnapshotFullDto(snapshot)),
  );
}

export function evaluateOne(
  condition: string,
  snapshot: FinalitySnapshot,
): boolean {
  const result = timedSgrs("single_condition", () =>
    rustEvaluateSingleCondition(condition, toFinalitySnapshotFullDto(snapshot)),
  );
  return result.met;
}

// ---------------------------------------------------------------------------
// Phase 2: Governance — drop-in replacements
// ---------------------------------------------------------------------------

function toGovernanceRulesConfigDto(config: GovernanceConfig): GovernanceRulesConfigDto {
  return {
    rules: (config.rules ?? []).map((r: PolicyRule) => ({
      whenDriftLevels: r.when.drift_level,
      whenDriftType: r.when.drift_type,
      action: r.action,
    })),
    transitionRules: (config.transition_rules ?? []).map((r: TransitionRule) => ({
      from: r.from,
      to: r.to,
      blockWhenDriftLevels: r.block_when.drift_level,
      reason: r.reason,
    })),
  };
}

export function evaluateRules(drift: DriftInput, config: GovernanceConfig): string[] {
  return timedSgrs("governance_rules", () =>
    rustEvaluateGovernanceRules(
      drift.level,
      drift.types,
      toGovernanceRulesConfigDto(config),
    ),
  );
}

export function canTransition(
  from: string,
  to: string,
  drift: DriftInput,
  config: GovernanceConfig,
): TransitionDecision {
  const dto = timedSgrs("can_transition", () =>
    rustCanGovernanceTransition(
      from,
      to,
      drift.level,
      toGovernanceRulesConfigDto(config),
    ),
  );
  return { allowed: dto.allowed, reason: dto.reason };
}

export interface KernelInput {
  from_state: string;
  to_state: string;
  drift_level: string;
  drift_types: string[];
  mode: string;
  current_lattice?: { governance_level: string; dimensions: number[]; epoch: number };
  proposed_lattice?: { governance_level: string; dimensions: number[]; epoch: number };
}

export interface KernelOutput {
  verdict: string;
  reason: string;
  suggested_actions: string[];
  admissibility?: string;
  regressed_dimensions?: string[];
}

function toLatticePointDto(
  lp: { governance_level: string; dimensions: number[]; epoch: number },
): LatticePointDto {
  return {
    governanceLevel: lp.governance_level,
    dimensions: lp.dimensions,
    epoch: lp.epoch,
  };
}

export function evaluateKernel(
  input: KernelInput,
  config: GovernanceConfig,
): KernelOutput {
  const inputDto: KernelInputDto = {
    fromState: input.from_state,
    toState: input.to_state,
    driftLevel: input.drift_level,
    driftTypes: input.drift_types,
    mode: input.mode,
    currentLattice: input.current_lattice ? toLatticePointDto(input.current_lattice) : undefined,
    proposedLattice: input.proposed_lattice ? toLatticePointDto(input.proposed_lattice) : undefined,
  };
  const output = timedSgrs("kernel", () =>
    rustEvaluateKernel(inputDto, toGovernanceRulesConfigDto(config)),
  );
  return {
    verdict: output.verdict,
    reason: output.reason,
    suggested_actions: output.suggestedActions,
    admissibility: output.admissibility ?? undefined,
    regressed_dimensions: output.regressedDimensions ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Issue #18: Vector finality
// ---------------------------------------------------------------------------

const DIM_NAMES = ["claim_confidence", "contradiction_resolution", "goal_completion", "risk_score_inverse"];

/**
 * Evaluate vector (per-dimension) finality predicate via Rust core.
 *
 * F*(t) = AND_d[e_d <= eps_d AND GA_d AND GC_d] AND GB AND GD AND GE
 */
export function evaluateVectorFinality(
  dimensionScores: Record<string, number>,
  perDimConfig: PerDimensionFinalityConfig,
  perDimMonotonic: boolean[],
  perDimTrajectory: number[],
  globalGates: GateState,
  scalarScore: number,
  scalarThreshold: number,
): VectorFinalityResult {
  const scores = DIM_NAMES.map((n) => dimensionScores[n] ?? 0);
  const thresholds = DIM_NAMES.map((n) => perDimConfig.dimension_thresholds[n] ?? 0.85);
  const epsilon = DIM_NAMES.map((n) => perDimConfig.epsilon[n] ?? 0.02);
  const required = DIM_NAMES.map((n) => perDimConfig.required_dimensions.includes(n));
  const veto = DIM_NAMES.map((n) => perDimConfig.veto_dimensions.includes(n));

  const dto = timedSgrs("vector_finality", () =>
    rustEvaluateVectorFinality(
      scores,
      {
        thresholds,
        epsilon,
        required,
        veto,
        trajectoryQualityThreshold: 0.7,
      },
      perDimMonotonic,
      perDimTrajectory,
      {
        aMonotonic: globalGates.a_monotonic,
        bEvidence: globalGates.b_evidence,
        cTrajectory: globalGates.c_trajectory,
        dQuiescent: globalGates.d_quiescent,
        eHasContent: globalGates.e_has_content,
        allPassed: globalGates.all_passed,
      },
      scalarScore,
      scalarThreshold,
    ),
  );

  return {
    dimension_results: dto.dimensionResults.map((dr: any) => ({
      dimension: dr.dimension,
      score: dr.score,
      threshold: dr.threshold,
      gap: dr.gap,
      epsilon: dr.epsilon,
      passed: dr.passed,
      is_veto: dr.isVeto,
      is_required: dr.isRequired,
      gate_a_monotonic: dr.gateAMonotonic,
      gate_c_trajectory_ok: dr.gateCTrajectoryOk,
    })),
    all_required_passed: dto.allRequiredPassed,
    veto_triggered: dto.vetoTriggered,
    veto_causes: dto.vetoCauses,
    global_gates_passed: dto.globalGatesPassed,
  };
}
