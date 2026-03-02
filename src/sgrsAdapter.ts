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
} from "../sgrs-core/index.js";
import type {
  FinalitySnapshotDto,
  WeightsDto,
  ConvergencePointDto,
  ConvergenceConfigDto,
  ConvergenceOutputDto,
} from "../sgrs-core/index.js";
import type { FinalitySnapshot, GoalGradientConfig } from "./finalityEvaluator.js";
import type { ConvergencePoint, ConvergenceConfig, ConvergenceState } from "./convergenceTracker.js";

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
  };
}

// ---------------------------------------------------------------------------
// Public API — drop-in replacements for v1 pure functions
// ---------------------------------------------------------------------------

export function computeDimensionScores(
  snapshot: FinalitySnapshot,
  _config?: GoalGradientConfig,
): Record<string, number> {
  const dto = rustComputeDimensionScores(toSnapshotDto(snapshot));
  return fromDimensionScoresDto(dto);
}

export function computeLyapunovV(
  snapshot: FinalitySnapshot,
  _targets?: unknown,
  weights?: GoalGradientConfig["weights"],
): number {
  return rustComputeScalarV(toSnapshotDto(snapshot), toWeightsDto(weights));
}

export function computePressure(
  snapshot: FinalitySnapshot,
  weights?: GoalGradientConfig["weights"],
): Record<string, number> {
  const dto = rustComputePressure(toSnapshotDto(snapshot), toWeightsDto(weights));
  return fromDimensionScoresDto(dto);
}

export function analyzeConvergence(
  history: ConvergencePoint[],
  config: ConvergenceConfig,
  autoThreshold: number = 0.92,
): ConvergenceState {
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
}
