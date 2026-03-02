use napi_derive::napi;

use crate::convergence::{self, ConvergenceConfig, ConvergencePointInput, SnapshotInput};
use crate::types::{DimensionId, DEFAULT_WEIGHTS};

// ---------------------------------------------------------------------------
// DTOs — napi-rs structs at the FFI boundary
// ---------------------------------------------------------------------------

#[napi(object)]
pub struct FinalitySnapshotDto {
    pub claims_active_avg_confidence: f64,
    pub contradictions_unresolved_count: u32,
    pub contradictions_total_count: u32,
    pub goals_completion_ratio: f64,
    pub scope_risk_score: f64,
    // Additional fields passed through for Phase 1
    pub claims_active_count: Option<u32>,
    pub claims_active_min_confidence: Option<f64>,
    pub risks_critical_active_count: Option<u32>,
}

/// Dimension scores using v1 field names for backward compatibility.
#[napi(object)]
pub struct DimensionScoresDto {
    pub claim_confidence: f64,
    pub contradiction_resolution: f64,
    pub goal_completion: f64,
    pub risk_score_inverse: f64,
}

/// Per-dimension pressure using v1 field names.
#[napi(object)]
pub struct PressureDto {
    pub claim_confidence: f64,
    pub contradiction_resolution: f64,
    pub goal_completion: f64,
    pub risk_score_inverse: f64,
}

/// Optional weights for V(t) and pressure computation.
#[napi(object)]
pub struct WeightsDto {
    pub claim_confidence: f64,
    pub contradiction_resolution: f64,
    pub goal_completion: f64,
    pub risk_score_inverse: f64,
}

/// A single convergence history point.
#[napi(object)]
pub struct ConvergencePointDto {
    pub epoch: u32,
    pub goal_score: f64,
    pub lyapunov_v: f64,
    pub claim_confidence: f64,
    pub contradiction_resolution: f64,
    pub goal_completion: f64,
    pub risk_score_inverse: f64,
    pub pressure_claim_confidence: f64,
    pub pressure_contradiction_resolution: f64,
    pub pressure_goal_completion: f64,
    pub pressure_risk_score_inverse: f64,
    pub context_seq: Option<u32>,
}

/// Convergence analysis configuration.
#[napi(object)]
pub struct ConvergenceConfigDto {
    pub beta: u32,
    pub tau: u32,
    pub ema_alpha: f64,
    pub plateau_threshold: f64,
    pub divergence_rate: f64,
    pub history_depth: u32,
    pub q_direction_penalty: f64,
    pub q_max_directions: u32,
    pub q_autocorr_threshold: f64,
    pub q_oscillation_cap: f64,
    pub q_spike_drop_cap: f64,
}

/// Convergence analysis output.
#[napi(object)]
pub struct ConvergenceOutputDto {
    pub convergence_rate: f64,
    pub alpha_intra: f64,
    pub cross_epoch_count: u32,
    pub cross_epoch_v_delta_avg: f64,
    pub stalled_dimensions: Vec<String>,
    pub estimated_rounds: Option<u32>,
    pub is_monotonic: bool,
    pub is_plateaued: bool,
    pub plateau_rounds: u32,
    pub highest_pressure_dimension: String,
    pub oscillation_detected: bool,
    pub trajectory_quality: f64,
    pub autocorrelation_lag1: Option<f64>,
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

fn snapshot_from_dto(dto: &FinalitySnapshotDto) -> SnapshotInput {
    SnapshotInput {
        claims_active_avg_confidence: dto.claims_active_avg_confidence,
        contradictions_unresolved_count: dto.contradictions_unresolved_count,
        contradictions_total_count: dto.contradictions_total_count,
        goals_completion_ratio: dto.goals_completion_ratio,
        scope_risk_score: dto.scope_risk_score,
    }
}

fn weights_from_dto(dto: &Option<WeightsDto>) -> [f64; 4] {
    match dto {
        Some(w) => [
            w.claim_confidence,
            w.contradiction_resolution,
            w.goal_completion,
            w.risk_score_inverse,
        ],
        None => DEFAULT_WEIGHTS,
    }
}

fn scores_to_dto(scores: &[f64; 4]) -> DimensionScoresDto {
    DimensionScoresDto {
        claim_confidence: scores[0],
        contradiction_resolution: scores[1],
        goal_completion: scores[2],
        risk_score_inverse: scores[3],
    }
}

fn pressure_to_dto(pressure: &[f64; 4]) -> PressureDto {
    PressureDto {
        claim_confidence: pressure[0],
        contradiction_resolution: pressure[1],
        goal_completion: pressure[2],
        risk_score_inverse: pressure[3],
    }
}

fn point_from_dto(dto: &ConvergencePointDto) -> ConvergencePointInput {
    ConvergencePointInput {
        epoch: dto.epoch as u64,
        goal_score: dto.goal_score,
        lyapunov_v: dto.lyapunov_v,
        dimension_scores: [
            dto.claim_confidence,
            dto.contradiction_resolution,
            dto.goal_completion,
            dto.risk_score_inverse,
        ],
        pressure: [
            dto.pressure_claim_confidence,
            dto.pressure_contradiction_resolution,
            dto.pressure_goal_completion,
            dto.pressure_risk_score_inverse,
        ],
        context_seq: dto.context_seq.map(|s| s as u64),
    }
}

fn config_from_dto(dto: &ConvergenceConfigDto) -> ConvergenceConfig {
    ConvergenceConfig {
        beta: dto.beta as usize,
        tau: dto.tau as usize,
        ema_alpha: dto.ema_alpha,
        plateau_threshold: dto.plateau_threshold,
        divergence_rate: dto.divergence_rate,
        history_depth: dto.history_depth as usize,
        q_direction_penalty: dto.q_direction_penalty,
        q_max_directions: dto.q_max_directions as usize,
        q_autocorr_threshold: dto.q_autocorr_threshold,
        q_oscillation_cap: dto.q_oscillation_cap,
        q_spike_drop_cap: dto.q_spike_drop_cap,
    }
}

fn dim_to_v1_name(dim: &DimensionId) -> String {
    dim.v1_name().to_string()
}

// ---------------------------------------------------------------------------
// Bridge functions — #[napi] exports
// ---------------------------------------------------------------------------

/// Compute dimension scores from a FinalitySnapshot.
/// Returns per-dimension values in [0, 1] where 1 = at target.
#[napi]
pub fn compute_dimension_scores(snapshot: FinalitySnapshotDto) -> DimensionScoresDto {
    let s = snapshot_from_dto(&snapshot);
    let scores = convergence::compute_dimension_scores(&s);
    scores_to_dto(&scores)
}

/// Compute scalar Lyapunov V(t) — derived diagnostic, NOT used for admissibility.
#[napi]
pub fn compute_scalar_v(snapshot: FinalitySnapshotDto, weights: Option<WeightsDto>) -> f64 {
    let s = snapshot_from_dto(&snapshot);
    let scores = convergence::compute_dimension_scores(&s);
    let w = weights_from_dto(&weights);
    convergence::scalar_lyapunov_v(&scores, &crate::types::DEFAULT_TARGETS, &w)
}

/// Compute per-dimension pressure (distance from target, weighted).
#[napi]
pub fn compute_pressure(snapshot: FinalitySnapshotDto, weights: Option<WeightsDto>) -> PressureDto {
    let s = snapshot_from_dto(&snapshot);
    let scores = convergence::compute_dimension_scores(&s);
    let w = weights_from_dto(&weights);
    let pressure = convergence::compute_pressure(&scores, &w);
    pressure_to_dto(&pressure)
}

/// Full convergence analysis from history points.
#[napi]
pub fn analyze_convergence_bridge(
    history: Vec<ConvergencePointDto>,
    config: ConvergenceConfigDto,
    auto_threshold: f64,
) -> ConvergenceOutputDto {
    let is_empty = history.is_empty();
    let points: Vec<ConvergencePointInput> = history.iter().map(point_from_dto).collect();
    let cfg = config_from_dto(&config);
    let result = convergence::analyze_convergence(&points, &cfg, auto_threshold);

    ConvergenceOutputDto {
        convergence_rate: result.convergence_rate,
        alpha_intra: result.alpha_intra,
        cross_epoch_count: result.cross_epoch_count as u32,
        cross_epoch_v_delta_avg: result.cross_epoch_v_delta_avg,
        stalled_dimensions: result.stalled_dimensions.iter().map(|d| dim_to_v1_name(d)).collect(),
        estimated_rounds: result.estimated_rounds,
        is_monotonic: result.is_monotonic,
        is_plateaued: result.is_plateaued,
        plateau_rounds: result.plateau_rounds,
        // v1 compat: empty history returns "" for highest_pressure_dimension
        highest_pressure_dimension: if is_empty {
            String::new()
        } else {
            dim_to_v1_name(&result.highest_pressure_dimension)
        },
        oscillation_detected: result.oscillation_detected,
        trajectory_quality: result.trajectory_quality,
        autocorrelation_lag1: result.autocorrelation_lag1,
    }
}
