use napi_derive::napi;

use crate::convergence::{self, ConvergenceConfig, ConvergencePointInput, SnapshotInput};
use crate::finality::{self, ConditionMode, FinalitySnapshotFull, GateConfig, GateState};
use crate::governance;
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
}

/// Finality gate configuration.
#[napi(object)]
pub struct GateConfigDto {
    pub gate_b_enforced: bool,
    pub trajectory_quality_threshold: f64,
    pub quiescence_max_unresolved: u32,
    pub quiescence_max_risks: u32,
}

/// State of all five finality gates.
#[napi(object)]
pub struct GateStateDto {
    pub a_monotonic: bool,
    pub b_evidence: bool,
    pub c_trajectory: bool,
    pub d_quiescent: bool,
    pub e_has_content: bool,
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
        claims_active_min_confidence: dto.claims_active_min_confidence.unwrap_or(dto.claims_active_avg_confidence),
        claims_active_count: dto.claims_active_count.unwrap_or(1),
        risks_critical_active_count: dto.risks_critical_active_count.unwrap_or(0),
        scope_idle_cycles: dto.scope_idle_cycles.unwrap_or(0),
        scope_last_delta_age_ms: dto.scope_last_delta_age_ms.unwrap_or(0.0) as u64,
        scope_last_active_age_ms: dto.scope_last_active_age_ms.unwrap_or(0.0) as u64,
        assessments_critical_unaddressed_count: dto.assessments_critical_unaddressed_count.unwrap_or(0),
        contradiction_mass: dto.contradiction_mass.unwrap_or(0.0),
        evidence_coverage: dto.evidence_coverage.unwrap_or(1.0),
    }
}

fn gate_config_from_dto(dto: &GateConfigDto) -> GateConfig {
    GateConfig {
        gate_b_enforced: dto.gate_b_enforced,
        trajectory_quality_threshold: dto.trajectory_quality_threshold,
        quiescence_max_unresolved: dto.quiescence_max_unresolved,
        quiescence_max_risks: dto.quiescence_max_risks,
    }
}

fn gate_state_to_dto(state: &GateState) -> GateStateDto {
    GateStateDto {
        a_monotonic: state.a_monotonic,
        b_evidence: state.b_evidence,
        c_trajectory: state.c_trajectory,
        d_quiescent: state.d_quiescent,
        e_has_content: state.e_has_content,
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
        "contradictions.total_count" | "contradictions.total.count" => Some(snapshot.contradictions_total_count as f64),
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
pub fn evaluate_kernel(
    input: KernelInputDto,
    config: GovernanceRulesConfigDto,
) -> KernelOutputDto {
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
