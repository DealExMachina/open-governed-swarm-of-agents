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
