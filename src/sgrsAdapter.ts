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
  computeContentHashBridge as rustComputeContentHash,
  validateContributionBridge as rustValidateContribution,
  analyzeSpectrumBridge as rustAnalyzeSpectrum,
  propagationStepBridge as rustPropagationStep,
  computeDisagreementBridge as rustComputeDisagreement,
  analyzeIssBridge as rustAnalyzeIss,
  extractContradictionsBridge as rustExtractContradictions,
  analyzeSpectrumTopologyBridge as rustAnalyzeSpectrumTopology,
  propagationStepTopologyBridge as rustPropagationStepTopology,
  getTopologyInfoBridge as rustGetTopologyInfo,
  analyzeSpectrumSheafBridge as rustAnalyzeSpectrumSheaf,
  propagationStepSheafBridge as rustPropagationStepSheaf,
  perDimensionDisagreementBridge as rustPerDimensionDisagreement,
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
  f_elimination_complete: boolean;
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
    f_elimination_complete: dto.fEliminationComplete,
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
        fEliminationComplete: globalGates.f_elimination_complete,
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

// ---------------------------------------------------------------------------
// Causal contribution layer
// ---------------------------------------------------------------------------

export interface ContentHashResult {
  hash: string;
  valid: boolean;
  error?: string;
}

export function computeContentHash(
  parents: string[],
  payload: string,
  kind: string,
): ContentHashResult {
  const dto = timedSgrs("content_hash", () =>
    rustComputeContentHash(parents, payload, kind),
  );
  return {
    hash: dto.hash,
    valid: dto.valid,
    error: dto.error ?? undefined,
  };
}

export interface CausalValidationResult {
  valid: boolean;
  rid_matches: boolean;
  missing_parents: string[];
  error?: string;
}

export function validateContribution(
  rid: string,
  parents: string[],
  payload: string,
  kind: string,
  knownRids: string[],
): CausalValidationResult {
  const dto = timedSgrs("validate_contribution", () =>
    rustValidateContribution(rid, parents, payload, kind, knownRids),
  );
  return {
    valid: dto.valid,
    rid_matches: dto.ridMatches,
    missing_parents: dto.missingParents ?? [],
    error: dto.error ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Propagation / sheaf / ISS
// ---------------------------------------------------------------------------

export interface SpectralAnalysis {
  eigenvalues: number[];
  spectral_gap: number;
  lambda_max: number;
  optimal_alpha: number;
  contraction_rate: number;
  mixing_time_estimate: number;
  is_connected: boolean;
}

export function analyzeSpectrum(numRoles: number, stalkDim: number): SpectralAnalysis {
  const dto = timedSgrs("analyze_spectrum", () =>
    rustAnalyzeSpectrum(numRoles, stalkDim),
  );
  return {
    eigenvalues: dto.eigenvalues ?? [],
    spectral_gap: dto.spectralGap ?? 0,
    lambda_max: dto.lambdaMax ?? 0,
    optimal_alpha: dto.optimalAlpha ?? 0,
    contraction_rate: dto.contractionRate ?? 0,
    mixing_time_estimate: dto.mixingTimeEstimate ?? 0,
    is_connected: dto.isConnected ?? false,
  };
}

export interface PropagationStepResult {
  disagreement_before: number;
  disagreement_after: number;
  contraction_ratio: number;
  perturbation_norm: number;
  contraction_achieved: boolean;
  /** Flattened new state for chaining steps (same layout as input). */
  flat_new_state: number[];
}

export function propagationStep(
  flatState: number[],
  flatPerturbation: number[],
  numRoles: number,
  numDims: number,
  alpha: number,
  supportMin: number,
  supportMax: number,
  refutationMin: number,
  refutationMax: number,
): PropagationStepResult {
  const dto = timedSgrs("propagation_step", () =>
    rustPropagationStep(
      flatState,
      flatPerturbation,
      numRoles,
      numDims,
      alpha,
      supportMin,
      supportMax,
      refutationMin,
      refutationMax,
    ),
  );
  return {
    disagreement_before: dto.disagreementBefore ?? 0,
    disagreement_after: dto.disagreementAfter ?? 0,
    contraction_ratio: dto.contractionRatio ?? 0,
    perturbation_norm: dto.perturbationNorm ?? 0,
    contraction_achieved: dto.contractionAchieved ?? false,
    flat_new_state: dto.flatNewState ?? [],
  };
}

export function computeDisagreement(
  flatState: number[],
  numRoles: number,
  numDims: number,
): number {
  return timedSgrs("compute_disagreement", () =>
    rustComputeDisagreement(flatState, numRoles, numDims),
  );
}

/**
 * Per-dimension disagreement: Ω_d = Σᵢ [(s_{i,d} - s̄_d)² + (r_{i,d} - r̄_d)²].
 * Returns array of length numDims.
 */
export function perDimensionDisagreement(
  flatState: number[],
  numRoles: number,
  numDims: number,
): number[] {
  return timedSgrs("per_dimension_disagreement", () =>
    rustPerDimensionDisagreement(flatState, numRoles, numDims),
  );
}

export interface ISSAnalysis {
  contraction_rate: number;
  contraction_rate_squared: number;
  propagation_gain: number;
  contradiction_rate: number;
  small_gain_satisfied: boolean;
  small_gain_margin: number;
  steady_state_disagreement: number;
  steady_state_contradictions: number;
  convergence_time_estimate: number;
}

export function analyzeISS(
  spectralGap: number,
  alpha: number,
  noiseBound: number,
  contradictionRate: number,
  initialDisagreement: number,
): ISSAnalysis {
  const dto = timedSgrs("analyze_iss", () =>
    rustAnalyzeIss(
      spectralGap,
      alpha,
      noiseBound,
      contradictionRate,
      initialDisagreement,
    ),
  );
  return {
    contraction_rate: dto.contractionRate ?? 0,
    contraction_rate_squared: dto.contractionRateSquared ?? 0,
    propagation_gain: dto.propagationGain ?? 0,
    contradiction_rate: dto.contradictionRate ?? 0,
    small_gain_satisfied: dto.smallGainSatisfied ?? false,
    small_gain_margin: dto.smallGainMargin ?? 0,
    steady_state_disagreement: dto.steadyStateDisagreement ?? 0,
    steady_state_contradictions: dto.steadyStateContradictions ?? 0,
    convergence_time_estimate: dto.convergenceTimeEstimate ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Contradiction extraction
// ---------------------------------------------------------------------------

export interface DetectedContradiction {
  role_i: number;
  role_j: number;
  dimension: number;
  channel: string;
  magnitude: number;
}

export function extractContradictions(
  flatState: number[],
  numRoles: number,
  numDims: number,
  threshold: number,
): DetectedContradiction[] {
  const dtos = timedSgrs("extract_contradictions", () =>
    rustExtractContradictions(flatState, numRoles, numDims, threshold),
  );
  return dtos.map((d: any) => ({
    role_i: d.roleI,
    role_j: d.roleJ,
    dimension: d.dimension,
    channel: d.channel,
    magnitude: d.magnitude,
  }));
}

// ---------------------------------------------------------------------------
// Topology-aware propagation (P1 — Research Progress Program)
// ---------------------------------------------------------------------------

export type TopologyPreset =
  | "complete"
  | "star"
  | "ring"
  | "chain"
  | "random_regular";

export interface TopologyInfo {
  topology: string;
  num_roles: number;
  num_edges: number;
  edge_list: number[];
}

export function getTopologyInfo(
  topology: TopologyPreset,
  numRoles: number,
  degree?: number,
  seed?: number,
): TopologyInfo {
  const dto = timedSgrs("get_topology_info", () =>
    rustGetTopologyInfo(topology, numRoles, degree ?? null, seed ?? null),
  );
  return {
    topology: dto.topology,
    num_roles: dto.numRoles,
    num_edges: dto.numEdges,
    edge_list: dto.edgeList ?? [],
  };
}

export function analyzeSpectrumTopology(
  topology: TopologyPreset,
  numRoles: number,
  stalkDim: number,
  degree?: number,
  seed?: number,
): SpectralAnalysis {
  const dto = timedSgrs("analyze_spectrum_topology", () =>
    rustAnalyzeSpectrumTopology(topology, numRoles, stalkDim, degree ?? null, seed ?? null),
  );
  return {
    eigenvalues: dto.eigenvalues ?? [],
    spectral_gap: dto.spectralGap ?? 0,
    lambda_max: dto.lambdaMax ?? 0,
    optimal_alpha: dto.optimalAlpha ?? 0,
    contraction_rate: dto.contractionRate ?? 0,
    mixing_time_estimate: dto.mixingTimeEstimate ?? 0,
    is_connected: dto.isConnected ?? false,
  };
}

export interface TopologyPropagationOptions {
  topology: TopologyPreset;
  degree?: number;
  seed?: number;
  /** Explicit edge list [u0,v0, u1,v1, ...] — overrides topology preset */
  edges?: number[];
  /** Per-dimension support bounds [min0,max0, min1,max1, ...] */
  support_bounds?: number[];
  /** Per-dimension refutation bounds [min0,max0, min1,max1, ...] */
  refutation_bounds?: number[];
}

export function propagationStepTopology(
  flatState: number[],
  flatPerturbation: number[],
  numRoles: number,
  numDims: number,
  alpha: number,
  options: TopologyPropagationOptions,
): PropagationStepResult {
  const dto = timedSgrs("propagation_step_topology", () =>
    rustPropagationStepTopology(
      flatState,
      flatPerturbation,
      numRoles,
      numDims,
      alpha,
      options.topology,
      options.degree ?? null,
      options.seed ?? null,
      options.edges ?? null,
      options.support_bounds ?? null,
      options.refutation_bounds ?? null,
    ),
  );
  return {
    disagreement_before: dto.disagreementBefore ?? 0,
    disagreement_after: dto.disagreementAfter ?? 0,
    contraction_ratio: dto.contractionRatio ?? 0,
    perturbation_norm: dto.perturbationNorm ?? 0,
    contraction_achieved: dto.contractionAchieved ?? false,
    flat_new_state: dto.flatNewState ?? [],
  };
}

// ---------------------------------------------------------------------------
// Projection sheaf (sheaf grounding: non-identity restriction maps)
// ---------------------------------------------------------------------------

export function analyzeSpectrumSheaf(
  numRoles: number,
  numDims: number,
  roleObservedDims: number[][],
  edges: number[],
): SpectralAnalysis {
  const dto = timedSgrs("analyze_spectrum_sheaf", () =>
    rustAnalyzeSpectrumSheaf(numRoles, numDims, roleObservedDims, edges),
  );
  return {
    eigenvalues: dto.eigenvalues ?? [],
    spectral_gap: dto.spectralGap ?? 0,
    lambda_max: dto.lambdaMax ?? 0,
    optimal_alpha: dto.optimalAlpha ?? 0,
    contraction_rate: dto.contractionRate ?? 0,
    mixing_time_estimate: dto.mixingTimeEstimate ?? 0,
    is_connected: dto.isConnected ?? false,
  };
}

export interface SheafPropagationOptions {
  roleObservedDims: number[][];
  edges: number[];
  supportBounds?: number[];
  refutationBounds?: number[];
}

export function propagationStepSheaf(
  flatState: number[],
  flatPerturbation: number[],
  numRoles: number,
  numDims: number,
  alpha: number,
  options: SheafPropagationOptions,
): PropagationStepResult {
  const dto = timedSgrs("propagation_step_sheaf", () =>
    rustPropagationStepSheaf(
      flatState,
      flatPerturbation,
      numRoles,
      numDims,
      alpha,
      options.roleObservedDims,
      options.edges,
      options.supportBounds ?? null,
      options.refutationBounds ?? null,
    ),
  );
  return {
    disagreement_before: dto.disagreementBefore ?? 0,
    disagreement_after: dto.disagreementAfter ?? 0,
    contraction_ratio: dto.contractionRatio ?? 0,
    perturbation_norm: dto.perturbationNorm ?? 0,
    contraction_achieved: dto.contractionAchieved ?? false,
    flat_new_state: dto.flatNewState ?? [],
  };
}
