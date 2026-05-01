//! JavaScript-facing N-API surface. Symbols are invoked from Node via napi-rs; rustc cannot see
//! those references, so `dead_code` is suppressed for FFI entrypoints.
#![allow(dead_code)]

use napi_derive::napi;

use crate::causal;
use crate::convergence::{self, ConvergenceConfig, ConvergencePointInput, SnapshotInput};
use crate::finality::{self, ConditionMode, FinalitySnapshotFull, GateConfig, GateState};
use crate::governance;
use crate::propagation;
use crate::types::{
    AdmissibilityResult, ConvergenceRank, DimensionId, GovernanceLevel, LatticePoint,
    DEFAULT_WEIGHTS,
};

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

// ---------------------------------------------------------------------------
// Phase 1: Finality DTOs
// ---------------------------------------------------------------------------

/// Extended snapshot for finality condition evaluation.
#[napi(object)]
pub struct FinalitySnapshotFullDto {
    pub claims_active_avg_confidence: f64,
    pub claims_active_min_confidence: Option<f64>,
    pub claims_active_count: Option<u32>,
    pub contradictions_unresolved_count: u32,
    pub contradictions_total_count: u32,
    pub risks_critical_active_count: Option<u32>,
    pub goals_completion_ratio: f64,
    pub scope_risk_score: f64,
    pub scope_idle_cycles: Option<u32>,
    pub scope_last_delta_age_ms: Option<f64>,
    pub scope_last_active_age_ms: Option<f64>,
    pub assessments_critical_unaddressed_count: Option<u32>,
    pub contradiction_mass: Option<f64>,
    pub evidence_coverage: Option<f64>,
    pub elimination_complete: Option<bool>,
}

/// Finality gate configuration.
#[napi(object)]
pub struct GateConfigDto {
    pub gate_b_enforced: bool,
    pub trajectory_quality_threshold: f64,
    pub quiescence_max_unresolved: u32,
    pub quiescence_max_risks: u32,
    pub gate_f_enforced: Option<bool>,
    pub elimination_refutation_threshold: Option<f64>,
}

/// State of all six finality gates (A–F).
#[napi(object)]
pub struct GateStateDto {
    pub a_monotonic: bool,
    pub b_evidence: bool,
    pub c_trajectory: bool,
    pub d_quiescent: bool,
    pub e_has_content: bool,
    pub f_elimination_complete: bool,
    pub all_passed: bool,
}

/// Result of evaluating a single finality condition.
#[napi(object)]
pub struct ConditionResultDto {
    pub key: String,
    pub op: String,
    pub target: f64,
    pub actual: Option<f64>,
    pub met: bool,
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
    // Per-dimension gates (Issue #18: non-scalar finality)
    pub per_dimension_monotonic: Vec<bool>,
    pub per_dimension_trajectory_quality: Vec<f64>,
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

fn full_snapshot_from_dto(dto: &FinalitySnapshotFullDto) -> FinalitySnapshotFull {
    FinalitySnapshotFull {
        claims_active_avg_confidence: dto.claims_active_avg_confidence,
        contradictions_unresolved_count: dto.contradictions_unresolved_count,
        contradictions_total_count: dto.contradictions_total_count,
        goals_completion_ratio: dto.goals_completion_ratio,
        scope_risk_score: dto.scope_risk_score,
        claims_active_min_confidence: dto
            .claims_active_min_confidence
            .unwrap_or(dto.claims_active_avg_confidence),
        claims_active_count: dto.claims_active_count.unwrap_or(1),
        risks_critical_active_count: dto.risks_critical_active_count.unwrap_or(0),
        scope_idle_cycles: dto.scope_idle_cycles.unwrap_or(0),
        scope_last_delta_age_ms: dto.scope_last_delta_age_ms.unwrap_or(0.0) as u64,
        scope_last_active_age_ms: dto.scope_last_active_age_ms.unwrap_or(0.0) as u64,
        assessments_critical_unaddressed_count: dto
            .assessments_critical_unaddressed_count
            .unwrap_or(0),
        contradiction_mass: dto.contradiction_mass.unwrap_or(0.0),
        evidence_coverage: dto.evidence_coverage.unwrap_or(1.0),
        elimination_complete: dto.elimination_complete.unwrap_or(true),
    }
}

fn gate_config_from_dto(dto: &GateConfigDto) -> GateConfig {
    GateConfig {
        gate_b_enforced: dto.gate_b_enforced,
        trajectory_quality_threshold: dto.trajectory_quality_threshold,
        quiescence_max_unresolved: dto.quiescence_max_unresolved,
        quiescence_max_risks: dto.quiescence_max_risks,
        gate_f_enforced: dto.gate_f_enforced.unwrap_or(false),
        elimination_refutation_threshold: dto.elimination_refutation_threshold.unwrap_or(0.7),
    }
}

fn gate_state_to_dto(state: &GateState) -> GateStateDto {
    GateStateDto {
        a_monotonic: state.a_monotonic,
        b_evidence: state.b_evidence,
        c_trajectory: state.c_trajectory,
        d_quiescent: state.d_quiescent,
        e_has_content: state.e_has_content,
        f_elimination_complete: state.f_elimination_complete,
        all_passed: state.all_passed(),
    }
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
        stalled_dimensions: result
            .stalled_dimensions
            .iter()
            .map(dim_to_v1_name)
            .collect(),
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
        per_dimension_monotonic: result.per_dimension_monotonic.to_vec(),
        per_dimension_trajectory_quality: result.per_dimension_trajectory_quality.to_vec(),
    }
}

// ---------------------------------------------------------------------------
// Phase 1: Finality bridge functions
// ---------------------------------------------------------------------------

/// Compute weighted goal score (0-1) from a snapshot.
#[napi]
pub fn compute_goal_score_bridge(
    snapshot: FinalitySnapshotDto,
    weights: Option<WeightsDto>,
) -> f64 {
    let s = snapshot_from_dto(&snapshot);
    let w = weights_from_dto(&weights);
    finality::compute_goal_score(&s, &w)
}

/// Evaluate all five finality gates. Returns gate state.
#[napi]
pub fn evaluate_gates_bridge(
    snapshot: FinalitySnapshotFullDto,
    is_monotonic: bool,
    trajectory_quality: f64,
    config: GateConfigDto,
) -> GateStateDto {
    let snap = full_snapshot_from_dto(&snapshot);
    let cfg = gate_config_from_dto(&config);
    let state = finality::evaluate_gates(&snap, is_monotonic, trajectory_quality, &cfg);
    gate_state_to_dto(&state)
}

/// Evaluate a batch of finality conditions against a snapshot.
#[napi]
pub fn evaluate_conditions_bridge(
    conditions: Vec<String>,
    mode: String,
    snapshot: FinalitySnapshotFullDto,
) -> bool {
    let snap = full_snapshot_from_dto(&snapshot);
    let m = ConditionMode::from_str(&mode);
    finality::evaluate_conditions(&conditions, m, &snap)
}

/// Evaluate a single finality condition. Returns detailed result.
#[napi]
pub fn evaluate_single_condition(
    condition_str: String,
    snapshot: FinalitySnapshotFullDto,
) -> ConditionResultDto {
    let snap = full_snapshot_from_dto(&snapshot);
    let parsed = finality::parse_condition(&condition_str);
    let result = finality::evaluate_condition(&parsed, &snap);

    // Resolve actual value for the result
    let actual = match result {
        Some(_) => {
            // Re-resolve to get the actual value
            resolve_key_for_dto(&parsed.key, &snap)
        }
        None => None,
    };

    ConditionResultDto {
        key: parsed.key,
        op: parsed.op.as_str().to_string(),
        target: parsed.value,
        actual,
        met: result.unwrap_or(false),
    }
}

/// Helper to resolve a condition key to a snapshot value (for ConditionResultDto).
fn resolve_key_for_dto(key: &str, snapshot: &FinalitySnapshotFull) -> Option<f64> {
    match key {
        "claims.active.avg_confidence" => Some(snapshot.claims_active_avg_confidence),
        "claims.active.min_confidence" => Some(snapshot.claims_active_min_confidence),
        "claims.active.count" => Some(snapshot.claims_active_count as f64),
        "contradictions.unresolved_count" => Some(snapshot.contradictions_unresolved_count as f64),
        "contradictions.total_count" | "contradictions.total.count" => {
            Some(snapshot.contradictions_total_count as f64)
        }
        "risks.critical.active_count" => Some(snapshot.risks_critical_active_count as f64),
        "goals.completion_ratio" | "goals.completion" => Some(snapshot.goals_completion_ratio),
        "scope.risk_score" => Some(snapshot.scope_risk_score),
        "scope.idle_cycles" => Some(snapshot.scope_idle_cycles as f64),
        "scope.last_delta_age_ms" => Some(snapshot.scope_last_delta_age_ms as f64),
        "scope.last_active_age_ms" => Some(snapshot.scope_last_active_age_ms as f64),
        "assessments.critical_unaddressed_count" | "assessments.critical_unaddressed.count" => {
            Some(snapshot.assessments_critical_unaddressed_count as f64)
        }
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Phase 2: Governance DTOs
// ---------------------------------------------------------------------------

/// A policy rule DTO.
#[napi(object)]
pub struct PolicyRuleDto {
    pub when_drift_levels: Vec<String>,
    pub when_drift_type: String,
    pub action: String,
}

/// A transition rule DTO.
#[napi(object)]
pub struct TransitionRuleDto {
    pub from: String,
    pub to: String,
    pub block_when_drift_levels: Vec<String>,
    pub reason: String,
}

/// Governance rules configuration DTO (rules + transition_rules).
#[napi(object)]
pub struct GovernanceRulesConfigDto {
    pub rules: Vec<PolicyRuleDto>,
    pub transition_rules: Vec<TransitionRuleDto>,
}

/// A lattice point DTO for kernel input.
#[napi(object)]
pub struct LatticePointDto {
    pub governance_level: String,
    pub dimensions: Vec<f64>,
    pub epoch: u32,
}

/// Kernel input DTO.
#[napi(object)]
pub struct KernelInputDto {
    pub from_state: String,
    pub to_state: String,
    pub drift_level: String,
    pub drift_types: Vec<String>,
    pub mode: String,
    pub current_lattice: Option<LatticePointDto>,
    pub proposed_lattice: Option<LatticePointDto>,
}

/// Kernel output DTO.
#[napi(object)]
pub struct KernelOutputDto {
    pub verdict: String,
    pub reason: String,
    pub suggested_actions: Vec<String>,
    pub admissibility: Option<String>,
    pub regressed_dimensions: Option<Vec<String>>,
}

/// Transition decision DTO.
#[napi(object)]
pub struct TransitionDecisionDto {
    pub allowed: bool,
    pub reason: String,
}

// ---------------------------------------------------------------------------
// Phase 2: Conversion helpers
// ---------------------------------------------------------------------------

fn policy_rules_from_dto(dtos: &[PolicyRuleDto]) -> Vec<governance::PolicyRule> {
    dtos.iter()
        .map(|r| governance::PolicyRule {
            when_drift_levels: r
                .when_drift_levels
                .iter()
                .map(|l| governance::DriftLevel::from_str(l))
                .collect(),
            when_drift_type: r.when_drift_type.clone(),
            action: r.action.clone(),
        })
        .collect()
}

fn transition_rules_from_dto(dtos: &[TransitionRuleDto]) -> Vec<governance::TransitionRule> {
    dtos.iter()
        .map(|r| governance::TransitionRule {
            from: r.from.clone(),
            to: r.to.clone(),
            block_when_drift: r
                .block_when_drift_levels
                .iter()
                .map(|l| governance::DriftLevel::from_str(l))
                .collect(),
            reason: r.reason.clone(),
        })
        .collect()
}

fn lattice_point_from_dto(dto: &LatticePointDto) -> LatticePoint {
    let dims = if dto.dimensions.len() >= 4 {
        [
            dto.dimensions[0],
            dto.dimensions[1],
            dto.dimensions[2],
            dto.dimensions[3],
        ]
    } else {
        [0.0; 4]
    };
    LatticePoint {
        governance: GovernanceLevel::from_str(&dto.governance_level),
        rank: ConvergenceRank {
            dimensions: dims,
            epoch: dto.epoch as u64,
        },
    }
}

// ---------------------------------------------------------------------------
// Issue #18: Vector finality DTOs
// ---------------------------------------------------------------------------

/// Per-dimension finality configuration DTO.
#[napi(object)]
pub struct VectorFinalityConfigDto {
    /// Per-dimension thresholds: [claim, contra, goal, risk].
    pub thresholds: Vec<f64>,
    /// Per-dimension epsilon tolerances.
    pub epsilon: Vec<f64>,
    /// Which dimensions are required.
    pub required: Vec<bool>,
    /// Which dimensions are veto dimensions.
    pub veto: Vec<bool>,
    /// Trajectory quality threshold for per-dimension GC_d (default 0.7).
    pub trajectory_quality_threshold: Option<f64>,
}

/// Per-dimension finality result DTO.
#[napi(object)]
pub struct DimensionFinalityResultDto {
    pub dimension: String,
    pub score: f64,
    pub threshold: f64,
    pub gap: f64,
    pub epsilon: f64,
    pub passed: bool,
    pub is_veto: bool,
    pub is_required: bool,
    pub gate_a_monotonic: bool,
    pub gate_c_trajectory_ok: bool,
}

/// Vector finality result DTO.
#[napi(object)]
pub struct VectorFinalityResultDto {
    pub dimension_results: Vec<DimensionFinalityResultDto>,
    pub all_required_passed: bool,
    pub veto_triggered: bool,
    pub veto_causes: Vec<String>,
    pub global_gates_passed: bool,
    pub finality_reached: bool,
    pub compensation_detected: bool,
}

fn admissibility_to_string(result: &AdmissibilityResult) -> String {
    match result {
        AdmissibilityResult::Admissible => "admissible".to_string(),
        AdmissibilityResult::GovernanceViolation => "governance_violation".to_string(),
        AdmissibilityResult::ConvergenceViolation { .. } => "convergence_violation".to_string(),
        AdmissibilityResult::Incomparable { .. } => "incomparable".to_string(),
        AdmissibilityResult::BothViolated => "both_violated".to_string(),
    }
}

// ---------------------------------------------------------------------------
// Phase 2: Governance bridge functions
// ---------------------------------------------------------------------------

/// Evaluate governance policy rules against drift.
#[napi]
pub fn evaluate_governance_rules(
    drift_level: String,
    drift_types: Vec<String>,
    config: GovernanceRulesConfigDto,
) -> Vec<String> {
    let dl = governance::DriftLevel::from_str(&drift_level);
    let rules = policy_rules_from_dto(&config.rules);
    governance::evaluate_rules(&dl, &drift_types, &rules)
}

/// Check whether a state transition is allowed.
#[napi]
pub fn can_governance_transition(
    from: String,
    to: String,
    drift_level: String,
    config: GovernanceRulesConfigDto,
) -> TransitionDecisionDto {
    let dl = governance::DriftLevel::from_str(&drift_level);
    let transition_rules = transition_rules_from_dto(&config.transition_rules);
    let result = governance::can_transition(&from, &to, &dl, &transition_rules);
    TransitionDecisionDto {
        allowed: result.allowed,
        reason: result.reason,
    }
}

/// Evaluate a governance proposal through the reduction kernel.
#[napi]
pub fn evaluate_kernel(input: KernelInputDto, config: GovernanceRulesConfigDto) -> KernelOutputDto {
    let rules = policy_rules_from_dto(&config.rules);
    let transition_rules = transition_rules_from_dto(&config.transition_rules);

    let kernel_input = governance::KernelInput {
        from_state: input.from_state,
        to_state: input.to_state,
        drift_level: governance::DriftLevel::from_str(&input.drift_level),
        drift_types: input.drift_types,
        mode: GovernanceLevel::from_str(&input.mode),
        current_lattice: input.current_lattice.as_ref().map(lattice_point_from_dto),
        proposed_lattice: input.proposed_lattice.as_ref().map(lattice_point_from_dto),
    };

    let output = governance::evaluate_kernel(&kernel_input, &rules, &transition_rules);

    KernelOutputDto {
        verdict: output.verdict.as_str().to_string(),
        reason: output.reason,
        suggested_actions: output.suggested_actions,
        admissibility: output.admissibility.as_ref().map(admissibility_to_string),
        regressed_dimensions: if output.regressed_dimensions.is_empty() {
            None
        } else {
            Some(
                output
                    .regressed_dimensions
                    .iter()
                    .map(|d| d.v1_name().to_string())
                    .collect(),
            )
        },
    }
}

// ---------------------------------------------------------------------------
// Issue #18: Vector finality bridge
// ---------------------------------------------------------------------------

/// Evaluate vector (per-dimension) finality predicate.
///
/// F*(t) = AND_d[e_d <= eps_d AND GA_d AND GC_d] AND GB AND GD AND GE
#[napi]
pub fn evaluate_vector_finality_bridge(
    scores: Vec<f64>,
    config: VectorFinalityConfigDto,
    per_dim_monotonic: Vec<bool>,
    per_dim_trajectory: Vec<f64>,
    global_gates: GateStateDto,
    scalar_score: f64,
    scalar_threshold: f64,
) -> VectorFinalityResultDto {
    let scores_arr = if scores.len() >= 4 {
        [scores[0], scores[1], scores[2], scores[3]]
    } else {
        [0.0; 4]
    };
    let thresholds = if config.thresholds.len() >= 4 {
        [
            config.thresholds[0],
            config.thresholds[1],
            config.thresholds[2],
            config.thresholds[3],
        ]
    } else {
        [0.85, 0.95, 0.90, 0.80]
    };
    let eps = if config.epsilon.len() >= 4 {
        [
            config.epsilon[0],
            config.epsilon[1],
            config.epsilon[2],
            config.epsilon[3],
        ]
    } else {
        [0.02, 0.01, 0.02, 0.03]
    };
    let required = if config.required.len() >= 4 {
        [
            config.required[0],
            config.required[1],
            config.required[2],
            config.required[3],
        ]
    } else {
        [true; 4]
    };
    let veto = if config.veto.len() >= 4 {
        [
            config.veto[0],
            config.veto[1],
            config.veto[2],
            config.veto[3],
        ]
    } else {
        [false, true, false, false]
    };
    let monotonic = if per_dim_monotonic.len() >= 4 {
        [
            per_dim_monotonic[0],
            per_dim_monotonic[1],
            per_dim_monotonic[2],
            per_dim_monotonic[3],
        ]
    } else {
        [false; 4]
    };
    let trajectory = if per_dim_trajectory.len() >= 4 {
        [
            per_dim_trajectory[0],
            per_dim_trajectory[1],
            per_dim_trajectory[2],
            per_dim_trajectory[3],
        ]
    } else {
        [1.0; 4]
    };

    let vec_config = finality::VectorFinalityConfig {
        thresholds,
        epsilon: eps,
        required,
        veto,
        trajectory_quality_threshold: config.trajectory_quality_threshold.unwrap_or(0.7),
    };

    let gate_state = GateState {
        a_monotonic: global_gates.a_monotonic,
        b_evidence: global_gates.b_evidence,
        c_trajectory: global_gates.c_trajectory,
        d_quiescent: global_gates.d_quiescent,
        e_has_content: global_gates.e_has_content,
        f_elimination_complete: global_gates.f_elimination_complete,
    };

    let result = finality::evaluate_vector_finality(
        &scores_arr,
        &vec_config,
        &monotonic,
        &trajectory,
        &gate_state,
        scalar_score,
        scalar_threshold,
    );

    VectorFinalityResultDto {
        dimension_results: result
            .dimension_results
            .iter()
            .map(|dr| DimensionFinalityResultDto {
                dimension: dr.dimension.v1_name().to_string(),
                score: dr.score,
                threshold: dr.threshold,
                gap: dr.gap,
                epsilon: dr.epsilon,
                passed: dr.passed,
                is_veto: dr.is_veto,
                is_required: dr.is_required,
                gate_a_monotonic: dr.gate_a_monotonic,
                gate_c_trajectory_ok: dr.gate_c_trajectory_ok,
            })
            .collect(),
        all_required_passed: result.all_required_passed,
        veto_triggered: result.veto_triggered,
        veto_causes: result
            .veto_causes
            .iter()
            .map(|d| d.v1_name().to_string())
            .collect(),
        global_gates_passed: result.global_gates_passed,
        finality_reached: result.finality_reached,
        compensation_detected: result.compensation_detected,
    }
}

// ---------------------------------------------------------------------------
// Causal contribution layer — DTOs and bridge functions
// ---------------------------------------------------------------------------

#[napi(object)]
pub struct ContentHashResultDto {
    /// Hex-encoded SHA-256 hash.
    pub hash: String,
    /// Whether the computation succeeded.
    pub valid: bool,
    /// Error message if computation failed.
    pub error: Option<String>,
}

#[napi(object)]
pub struct CausalValidationResultDto {
    /// Overall validity.
    pub valid: bool,
    /// Whether the rid matches the computed content hash.
    pub rid_matches: bool,
    /// Hex-encoded parent IDs that are not in the known set.
    pub missing_parents: Vec<String>,
    /// Error message if validation failed.
    pub error: Option<String>,
}

/// Compute the content-addressed hash for a contribution.
///
/// Input: hex-encoded parent IDs, JSON payload string, kind string.
/// Output: hex-encoded SHA-256 hash.
#[napi]
pub fn compute_content_hash_bridge(
    parents: Vec<String>,
    payload: String,
    kind: String,
) -> ContentHashResultDto {
    let parent_ids: Result<Vec<causal::ContributionId>, _> = parents
        .iter()
        .map(|p| causal::ContributionId::from_hex(p))
        .collect();

    let parent_ids = match parent_ids {
        Ok(ids) => ids,
        Err(e) => {
            return ContentHashResultDto {
                hash: String::new(),
                valid: false,
                error: Some(format!("invalid parent hex: {}", e)),
            };
        }
    };

    let content: serde_json::Value = match serde_json::from_str(&payload) {
        Ok(v) => v,
        Err(e) => {
            return ContentHashResultDto {
                hash: String::new(),
                valid: false,
                error: Some(format!("invalid JSON payload: {}", e)),
            };
        }
    };

    let contribution_kind = match causal::ContributionKind::from_str(&kind) {
        Ok(k) => k,
        Err(e) => {
            return ContentHashResultDto {
                hash: String::new(),
                valid: false,
                error: Some(format!("{}", e)),
            };
        }
    };

    let contribution_payload = causal::ContributionPayload { content };

    match causal::compute_content_hash(&parent_ids, &contribution_payload, &contribution_kind) {
        Ok(id) => ContentHashResultDto {
            hash: id.to_hex(),
            valid: true,
            error: None,
        },
        Err(e) => ContentHashResultDto {
            hash: String::new(),
            valid: false,
            error: Some(format!("{}", e)),
        },
    }
}

/// Validate a contribution against a set of known contribution IDs.
///
/// Checks:
/// 1. rid matches the content hash of (parents, payload, kind)
/// 2. All parents are in the known_rids set
#[napi]
pub fn validate_contribution_bridge(
    rid: String,
    parents: Vec<String>,
    payload: String,
    kind: String,
    known_rids: Vec<String>,
) -> CausalValidationResultDto {
    // Parse rid
    let contribution_rid = match causal::ContributionId::from_hex(&rid) {
        Ok(id) => id,
        Err(e) => {
            return CausalValidationResultDto {
                valid: false,
                rid_matches: false,
                missing_parents: vec![],
                error: Some(format!("invalid rid hex: {}", e)),
            };
        }
    };

    // Parse parents
    let parent_ids: Result<Vec<causal::ContributionId>, _> = parents
        .iter()
        .map(|p| causal::ContributionId::from_hex(p))
        .collect();
    let parent_ids = match parent_ids {
        Ok(ids) => ids,
        Err(e) => {
            return CausalValidationResultDto {
                valid: false,
                rid_matches: false,
                missing_parents: vec![],
                error: Some(format!("invalid parent hex: {}", e)),
            };
        }
    };

    // Parse payload
    let content: serde_json::Value = match serde_json::from_str(&payload) {
        Ok(v) => v,
        Err(e) => {
            return CausalValidationResultDto {
                valid: false,
                rid_matches: false,
                missing_parents: vec![],
                error: Some(format!("invalid JSON payload: {}", e)),
            };
        }
    };

    // Parse kind
    let contribution_kind = match causal::ContributionKind::from_str(&kind) {
        Ok(k) => k,
        Err(e) => {
            return CausalValidationResultDto {
                valid: false,
                rid_matches: false,
                missing_parents: vec![],
                error: Some(format!("{}", e)),
            };
        }
    };

    // Check content hash
    let contribution_payload = causal::ContributionPayload { content };
    let computed = match causal::compute_content_hash(
        &parent_ids,
        &contribution_payload,
        &contribution_kind,
    ) {
        Ok(id) => id,
        Err(e) => {
            return CausalValidationResultDto {
                valid: false,
                rid_matches: false,
                missing_parents: vec![],
                error: Some(format!("hash computation failed: {}", e)),
            };
        }
    };

    let rid_matches = computed == contribution_rid;

    // Check parents against known set
    let known_set: std::collections::HashSet<&str> =
        known_rids.iter().map(|s| s.as_str()).collect();
    let missing_parents: Vec<String> = parents
        .iter()
        .filter(|p| !known_set.contains(p.as_str()))
        .cloned()
        .collect();

    let valid = rid_matches && missing_parents.is_empty();

    CausalValidationResultDto {
        valid,
        rid_matches,
        missing_parents,
        error: None,
    }
}

// ─── Propagation Layer Bridge ───────────────────────────────────────────────

/// DTO for spectral analysis results.
#[napi(object)]
pub struct SpectralAnalysisDto {
    pub eigenvalues: Vec<f64>,
    pub spectral_gap: f64,
    pub lambda_max: f64,
    pub optimal_alpha: f64,
    pub contraction_rate: f64,
    pub mixing_time_estimate: f64,
    pub is_connected: bool,
}

/// DTO for ISS analysis results.
#[napi(object)]
pub struct ISSAnalysisDto {
    pub contraction_rate: f64,
    pub contraction_rate_squared: f64,
    pub propagation_gain: f64,
    pub contradiction_rate: f64,
    pub small_gain_satisfied: bool,
    pub small_gain_margin: f64,
    pub steady_state_disagreement: f64,
    pub steady_state_contradictions: f64,
    pub convergence_time_estimate: f64,
}

/// DTO for a single detected contradiction.
#[napi(object)]
pub struct DetectedContradictionDto {
    pub role_i: u32,
    pub role_j: u32,
    pub dimension: u32,
    pub channel: String,
    pub magnitude: f64,
}

/// DTO for propagation step results.
#[napi(object)]
pub struct PropagationStepResultDto {
    pub disagreement_before: f64,
    pub disagreement_after: f64,
    pub contraction_ratio: f64,
    pub perturbation_norm: f64,
    pub contraction_achieved: bool,
    /// Flattened new state (same layout as input) for chaining steps from TS.
    pub flat_new_state: Vec<f64>,
}

/// Compute disagreement Ω(x) = Σᵢ ‖xᵢ − x̄‖² for an evidence state.
///
/// flat_state: flattened evidence vectors (length = num_roles * 2 * num_dims)
/// num_roles: number of roles
/// num_dims: evidence dimensions per role (support + refutation → 2·num_dims values per role)
#[napi]
pub fn compute_disagreement_bridge(flat_state: Vec<f64>, num_roles: u32, num_dims: u32) -> f64 {
    let state =
        propagation::EvidenceState::from_flat(&flat_state, num_roles as usize, num_dims as usize);
    propagation::compute_disagreement(&state)
}

/// Per-dimension disagreement: returns a Vec of length num_dims where each entry
/// is Σᵢ [(s_{i,d} - s̄_d)² + (r_{i,d} - r̄_d)²].
#[napi]
pub fn per_dimension_disagreement_bridge(
    flat_state: Vec<f64>,
    num_roles: u32,
    num_dims: u32,
) -> Vec<f64> {
    let state =
        propagation::EvidenceState::from_flat(&flat_state, num_roles as usize, num_dims as usize);
    propagation::per_dimension_disagreement(&state)
}

/// Analyze the spectrum of a sheaf Laplacian built from identity restriction maps
/// on a complete graph with the given number of roles and stalk dimension.
///
/// Returns spectral gap, optimal α, contraction rate, etc.
#[napi]
pub fn analyze_spectrum_bridge(num_roles: u32, stalk_dim: u32) -> SpectralAnalysisDto {
    use nalgebra::DMatrix;
    use propagation::{CellularSheaf, RestrictionMap};

    let n = num_roles as usize;
    let d = stalk_dim as usize;
    let stalk_dims = vec![d; n];
    let identity = DMatrix::identity(d, d);

    // Build complete graph with identity restriction maps
    let mut maps = Vec::new();
    for i in 0..n {
        for j in (i + 1)..n {
            maps.push(RestrictionMap {
                source_role: i,
                target_role: j,
                edge_dim: d,
                source_map: identity.clone(),
                target_map: identity.clone(),
            });
        }
    }

    let sheaf = CellularSheaf {
        num_roles: n,
        stalk_dims,
        restriction_maps: maps,
    };

    let analysis = propagation::spectral_analysis(&sheaf);

    SpectralAnalysisDto {
        eigenvalues: analysis.eigenvalues,
        spectral_gap: analysis.spectral_gap,
        lambda_max: analysis.lambda_max,
        optimal_alpha: analysis.optimal_alpha,
        contraction_rate: analysis.contraction_rate,
        mixing_time_estimate: analysis.mixing_time_estimate,
        is_connected: analysis.is_connected,
    }
}

/// ISS cascade analysis: check the small-gain condition κ/(1 − ρ²) < 1.
#[napi]
pub fn analyze_iss_bridge(
    spectral_gap: f64,
    alpha: f64,
    noise_bound: f64,
    contradiction_rate: f64,
    initial_disagreement: f64,
) -> ISSAnalysisDto {
    let analysis = propagation::analyze_iss(
        spectral_gap,
        alpha,
        noise_bound,
        contradiction_rate,
        initial_disagreement,
    );

    ISSAnalysisDto {
        contraction_rate: analysis.contraction_rate,
        contraction_rate_squared: analysis.contraction_rate_squared,
        propagation_gain: analysis.propagation_gain,
        contradiction_rate: analysis.contradiction_rate,
        small_gain_satisfied: analysis.small_gain_satisfied,
        small_gain_margin: analysis.small_gain_margin,
        steady_state_disagreement: analysis.steady_state_disagreement,
        steady_state_contradictions: analysis.steady_state_contradictions,
        convergence_time_estimate: analysis.convergence_time_estimate,
    }
}

/// Run one propagation step on a complete-graph sheaf with identity restriction maps.
///
/// flat_state / flat_perturbation: flattened evidence vectors
/// num_roles, num_dims: dimensions
/// alpha: diffusion rate
/// support_min/max, refutation_min/max: admissible projection bounds
#[napi]
pub fn propagation_step_bridge(
    flat_state: Vec<f64>,
    flat_perturbation: Vec<f64>,
    num_roles: u32,
    num_dims: u32,
    alpha: f64,
    support_min: f64,
    support_max: f64,
    refutation_min: f64,
    refutation_max: f64,
) -> PropagationStepResultDto {
    use nalgebra::DMatrix;
    use propagation::{AdmissibleProjection, CellularSheaf, RestrictionMap};

    let n = num_roles as usize;
    let d = num_dims as usize;
    let stalk_dim = 2 * d; // support + refutation

    let state = propagation::EvidenceState::from_flat(&flat_state, n, d);
    let perturbation = propagation::EvidenceState::from_flat(&flat_perturbation, n, d);

    // Build complete-graph sheaf with identity maps
    let stalk_dims = vec![stalk_dim; n];
    let identity = DMatrix::identity(stalk_dim, stalk_dim);
    let mut maps = Vec::new();
    for i in 0..n {
        for j in (i + 1)..n {
            maps.push(RestrictionMap {
                source_role: i,
                target_role: j,
                edge_dim: stalk_dim,
                source_map: identity.clone(),
                target_map: identity.clone(),
            });
        }
    }

    let sheaf = CellularSheaf {
        num_roles: n,
        stalk_dims,
        restriction_maps: maps,
    };

    let projection = AdmissibleProjection::new(
        vec![(support_min, support_max); d],
        vec![(refutation_min, refutation_max); d],
    );

    let result = propagation::propagation_step(&sheaf, &state, &perturbation, &projection, alpha);

    PropagationStepResultDto {
        disagreement_before: result.disagreement_before,
        disagreement_after: result.disagreement_after,
        contraction_ratio: result.contraction_ratio,
        perturbation_norm: result.perturbation_norm,
        contraction_achieved: result.contraction_achieved,
        flat_new_state: result.new_state.to_flat(),
    }
}

/// Extract contradictions from an evidence state.
///
/// Returns all role-dimension pairs where disagreement exceeds threshold.
#[napi]
pub fn extract_contradictions_bridge(
    flat_state: Vec<f64>,
    num_roles: u32,
    num_dims: u32,
    threshold: f64,
) -> Vec<DetectedContradictionDto> {
    let state =
        propagation::EvidenceState::from_flat(&flat_state, num_roles as usize, num_dims as usize);

    let contradictions = propagation::extract_contradictions(&state, threshold);

    contradictions
        .into_iter()
        .map(|c| DetectedContradictionDto {
            role_i: c.role_i as u32,
            role_j: c.role_j as u32,
            dimension: c.dimension as u32,
            channel: format!("{:?}", c.channel),
            magnitude: c.magnitude,
        })
        .collect()
}

// ─── Topology-Aware Propagation Bridge ─────────────────────────────────────

/// Topology preset names: `"complete"` | `"star"` | `"ring"` | `"chain"` | `"random_regular"`.
/// For `"random_regular"`, supply `degree` and `seed`. Spectral analysis on an arbitrary topology.
///
/// - topology: preset name above
/// - num_roles: number of vertices
/// - stalk_dim: dimension of each vertex stalk (2D for bilattice encoding)
/// - degree: required for `"random_regular"`, ignored otherwise
/// - seed: RNG seed for `"random_regular"`, ignored otherwise
#[napi]
pub fn analyze_spectrum_topology_bridge(
    topology: String,
    num_roles: u32,
    stalk_dim: u32,
    degree: Option<u32>,
    seed: Option<u32>,
) -> SpectralAnalysisDto {
    let n = num_roles as usize;
    let d = stalk_dim as usize;

    let edges = build_topology(
        &topology,
        n,
        degree.map(|x| x as usize),
        seed.map(|x| x as u64),
    );
    let sheaf = propagation::CellularSheaf::constant(n, d, &edges);
    let analysis = propagation::spectral_analysis(&sheaf);

    SpectralAnalysisDto {
        eigenvalues: analysis.eigenvalues,
        spectral_gap: analysis.spectral_gap,
        lambda_max: analysis.lambda_max,
        optimal_alpha: analysis.optimal_alpha,
        contraction_rate: analysis.contraction_rate,
        mixing_time_estimate: analysis.mixing_time_estimate,
        is_connected: analysis.is_connected,
    }
}

/// Run one propagation step on a sheaf with configurable topology.
///
/// topology: "complete" | "star" | "ring" | "chain" | "random_regular"
/// edges: optional explicit edge list as flat [u, v, u, v, ...] — overrides topology preset
/// support_bounds / refutation_bounds: per-dimension bounds as flat [min, max, min, max, ...]
///   If empty, defaults to uniform [0, 1] on all dimensions.
#[napi]
pub fn propagation_step_topology_bridge(
    flat_state: Vec<f64>,
    flat_perturbation: Vec<f64>,
    num_roles: u32,
    num_dims: u32,
    alpha: f64,
    topology: String,
    degree: Option<u32>,
    seed: Option<u32>,
    edges: Option<Vec<u32>>,
    support_bounds: Option<Vec<f64>>,
    refutation_bounds: Option<Vec<f64>>,
) -> PropagationStepResultDto {
    let n = num_roles as usize;
    let d = num_dims as usize;
    let stalk_dim = 2 * d;

    let state = propagation::EvidenceState::from_flat(&flat_state, n, d);
    let perturbation = propagation::EvidenceState::from_flat(&flat_perturbation, n, d);

    // Build sheaf from explicit edges or topology preset
    let edge_list = if let Some(ref flat_edges) = edges {
        flat_edges
            .chunks_exact(2)
            .map(|pair| (pair[0] as usize, pair[1] as usize))
            .collect()
    } else {
        build_topology(
            &topology,
            n,
            degree.map(|x| x as usize),
            seed.map(|x| x as u64),
        )
    };

    let sheaf = propagation::CellularSheaf::constant(n, stalk_dim, &edge_list);

    // Build projection with per-dimension bounds or uniform defaults
    let projection = build_projection(d, support_bounds, refutation_bounds);

    let result = propagation::propagation_step(&sheaf, &state, &perturbation, &projection, alpha);

    PropagationStepResultDto {
        disagreement_before: result.disagreement_before,
        disagreement_after: result.disagreement_after,
        contraction_ratio: result.contraction_ratio,
        perturbation_norm: result.perturbation_norm,
        contraction_achieved: result.contraction_achieved,
        flat_new_state: result.new_state.to_flat(),
    }
}

/// DTO for topology metadata (edge count, type, etc.).
#[napi(object)]
pub struct TopologyInfoDto {
    pub topology: String,
    pub num_roles: u32,
    pub num_edges: u32,
    pub edge_list: Vec<u32>,
}

/// Get edge list and metadata for a topology preset.
/// Useful for experiments that need to inspect the graph structure.
#[napi]
pub fn get_topology_info_bridge(
    topology: String,
    num_roles: u32,
    degree: Option<u32>,
    seed: Option<u32>,
) -> TopologyInfoDto {
    let n = num_roles as usize;
    let edges = build_topology(
        &topology,
        n,
        degree.map(|x| x as usize),
        seed.map(|x| x as u64),
    );
    let flat: Vec<u32> = edges
        .iter()
        .flat_map(|(u, v)| [*u as u32, *v as u32])
        .collect();

    TopologyInfoDto {
        topology,
        num_roles,
        num_edges: edges.len() as u32,
        edge_list: flat,
    }
}

// ─── Projection Sheaf Bridge (sheaf grounding) ─────────────────────────────

/// Spectral analysis on a sheaf with projection restriction maps.
///
/// role_observed_dims: per-role observed dimension indices (e.g. [[0], [1], [0,1,2,3]])
/// edges: flat edge list [u0, v0, u1, v1, ...]
/// num_roles, num_dims: system dimensions
#[napi]
pub fn analyze_spectrum_sheaf_bridge(
    num_roles: u32,
    num_dims: u32,
    role_observed_dims: Vec<Vec<u32>>,
    edges: Vec<u32>,
) -> SpectralAnalysisDto {
    let n = num_roles as usize;
    let d = num_dims as usize;

    let obs: Vec<Vec<usize>> = role_observed_dims
        .iter()
        .map(|dims| dims.iter().map(|&x| x as usize).collect())
        .collect();

    let edge_list: Vec<(usize, usize)> = edges
        .chunks_exact(2)
        .map(|pair| (pair[0] as usize, pair[1] as usize))
        .collect();

    let sheaf = propagation::CellularSheaf::from_role_observations(n, d, &obs, &edge_list);
    let analysis = propagation::spectral_analysis(&sheaf);

    SpectralAnalysisDto {
        eigenvalues: analysis.eigenvalues,
        spectral_gap: analysis.spectral_gap,
        lambda_max: analysis.lambda_max,
        optimal_alpha: analysis.optimal_alpha,
        contraction_rate: analysis.contraction_rate,
        mixing_time_estimate: analysis.mixing_time_estimate,
        is_connected: analysis.is_connected,
    }
}

/// Run one propagation step on a sheaf with projection restriction maps.
///
/// role_observed_dims: per-role observed dimension indices
/// edges: flat edge list [u0, v0, u1, v1, ...]
/// support_bounds / refutation_bounds: per-dimension [min, max, min, max, ...] or empty for [0,1]
#[napi]
pub fn propagation_step_sheaf_bridge(
    flat_state: Vec<f64>,
    flat_perturbation: Vec<f64>,
    num_roles: u32,
    num_dims: u32,
    alpha: f64,
    role_observed_dims: Vec<Vec<u32>>,
    edges: Vec<u32>,
    support_bounds: Option<Vec<f64>>,
    refutation_bounds: Option<Vec<f64>>,
) -> PropagationStepResultDto {
    let n = num_roles as usize;
    let d = num_dims as usize;

    let state = propagation::EvidenceState::from_flat(&flat_state, n, d);
    let perturbation = propagation::EvidenceState::from_flat(&flat_perturbation, n, d);

    let obs: Vec<Vec<usize>> = role_observed_dims
        .iter()
        .map(|dims| dims.iter().map(|&x| x as usize).collect())
        .collect();

    let edge_list: Vec<(usize, usize)> = edges
        .chunks_exact(2)
        .map(|pair| (pair[0] as usize, pair[1] as usize))
        .collect();

    let sheaf = propagation::CellularSheaf::from_role_observations(n, d, &obs, &edge_list);
    let projection = build_projection(d, support_bounds, refutation_bounds);
    let result = propagation::propagation_step(&sheaf, &state, &perturbation, &projection, alpha);

    PropagationStepResultDto {
        disagreement_before: result.disagreement_before,
        disagreement_after: result.disagreement_after,
        contraction_ratio: result.contraction_ratio,
        perturbation_norm: result.perturbation_norm,
        contraction_achieved: result.contraction_achieved,
        flat_new_state: result.new_state.to_flat(),
    }
}

// ─── Internal helpers ──────────────────────────────────────────────────────

fn build_topology(
    topology: &str,
    n: usize,
    degree: Option<usize>,
    seed: Option<u64>,
) -> Vec<(usize, usize)> {
    use propagation::topology;
    match topology {
        "complete" => topology::complete(n),
        "star" => topology::star(n),
        "ring" => topology::ring(n),
        "chain" => topology::chain(n),
        "random_regular" => {
            let d = degree.unwrap_or(3);
            let s = seed.unwrap_or(42);
            topology::random_regular(n, d, s).unwrap_or_else(|| topology::complete(n))
        }
        _ => topology::complete(n), // fallback
    }
}

fn build_projection(
    num_dims: usize,
    support_bounds: Option<Vec<f64>>,
    refutation_bounds: Option<Vec<f64>>,
) -> propagation::AdmissibleProjection {
    let support_range = match support_bounds {
        Some(ref flat) if flat.len() == 2 * num_dims => flat
            .chunks_exact(2)
            .map(|pair| (pair[0], pair[1]))
            .collect(),
        _ => vec![(0.0, 1.0); num_dims],
    };

    let refutation_range = match refutation_bounds {
        Some(ref flat) if flat.len() == 2 * num_dims => flat
            .chunks_exact(2)
            .map(|pair| (pair[0], pair[1]))
            .collect(),
        _ => vec![(0.0, 1.0); num_dims],
    };

    propagation::AdmissibleProjection::new(support_range, refutation_range)
}
