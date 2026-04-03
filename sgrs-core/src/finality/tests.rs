use super::conditions::*;
use super::gates::*;
use super::goal_score::*;
use crate::convergence::SnapshotInput;
use crate::types::DEFAULT_WEIGHTS;

// ---------------------------------------------------------------------------
// Helper: default full snapshot
// ---------------------------------------------------------------------------

fn make_full_snapshot() -> FinalitySnapshotFull {
    FinalitySnapshotFull {
        claims_active_avg_confidence: 0.90,
        contradictions_unresolved_count: 0,
        contradictions_total_count: 5,
        goals_completion_ratio: 0.95,
        scope_risk_score: 0.10,
        claims_active_min_confidence: 0.88,
        claims_active_count: 10,
        risks_critical_active_count: 0,
        scope_idle_cycles: 0,
        scope_last_delta_age_ms: 0,
        scope_last_active_age_ms: 0,
        assessments_critical_unaddressed_count: 0,
        contradiction_mass: 0.0,
        evidence_coverage: 1.0,
        elimination_complete: true,
    }
}

fn make_snapshot_input() -> SnapshotInput {
    SnapshotInput {
        claims_active_avg_confidence: 1.0,
        contradictions_unresolved_count: 0,
        contradictions_total_count: 0,
        goals_completion_ratio: 1.0,
        scope_risk_score: 0.0,
    }
}

// ===========================================================================
// parse_condition tests
// ===========================================================================

#[test]
fn parse_gte_operator() {
    let c = parse_condition("claims.active.min_confidence: >= 0.85");
    assert_eq!(c.key, "claims.active.min_confidence");
    assert_eq!(c.op, ComparisonOp::Gte);
    assert!((c.value - 0.85).abs() < 1e-10);
}

#[test]
fn parse_lte_operator() {
    let c = parse_condition("scope.risk_score: <= 0.20");
    assert_eq!(c.key, "scope.risk_score");
    assert_eq!(c.op, ComparisonOp::Lte);
    assert!((c.value - 0.20).abs() < 1e-10);
}

#[test]
fn parse_lt_operator_quoted() {
    let c = parse_condition("scope.risk_score: \"< 0.20\"");
    assert_eq!(c.key, "scope.risk_score");
    assert_eq!(c.op, ComparisonOp::Lt);
    assert!((c.value - 0.20).abs() < 1e-10);
}

#[test]
fn parse_gt_operator() {
    let c = parse_condition("goals.completion: > 0.90");
    assert_eq!(c.key, "goals.completion");
    assert_eq!(c.op, ComparisonOp::Gt);
    assert!((c.value - 0.90).abs() < 1e-10);
}

#[test]
fn parse_eq_operator() {
    let c = parse_condition("contradictions.unresolved_count: == 0");
    assert_eq!(c.key, "contradictions.unresolved_count");
    assert_eq!(c.op, ComparisonOp::Eq);
    assert!((c.value).abs() < 1e-10);
}

#[test]
fn parse_default_op_is_gte() {
    let c = parse_condition("claims.active.min_confidence: 0.85");
    assert_eq!(c.key, "claims.active.min_confidence");
    assert_eq!(c.op, ComparisonOp::Gte);
    assert!((c.value - 0.85).abs() < 1e-10);
}

#[test]
fn parse_count_key_defaults_to_eq_when_zero() {
    let c = parse_condition("contradictions.unresolved_count: 0");
    assert_eq!(c.key, "contradictions.unresolved_count");
    assert_eq!(c.op, ComparisonOp::Eq);
    assert!((c.value).abs() < 1e-10);
}

#[test]
fn parse_no_colon_returns_empty() {
    let c = parse_condition("no colon here");
    assert_eq!(c.key, "");
    assert_eq!(c.op, ComparisonOp::Eq);
    assert!((c.value).abs() < 1e-10);
}

// ===========================================================================
// evaluate_condition tests
// ===========================================================================

#[test]
fn eval_claims_min_confidence_gte() {
    let snapshot = make_full_snapshot();
    let c = Condition {
        key: "claims.active.min_confidence".to_string(),
        op: ComparisonOp::Gte,
        value: 0.85,
    };
    assert_eq!(evaluate_condition(&c, &snapshot), Some(true));
}

#[test]
fn eval_claims_min_confidence_gte_fails() {
    let mut snapshot = make_full_snapshot();
    snapshot.claims_active_min_confidence = 0.50;
    let c = Condition {
        key: "claims.active.min_confidence".to_string(),
        op: ComparisonOp::Gte,
        value: 0.85,
    };
    assert_eq!(evaluate_condition(&c, &snapshot), Some(false));
}

#[test]
fn eval_unresolved_count_eq_zero() {
    let snapshot = make_full_snapshot();
    let c = Condition {
        key: "contradictions.unresolved_count".to_string(),
        op: ComparisonOp::Eq,
        value: 0.0,
    };
    assert_eq!(evaluate_condition(&c, &snapshot), Some(true));
}

#[test]
fn eval_unresolved_count_eq_zero_fails() {
    let mut snapshot = make_full_snapshot();
    snapshot.contradictions_unresolved_count = 3;
    let c = Condition {
        key: "contradictions.unresolved_count".to_string(),
        op: ComparisonOp::Eq,
        value: 0.0,
    };
    assert_eq!(evaluate_condition(&c, &snapshot), Some(false));
}

#[test]
fn eval_goals_completion_gte() {
    let snapshot = make_full_snapshot();
    let c = Condition {
        key: "goals.completion_ratio".to_string(),
        op: ComparisonOp::Gte,
        value: 0.90,
    };
    assert_eq!(evaluate_condition(&c, &snapshot), Some(true));
}

#[test]
fn eval_scope_risk_lt() {
    let snapshot = make_full_snapshot();
    let c = Condition {
        key: "scope.risk_score".to_string(),
        op: ComparisonOp::Lt,
        value: 0.20,
    };
    assert_eq!(evaluate_condition(&c, &snapshot), Some(true));
}

#[test]
fn eval_risks_critical_eq_zero() {
    let snapshot = make_full_snapshot();
    let c = Condition {
        key: "risks.critical.active_count".to_string(),
        op: ComparisonOp::Eq,
        value: 0.0,
    };
    assert_eq!(evaluate_condition(&c, &snapshot), Some(true));
}

#[test]
fn eval_idle_cycles() {
    let mut snapshot = make_full_snapshot();
    snapshot.scope_idle_cycles = 5;
    let c = Condition {
        key: "scope.idle_cycles".to_string(),
        op: ComparisonOp::Gte,
        value: 5.0,
    };
    assert_eq!(evaluate_condition(&c, &snapshot), Some(true));
}

#[test]
fn eval_last_active_age() {
    let mut snapshot = make_full_snapshot();
    snapshot.scope_last_active_age_ms = 3_000_000_000;
    let c = Condition {
        key: "scope.last_active_age_ms".to_string(),
        op: ComparisonOp::Gte,
        value: 2_592_000_000.0,
    };
    assert_eq!(evaluate_condition(&c, &snapshot), Some(true));
}

#[test]
fn eval_unknown_key_returns_none() {
    let snapshot = make_full_snapshot();
    let c = Condition {
        key: "nonexistent.key".to_string(),
        op: ComparisonOp::Gte,
        value: 0.0,
    };
    assert_eq!(evaluate_condition(&c, &snapshot), None);
}

// ===========================================================================
// condition_to_string tests
// ===========================================================================

#[test]
fn condition_to_string_formats_correctly() {
    let c = Condition {
        key: "claims.active.min_confidence".to_string(),
        op: ComparisonOp::Gte,
        value: 0.85,
    };
    assert_eq!(condition_to_string(&c), "claims.active.min_confidence >= 0.85");
}

// ===========================================================================
// compute_goal_score tests
// ===========================================================================

#[test]
fn goal_score_perfect_is_one() {
    let snapshot = make_snapshot_input();
    let score = compute_goal_score(&snapshot, &DEFAULT_WEIGHTS);
    assert!((score - 1.0).abs() < 1e-10);
}

#[test]
fn goal_score_partial() {
    let snapshot = SnapshotInput {
        claims_active_avg_confidence: 0.5,
        contradictions_unresolved_count: 2,
        contradictions_total_count: 4,
        goals_completion_ratio: 0.6,
        scope_risk_score: 0.3,
    };
    let score = compute_goal_score(&snapshot, &DEFAULT_WEIGHTS);
    // claim_confidence: min(0.5/0.85, 1.0) = 0.5882 * 0.30 = 0.1765
    // contra_resolution: 1 - 2/4 = 0.5 * 0.30 = 0.15
    // goal_completion: 0.6 * 0.25 = 0.15
    // risk_inverse: 1 - 0.3 = 0.7 * 0.15 = 0.105
    // total = 0.5815
    assert!(score > 0.5 && score < 0.65, "score = {}", score);
}

#[test]
fn goal_score_with_custom_weights() {
    let snapshot = make_snapshot_input();
    let weights = [0.25, 0.25, 0.25, 0.25];
    let score = compute_goal_score(&snapshot, &weights);
    assert!((score - 1.0).abs() < 1e-10);
}

// ===========================================================================
// evaluate_gates tests
// ===========================================================================

#[test]
fn all_gates_pass_when_conditions_met() {
    let snapshot = make_full_snapshot();
    let config = GateConfig::default();
    let state = evaluate_gates(&snapshot, true, 0.8, &config);
    assert!(state.a_monotonic);
    assert!(state.b_evidence);
    assert!(state.c_trajectory);
    assert!(state.d_quiescent);
    assert!(state.e_has_content);
    assert!(state.all_passed());
}

#[test]
fn gate_a_fails_when_not_monotonic() {
    let snapshot = make_full_snapshot();
    let config = GateConfig::default();
    let state = evaluate_gates(&snapshot, false, 0.8, &config);
    assert!(!state.a_monotonic);
    assert!(!state.all_passed());
}

#[test]
fn gate_b_passes_when_not_enforced() {
    let mut snapshot = make_full_snapshot();
    snapshot.contradiction_mass = 5.0; // would fail if enforced
    let config = GateConfig {
        gate_b_enforced: false,
        ..GateConfig::default()
    };
    let state = evaluate_gates(&snapshot, true, 0.8, &config);
    assert!(state.b_evidence); // not enforced
}

#[test]
fn gate_b_fails_when_enforced_and_mass_nonzero() {
    let mut snapshot = make_full_snapshot();
    snapshot.contradiction_mass = 5.0;
    let config = GateConfig {
        gate_b_enforced: true,
        ..GateConfig::default()
    };
    let state = evaluate_gates(&snapshot, true, 0.8, &config);
    assert!(!state.b_evidence);
    assert!(!state.all_passed());
}

#[test]
fn gate_c_fails_below_threshold() {
    let snapshot = make_full_snapshot();
    let config = GateConfig::default();
    let state = evaluate_gates(&snapshot, true, 0.5, &config); // below 0.7
    assert!(!state.c_trajectory);
    assert!(!state.all_passed());
}

#[test]
fn gate_d_disabled_when_both_zero() {
    let snapshot = make_full_snapshot();
    let config = GateConfig {
        quiescence_max_unresolved: 0,
        quiescence_max_risks: 0,
        ..GateConfig::default()
    };
    let state = evaluate_gates(&snapshot, true, 0.8, &config);
    assert!(state.d_quiescent); // disabled = always pass
}

#[test]
fn gate_d_fails_when_enabled_and_exceeds() {
    let mut snapshot = make_full_snapshot();
    snapshot.contradictions_unresolved_count = 3;
    let config = GateConfig {
        quiescence_max_unresolved: 2,
        quiescence_max_risks: 5,
        ..GateConfig::default()
    };
    let state = evaluate_gates(&snapshot, true, 0.8, &config);
    assert!(!state.d_quiescent);
}

#[test]
fn gate_e_fails_no_content() {
    let mut snapshot = make_full_snapshot();
    snapshot.claims_active_count = 0;
    snapshot.goals_completion_ratio = 1.0; // vacuously complete
    let config = GateConfig::default();
    let state = evaluate_gates(&snapshot, true, 0.8, &config);
    assert!(!state.e_has_content);
    assert!(!state.all_passed());
}

#[test]
fn gate_e_passes_with_incomplete_goals() {
    let mut snapshot = make_full_snapshot();
    snapshot.claims_active_count = 0;
    snapshot.goals_completion_ratio = 0.5; // not complete
    let config = GateConfig::default();
    let state = evaluate_gates(&snapshot, true, 0.8, &config);
    assert!(state.e_has_content);
}

// ===========================================================================
// evaluate_conditions tests
// ===========================================================================

#[test]
fn conditions_all_mode_all_met() {
    let snapshot = make_full_snapshot();
    let conditions = vec![
        "claims.active.min_confidence: >= 0.85".to_string(),
        "contradictions.unresolved_count: == 0".to_string(),
        "goals.completion_ratio: >= 0.90".to_string(),
    ];
    assert!(evaluate_conditions(&conditions, ConditionMode::All, &snapshot));
}

#[test]
fn conditions_all_mode_one_fails() {
    let mut snapshot = make_full_snapshot();
    snapshot.goals_completion_ratio = 0.50; // fails >= 0.90
    let conditions = vec![
        "claims.active.min_confidence: >= 0.85".to_string(),
        "goals.completion_ratio: >= 0.90".to_string(),
    ];
    assert!(!evaluate_conditions(&conditions, ConditionMode::All, &snapshot));
}

#[test]
fn conditions_any_mode_one_met() {
    let mut snapshot = make_full_snapshot();
    snapshot.goals_completion_ratio = 0.50; // fails
    let conditions = vec![
        "claims.active.min_confidence: >= 0.85".to_string(), // passes
        "goals.completion_ratio: >= 0.90".to_string(),       // fails
    ];
    assert!(evaluate_conditions(&conditions, ConditionMode::Any, &snapshot));
}

#[test]
fn conditions_any_mode_none_met() {
    let mut snapshot = make_full_snapshot();
    snapshot.claims_active_min_confidence = 0.50;
    snapshot.goals_completion_ratio = 0.50;
    let conditions = vec![
        "claims.active.min_confidence: >= 0.85".to_string(),
        "goals.completion_ratio: >= 0.90".to_string(),
    ];
    assert!(!evaluate_conditions(&conditions, ConditionMode::Any, &snapshot));
}

// ===========================================================================
// Vector finality tests (Issue #18: non-scalar finality)
// ===========================================================================

use super::vector::*;
use crate::types::DimensionId;

/// Helper: all global gates passing.
fn make_passing_global_gates() -> GateState {
    GateState {
        a_monotonic: true,
        b_evidence: true,
        c_trajectory: true,
        d_quiescent: true,
        e_has_content: true,
        f_elimination_complete: true,
    }
}

// ---------------------------------------------------------------------------
// dimension_gap / dimension_final unit tests
// ---------------------------------------------------------------------------

#[test]
fn dimension_gap_zero_when_score_above_threshold() {
    assert!((dimension_gap(0.90, 0.85) - 0.0).abs() < 1e-10);
}

#[test]
fn dimension_gap_positive_when_score_below_threshold() {
    assert!((dimension_gap(0.80, 0.95) - 0.15).abs() < 1e-10);
}

#[test]
fn dimension_gap_zero_when_score_equals_threshold() {
    assert!((dimension_gap(0.85, 0.85) - 0.0).abs() < 1e-10);
}

#[test]
fn dimension_final_passes_within_epsilon() {
    // score=0.84, threshold=0.85, gap=0.01, epsilon=0.02 → passes
    assert!(dimension_final(0.84, 0.85, 0.02));
}

#[test]
fn dimension_final_fails_outside_epsilon() {
    // score=0.80, threshold=0.85, gap=0.05, epsilon=0.02 → fails
    assert!(!dimension_final(0.80, 0.85, 0.02));
}

#[test]
fn dimension_final_passes_exactly_at_epsilon() {
    // score=0.83, threshold=0.85, gap≈0.02 → use slightly larger epsilon for FP safety
    assert!(dimension_final(0.83, 0.85, 0.021));
    // And verify gap is very close to 0.02
    let gap = dimension_gap(0.83, 0.85);
    assert!((gap - 0.02).abs() < 1e-10);
}

#[test]
fn dimension_final_passes_above_threshold() {
    // score=0.95, threshold=0.85 → gap=0, any epsilon passes
    assert!(dimension_final(0.95, 0.85, 0.0));
}

// ---------------------------------------------------------------------------
// Vector finality: all dimensions pass
// ---------------------------------------------------------------------------

#[test]
fn vector_finality_all_pass() {
    let scores = [0.90, 0.98, 0.95, 0.85]; // all above thresholds
    let config = VectorFinalityConfig::default();
    let monotonic = [true, true, true, true];
    let trajectory = [0.9, 0.85, 0.8, 0.75];
    let gates = make_passing_global_gates();

    let result = evaluate_vector_finality(
        &scores, &config, &monotonic, &trajectory, &gates, 0.95, 0.92,
    );

    assert!(result.all_required_passed);
    assert!(!result.veto_triggered);
    assert!(result.global_gates_passed);
    assert!(result.finality_reached);
    assert!(!result.compensation_detected);
    assert_eq!(result.dimension_results.len(), 4);
    for dr in &result.dimension_results {
        assert!(dr.passed, "dim {:?} should pass", dr.dimension);
    }
}

// ---------------------------------------------------------------------------
// Compensation attack detection (PO-2): scalar passes, vector blocks
// ---------------------------------------------------------------------------

#[test]
fn vector_finality_blocks_compensation() {
    // Compensation scenario: high claim + goal + risk compensate low contradiction
    // claim_confidence=1.0, contra=0.50, goal=1.0, risk_inv=1.0
    // Scalar: 0.30*1.0 + 0.30*0.50 + 0.25*1.0 + 0.15*1.0 = 0.85 → hmm
    // Actually with normalization: claim_conf = min(1.0/0.85, 1.0) = 1.0
    // contra_resolution = 0.50
    // goal_completion = 1.0
    // risk_inverse = 1.0
    // scalar = 0.30*1.0 + 0.30*0.50 + 0.25*1.0 + 0.15*1.0 = 0.30+0.15+0.25+0.15 = 0.85
    // Need higher scalar to pass 0.92:
    // claim=1.0, contra=0.80, goal=1.0, risk=1.0
    // scalar = 0.30 + 0.24 + 0.25 + 0.15 = 0.94 → passes 0.92
    // But contra=0.80 < threshold=0.95 → vector blocks
    let scores = [1.0, 0.80, 1.0, 1.0];
    let config = VectorFinalityConfig::default();
    let monotonic = [true, true, true, true];
    let trajectory = [0.9, 0.9, 0.9, 0.9];
    let gates = make_passing_global_gates();

    let result = evaluate_vector_finality(
        &scores, &config, &monotonic, &trajectory, &gates,
        0.94, // scalar_score — passes 0.92
        0.92, // scalar_threshold
    );

    // Vector should block: contra=0.80 < threshold=0.95, gap=0.15 > eps=0.01
    assert!(!result.all_required_passed);
    assert!(result.veto_triggered, "contra_resolution is veto");
    assert_eq!(result.veto_causes.len(), 1);
    assert_eq!(result.veto_causes[0], DimensionId::ContradictionResolution);
    assert!(!result.finality_reached);
    assert!(result.compensation_detected, "scalar passes but vector blocks");
}

// ---------------------------------------------------------------------------
// Veto dimension tests
// ---------------------------------------------------------------------------

#[test]
fn vector_finality_veto_blocks_even_if_non_required() {
    // Make contradiction_resolution the only veto but also the only failure
    let scores = [0.90, 0.80, 0.95, 0.85]; // contra fails
    let config = VectorFinalityConfig::default(); // contra is veto
    let monotonic = [true, true, true, true];
    let trajectory = [0.9, 0.9, 0.9, 0.9];
    let gates = make_passing_global_gates();

    let result = evaluate_vector_finality(
        &scores, &config, &monotonic, &trajectory, &gates, 0.50, 0.92,
    );

    assert!(result.veto_triggered);
    assert!(!result.finality_reached);
    assert_eq!(result.veto_causes, vec![DimensionId::ContradictionResolution]);
}

#[test]
fn vector_finality_no_veto_when_veto_dim_passes() {
    let scores = [0.90, 0.98, 0.95, 0.85]; // all pass including veto
    let config = VectorFinalityConfig::default();
    let monotonic = [true, true, true, true];
    let trajectory = [0.9, 0.9, 0.9, 0.9];
    let gates = make_passing_global_gates();

    let result = evaluate_vector_finality(
        &scores, &config, &monotonic, &trajectory, &gates, 0.95, 0.92,
    );

    assert!(!result.veto_triggered);
    assert!(result.veto_causes.is_empty());
    assert!(result.finality_reached);
}

// ---------------------------------------------------------------------------
// Per-dimension monotonicity gate (GA_d) tests
// ---------------------------------------------------------------------------

#[test]
fn vector_finality_fails_when_dim_not_monotonic() {
    let scores = [0.90, 0.98, 0.95, 0.85]; // all above thresholds
    let config = VectorFinalityConfig::default();
    // claim_confidence is NOT monotonic
    let monotonic = [false, true, true, true];
    let trajectory = [0.9, 0.9, 0.9, 0.9];
    let gates = make_passing_global_gates();

    let result = evaluate_vector_finality(
        &scores, &config, &monotonic, &trajectory, &gates, 0.95, 0.92,
    );

    // claim_confidence fails GA_d → not passed → all_required_passed = false
    assert!(!result.all_required_passed);
    assert!(!result.finality_reached);

    // Verify the specific dimension result
    let claim = &result.dimension_results[DimensionId::ClaimConfidence.index()];
    assert!(!claim.gate_a_monotonic);
    assert!(!claim.passed);
}

// ---------------------------------------------------------------------------
// Per-dimension trajectory quality gate (GC_d) tests
// ---------------------------------------------------------------------------

#[test]
fn vector_finality_fails_when_dim_trajectory_low() {
    let scores = [0.90, 0.98, 0.95, 0.85];
    let config = VectorFinalityConfig::default(); // trajectory threshold = 0.7
    let monotonic = [true, true, true, true];
    // goal_completion has low trajectory quality (oscillating)
    let trajectory = [0.9, 0.9, 0.5, 0.9];
    let gates = make_passing_global_gates();

    let result = evaluate_vector_finality(
        &scores, &config, &monotonic, &trajectory, &gates, 0.95, 0.92,
    );

    assert!(!result.all_required_passed);
    assert!(!result.finality_reached);

    let goal = &result.dimension_results[DimensionId::GoalCompletion.index()];
    assert!(!goal.gate_c_trajectory_ok);
    assert!(!goal.passed);
}

// ---------------------------------------------------------------------------
// Epsilon tolerance sensitivity
// ---------------------------------------------------------------------------

#[test]
fn vector_finality_epsilon_tight_pass() {
    // Score just below threshold but within epsilon
    let scores = [0.84, 0.945, 0.89, 0.78];
    let config = VectorFinalityConfig {
        thresholds: [0.85, 0.95, 0.90, 0.80],
        epsilon: [0.02, 0.01, 0.02, 0.03], // default
        required: [true, true, true, true],
        veto: [false, true, false, false],
        trajectory_quality_threshold: 0.7,
    };
    let monotonic = [true, true, true, true];
    let trajectory = [0.9, 0.9, 0.9, 0.9];
    let gates = make_passing_global_gates();

    let result = evaluate_vector_finality(
        &scores, &config, &monotonic, &trajectory, &gates, 0.95, 0.92,
    );

    // gaps: claim=0.01<=0.02, contra=0.005<=0.01, goal=0.01<=0.02, risk=0.02<=0.03
    assert!(result.all_required_passed, "all within epsilon tolerance");
    assert!(result.finality_reached);
}

#[test]
fn vector_finality_epsilon_zero_requires_exact() {
    let scores = [0.849, 0.98, 0.95, 0.85];
    let config = VectorFinalityConfig {
        thresholds: [0.85, 0.95, 0.90, 0.80],
        epsilon: [0.0, 0.01, 0.02, 0.03], // zero epsilon for claim
        required: [true, true, true, true],
        veto: [false, true, false, false],
        trajectory_quality_threshold: 0.7,
    };
    let monotonic = [true, true, true, true];
    let trajectory = [0.9, 0.9, 0.9, 0.9];
    let gates = make_passing_global_gates();

    let result = evaluate_vector_finality(
        &scores, &config, &monotonic, &trajectory, &gates, 0.95, 0.92,
    );

    // claim gap=0.001 > epsilon=0.0 → fails
    assert!(!result.all_required_passed);
    assert!(!result.finality_reached);
}

// ---------------------------------------------------------------------------
// Global gates interaction
// ---------------------------------------------------------------------------

#[test]
fn vector_finality_fails_when_global_gate_b_fails() {
    let scores = [0.90, 0.98, 0.95, 0.85];
    let config = VectorFinalityConfig::default();
    let monotonic = [true, true, true, true];
    let trajectory = [0.9, 0.9, 0.9, 0.9];
    let mut gates = make_passing_global_gates();
    gates.b_evidence = false; // global gate B fails

    let result = evaluate_vector_finality(
        &scores, &config, &monotonic, &trajectory, &gates, 0.95, 0.92,
    );

    assert!(result.all_required_passed); // per-dim all pass
    assert!(!result.global_gates_passed);
    assert!(!result.finality_reached);
}

#[test]
fn vector_finality_fails_when_global_gate_e_fails() {
    let scores = [0.90, 0.98, 0.95, 0.85];
    let config = VectorFinalityConfig::default();
    let monotonic = [true, true, true, true];
    let trajectory = [0.9, 0.9, 0.9, 0.9];
    let mut gates = make_passing_global_gates();
    gates.e_has_content = false; // no content

    let result = evaluate_vector_finality(
        &scores, &config, &monotonic, &trajectory, &gates, 0.95, 0.92,
    );

    assert!(!result.global_gates_passed);
    assert!(!result.finality_reached);
}

// ---------------------------------------------------------------------------
// Non-required dimension does not block
// ---------------------------------------------------------------------------

#[test]
fn vector_finality_non_required_dim_does_not_block() {
    let scores = [0.90, 0.98, 0.95, 0.50]; // risk_inverse very low
    let config = VectorFinalityConfig {
        thresholds: [0.85, 0.95, 0.90, 0.80],
        epsilon: [0.02, 0.01, 0.02, 0.03],
        required: [true, true, true, false], // risk NOT required
        veto: [false, true, false, false],
        trajectory_quality_threshold: 0.7,
    };
    let monotonic = [true, true, true, true];
    let trajectory = [0.9, 0.9, 0.9, 0.9];
    let gates = make_passing_global_gates();

    let result = evaluate_vector_finality(
        &scores, &config, &monotonic, &trajectory, &gates, 0.95, 0.92,
    );

    // risk fails its threshold but is not required
    assert!(result.all_required_passed);
    assert!(result.finality_reached);

    let risk = &result.dimension_results[DimensionId::RiskInverse.index()];
    assert!(!risk.passed);
    assert!(!risk.is_required);
}

// ---------------------------------------------------------------------------
// Compensation detection: scalar below threshold = no detection
// ---------------------------------------------------------------------------

#[test]
fn no_compensation_when_scalar_also_fails() {
    let scores = [0.50, 0.50, 0.50, 0.50]; // everything low
    let config = VectorFinalityConfig::default();
    let monotonic = [true, true, true, true];
    let trajectory = [0.9, 0.9, 0.9, 0.9];
    let gates = make_passing_global_gates();

    let result = evaluate_vector_finality(
        &scores, &config, &monotonic, &trajectory, &gates,
        0.50, // scalar also fails
        0.92,
    );

    assert!(!result.finality_reached);
    assert!(!result.compensation_detected, "scalar also fails, no compensation");
}

// ---------------------------------------------------------------------------
// Dimension result correctness
// ---------------------------------------------------------------------------

#[test]
fn dimension_results_have_correct_metadata() {
    let scores = [0.90, 0.80, 0.95, 0.85];
    let config = VectorFinalityConfig::default();
    let monotonic = [true, false, true, true];
    let trajectory = [0.9, 0.9, 0.5, 0.9];
    let gates = make_passing_global_gates();

    let result = evaluate_vector_finality(
        &scores, &config, &monotonic, &trajectory, &gates, 0.50, 0.92,
    );

    assert_eq!(result.dimension_results.len(), 4);

    // Check claim_confidence
    let claim = &result.dimension_results[0];
    assert_eq!(claim.dimension, DimensionId::ClaimConfidence);
    assert!((claim.score - 0.90).abs() < 1e-10);
    assert!((claim.threshold - 0.85).abs() < 1e-10);
    assert!((claim.gap - 0.0).abs() < 1e-10);
    assert!(claim.passed);
    assert!(!claim.is_veto);
    assert!(claim.is_required);

    // Check contradiction_resolution: score=0.80, threshold=0.95, monotonic=false
    let contra = &result.dimension_results[1];
    assert_eq!(contra.dimension, DimensionId::ContradictionResolution);
    assert!((contra.gap - 0.15).abs() < 1e-10);
    assert!(!contra.gate_a_monotonic);
    assert!(!contra.passed);
    assert!(contra.is_veto);

    // Check goal_completion: trajectory=0.5 < 0.7
    let goal = &result.dimension_results[2];
    assert_eq!(goal.dimension, DimensionId::GoalCompletion);
    assert!(!goal.gate_c_trajectory_ok);
    assert!(!goal.passed);

    // Check risk_score_inverse: all gates pass
    let risk = &result.dimension_results[3];
    assert_eq!(risk.dimension, DimensionId::RiskInverse);
    assert!(risk.passed);
}
