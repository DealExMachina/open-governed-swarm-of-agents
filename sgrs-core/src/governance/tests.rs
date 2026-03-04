use super::kernel::{evaluate_kernel, KernelInput, ReductionVerdict};
use super::policy::{can_transition, evaluate_rules, DriftLevel, PolicyRule, TransitionRule};
use crate::types::{
    AdmissibilityResult, ConvergenceRank, GovernanceLevel, LatticePoint,
};

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

fn sample_rules() -> Vec<PolicyRule> {
    vec![
        PolicyRule {
            when_drift_levels: vec![DriftLevel::High, DriftLevel::Critical],
            when_drift_type: "semantic".to_string(),
            action: "open_investigation".to_string(),
        },
        PolicyRule {
            when_drift_levels: vec![DriftLevel::Critical],
            when_drift_type: "structural".to_string(),
            action: "halt_pipeline".to_string(),
        },
    ]
}

fn sample_transition_rules() -> Vec<TransitionRule> {
    vec![TransitionRule {
        from: "DriftChecked".to_string(),
        to: "ContextIngested".to_string(),
        block_when_drift: vec![DriftLevel::Critical],
        reason: "Critical drift level detected".to_string(),
    }]
}

fn make_lattice(gov: GovernanceLevel, dims: [f64; 4], epoch: u64) -> LatticePoint {
    LatticePoint {
        governance: gov,
        rank: ConvergenceRank {
            dimensions: dims,
            epoch,
        },
    }
}

// ---------------------------------------------------------------------------
// DriftLevel
// ---------------------------------------------------------------------------

#[test]
fn drift_level_from_str() {
    assert_eq!(DriftLevel::from_str("none"), DriftLevel::None);
    assert_eq!(DriftLevel::from_str("low"), DriftLevel::Low);
    assert_eq!(DriftLevel::from_str("MEDIUM"), DriftLevel::Medium);
    assert_eq!(DriftLevel::from_str("High"), DriftLevel::High);
    assert_eq!(DriftLevel::from_str("critical"), DriftLevel::Critical);
    assert_eq!(DriftLevel::from_str("unknown"), DriftLevel::None);
}

#[test]
fn drift_level_roundtrip() {
    for level in &[
        DriftLevel::None,
        DriftLevel::Low,
        DriftLevel::Medium,
        DriftLevel::High,
        DriftLevel::Critical,
    ] {
        assert_eq!(DriftLevel::from_str(level.as_str()), *level);
    }
}

// ---------------------------------------------------------------------------
// evaluate_rules
// ---------------------------------------------------------------------------

#[test]
fn evaluate_rules_empty_drift_types() {
    let rules = sample_rules();
    let actions = evaluate_rules(&DriftLevel::Critical, &[], &rules);
    assert!(actions.is_empty());
}

#[test]
fn evaluate_rules_high_semantic() {
    let rules = sample_rules();
    let types = vec!["semantic".to_string()];
    let actions = evaluate_rules(&DriftLevel::High, &types, &rules);
    assert_eq!(actions, vec!["open_investigation"]);
}

#[test]
fn evaluate_rules_critical_semantic_and_structural() {
    let rules = sample_rules();
    let types = vec!["semantic".to_string(), "structural".to_string()];
    let actions = evaluate_rules(&DriftLevel::Critical, &types, &rules);
    assert_eq!(actions.len(), 2);
    assert!(actions.contains(&"open_investigation".to_string()));
    assert!(actions.contains(&"halt_pipeline".to_string()));
}

#[test]
fn evaluate_rules_low_no_match() {
    let rules = sample_rules();
    let types = vec!["semantic".to_string()];
    let actions = evaluate_rules(&DriftLevel::Low, &types, &rules);
    assert!(actions.is_empty());
}

#[test]
fn evaluate_rules_type_mismatch() {
    let rules = sample_rules();
    let types = vec!["temporal".to_string()];
    let actions = evaluate_rules(&DriftLevel::Critical, &types, &rules);
    assert!(actions.is_empty());
}

#[test]
fn evaluate_rules_empty_rules() {
    let actions = evaluate_rules(&DriftLevel::Critical, &["semantic".to_string()], &[]);
    assert!(actions.is_empty());
}

// ---------------------------------------------------------------------------
// can_transition
// ---------------------------------------------------------------------------

#[test]
fn can_transition_allowed_no_rules() {
    let result = can_transition("A", "B", &DriftLevel::Critical, &[]);
    assert!(result.allowed);
    assert_eq!(result.reason, "no blocking rule");
}

#[test]
fn can_transition_allowed_unmatched_transition() {
    let rules = sample_transition_rules();
    let result = can_transition("ContextIngested", "FactsExtracted", &DriftLevel::Critical, &rules);
    assert!(result.allowed);
}

#[test]
fn can_transition_allowed_drift_not_blocked() {
    let rules = sample_transition_rules();
    let result = can_transition("DriftChecked", "ContextIngested", &DriftLevel::High, &rules);
    assert!(result.allowed);
}

#[test]
fn can_transition_blocked() {
    let rules = sample_transition_rules();
    let result =
        can_transition("DriftChecked", "ContextIngested", &DriftLevel::Critical, &rules);
    assert!(!result.allowed);
    assert_eq!(result.reason, "Critical drift level detected");
}

#[test]
fn can_transition_multiple_rules() {
    let rules = vec![
        TransitionRule {
            from: "A".to_string(),
            to: "B".to_string(),
            block_when_drift: vec![DriftLevel::High],
            reason: "reason1".to_string(),
        },
        TransitionRule {
            from: "A".to_string(),
            to: "B".to_string(),
            block_when_drift: vec![DriftLevel::Critical],
            reason: "reason2".to_string(),
        },
    ];
    // First matching rule wins
    let result = can_transition("A", "B", &DriftLevel::High, &rules);
    assert!(!result.allowed);
    assert_eq!(result.reason, "reason1");
}

// ---------------------------------------------------------------------------
// Kernel: policy-only (no lattice)
// ---------------------------------------------------------------------------

fn kernel_input(
    from: &str,
    to: &str,
    drift: DriftLevel,
    mode: GovernanceLevel,
) -> KernelInput {
    KernelInput {
        from_state: from.to_string(),
        to_state: to.to_string(),
        drift_level: drift,
        drift_types: vec![],
        mode,
        current_lattice: None,
        proposed_lattice: None,
    }
}

#[test]
fn kernel_yolo_allowed() {
    let input = kernel_input("ContextIngested", "FactsExtracted", DriftLevel::Low, GovernanceLevel::Yolo);
    let output = evaluate_kernel(&input, &sample_rules(), &sample_transition_rules());
    assert_eq!(output.verdict, ReductionVerdict::Accept);
    assert_eq!(output.reason, "policy_passed");
}

#[test]
fn kernel_yolo_blocked_accepts_with_override() {
    // YOLO is the most permissive mode: accepts even when policy blocks,
    // but logs the override reason and adds blocked_transition to suggested_actions.
    let input = kernel_input("DriftChecked", "ContextIngested", DriftLevel::Critical, GovernanceLevel::Yolo);
    let output = evaluate_kernel(&input, &sample_rules(), &sample_transition_rules());
    assert_eq!(output.verdict, ReductionVerdict::Accept);
    assert!(output.reason.starts_with("yolo_override:"));
    assert!(output.reason.contains("Critical drift"));
    assert!(output.suggested_actions.iter().any(|a| a.contains("blocked_transition_overridden")));
}

#[test]
fn kernel_mitl_allowed_escalates() {
    let input = kernel_input("ContextIngested", "FactsExtracted", DriftLevel::Low, GovernanceLevel::Mitl);
    let output = evaluate_kernel(&input, &sample_rules(), &sample_transition_rules());
    assert_eq!(output.verdict, ReductionVerdict::Escalate);
    assert_eq!(output.reason, "mitl_required");
}

#[test]
fn kernel_mitl_blocked_escalates() {
    let input = kernel_input("DriftChecked", "ContextIngested", DriftLevel::Critical, GovernanceLevel::Mitl);
    let output = evaluate_kernel(&input, &sample_rules(), &sample_transition_rules());
    assert_eq!(output.verdict, ReductionVerdict::Escalate);
    assert!(output.reason.contains("Critical drift"));
}

#[test]
fn kernel_master_allowed_accepts() {
    let input = kernel_input("ContextIngested", "FactsExtracted", DriftLevel::Low, GovernanceLevel::Master);
    let output = evaluate_kernel(&input, &sample_rules(), &sample_transition_rules());
    assert_eq!(output.verdict, ReductionVerdict::Accept);
    assert_eq!(output.reason, "policy_passed");
}

#[test]
fn kernel_master_blocked_rejects() {
    // This is the MASTER bug fix: MASTER + blocked → Reject, not auto-approve
    let input = kernel_input("DriftChecked", "ContextIngested", DriftLevel::Critical, GovernanceLevel::Master);
    let output = evaluate_kernel(&input, &sample_rules(), &sample_transition_rules());
    assert_eq!(output.verdict, ReductionVerdict::Reject);
    assert!(output.reason.contains("Critical drift"));
}

#[test]
fn kernel_suggested_actions_propagated() {
    let mut input = kernel_input("ContextIngested", "FactsExtracted", DriftLevel::High, GovernanceLevel::Yolo);
    input.drift_types = vec!["semantic".to_string()];
    let output = evaluate_kernel(&input, &sample_rules(), &sample_transition_rules());
    assert_eq!(output.verdict, ReductionVerdict::Accept);
    assert!(output.suggested_actions.contains(&"open_investigation".to_string()));
}

// ---------------------------------------------------------------------------
// Kernel: lattice checks
// ---------------------------------------------------------------------------

#[test]
fn kernel_lattice_admissible() {
    let mut input = kernel_input("A", "B", DriftLevel::None, GovernanceLevel::Yolo);
    input.current_lattice = Some(make_lattice(GovernanceLevel::Yolo, [0.5, 0.5, 0.5, 0.5], 1));
    input.proposed_lattice = Some(make_lattice(GovernanceLevel::Yolo, [0.6, 0.6, 0.6, 0.6], 1));
    let output = evaluate_kernel(&input, &[], &[]);
    assert_eq!(output.verdict, ReductionVerdict::Accept);
    assert_eq!(output.reason, "policy_passed");
    assert!(output.regressed_dimensions.is_empty());
}

#[test]
fn kernel_lattice_governance_violation_rejects() {
    let mut input = kernel_input("A", "B", DriftLevel::None, GovernanceLevel::Yolo);
    input.current_lattice = Some(make_lattice(GovernanceLevel::Mitl, [0.5, 0.5, 0.5, 0.5], 1));
    input.proposed_lattice = Some(make_lattice(GovernanceLevel::Yolo, [0.6, 0.6, 0.6, 0.6], 1));
    let output = evaluate_kernel(&input, &[], &[]);
    assert_eq!(output.verdict, ReductionVerdict::Reject);
    assert_eq!(output.reason, "lattice_violation");
}

#[test]
fn kernel_lattice_convergence_violation_master_rejects() {
    let mut input = kernel_input("A", "B", DriftLevel::None, GovernanceLevel::Master);
    input.current_lattice = Some(make_lattice(GovernanceLevel::Master, [0.8, 0.8, 0.8, 0.8], 1));
    input.proposed_lattice = Some(make_lattice(GovernanceLevel::Master, [0.5, 0.5, 0.5, 0.5], 1));
    let output = evaluate_kernel(&input, &[], &[]);
    assert_eq!(output.verdict, ReductionVerdict::Reject);
    assert_eq!(output.reason, "convergence_violation");
    assert_eq!(output.regressed_dimensions.len(), 4);
}

#[test]
fn kernel_lattice_convergence_violation_yolo_accepts_with_override() {
    // YOLO accepts even on convergence violations (with yolo_override reason)
    let mut input = kernel_input("A", "B", DriftLevel::None, GovernanceLevel::Yolo);
    input.current_lattice = Some(make_lattice(GovernanceLevel::Yolo, [0.8, 0.8, 0.8, 0.8], 1));
    input.proposed_lattice = Some(make_lattice(GovernanceLevel::Yolo, [0.5, 0.5, 0.5, 0.5], 1));
    let output = evaluate_kernel(&input, &[], &[]);
    assert_eq!(output.verdict, ReductionVerdict::Accept);
    assert!(output.reason.starts_with("yolo_override:"));
    assert!(output.reason.contains("convergence_violation"));
}

#[test]
fn kernel_lattice_incomparable_master_rejects() {
    let mut input = kernel_input("A", "B", DriftLevel::None, GovernanceLevel::Master);
    input.current_lattice = Some(make_lattice(GovernanceLevel::Master, [0.8, 0.5, 0.6, 0.5], 1));
    input.proposed_lattice = Some(make_lattice(GovernanceLevel::Master, [0.5, 0.8, 0.6, 0.5], 1));
    let output = evaluate_kernel(&input, &[], &[]);
    assert_eq!(output.verdict, ReductionVerdict::Reject);
    assert_eq!(output.reason, "lattice_incomparable");
    assert!(!output.regressed_dimensions.is_empty());
}

#[test]
fn kernel_lattice_incomparable_yolo_accepts_with_override() {
    // YOLO accepts on lattice incomparability (with yolo_override reason)
    let mut input = kernel_input("A", "B", DriftLevel::None, GovernanceLevel::Yolo);
    input.current_lattice = Some(make_lattice(GovernanceLevel::Yolo, [0.8, 0.5, 0.6, 0.5], 1));
    input.proposed_lattice = Some(make_lattice(GovernanceLevel::Yolo, [0.5, 0.8, 0.6, 0.5], 1));
    let output = evaluate_kernel(&input, &[], &[]);
    assert_eq!(output.verdict, ReductionVerdict::Accept);
    assert!(output.reason.starts_with("yolo_override:"));
    assert!(output.reason.contains("lattice_incomparable"));
}

#[test]
fn kernel_cross_epoch_allows_regression() {
    let mut input = kernel_input("A", "B", DriftLevel::None, GovernanceLevel::Yolo);
    input.current_lattice = Some(make_lattice(GovernanceLevel::Yolo, [0.8, 0.8, 0.8, 0.8], 1));
    input.proposed_lattice = Some(make_lattice(GovernanceLevel::Yolo, [0.5, 0.5, 0.5, 0.5], 2));
    let output = evaluate_kernel(&input, &[], &[]);
    assert_eq!(output.verdict, ReductionVerdict::Accept);
    assert_eq!(output.reason, "policy_passed");
}

#[test]
fn kernel_no_lattice_policy_only() {
    let input = kernel_input("A", "B", DriftLevel::None, GovernanceLevel::Yolo);
    let output = evaluate_kernel(&input, &[], &[]);
    assert_eq!(output.verdict, ReductionVerdict::Accept);
    assert!(output.admissibility.is_none());
}

#[test]
fn kernel_both_violated_rejects() {
    let mut input = kernel_input("A", "B", DriftLevel::None, GovernanceLevel::Yolo);
    // Governance de-escalation (Mitl → Yolo) + convergence regression
    input.current_lattice = Some(make_lattice(GovernanceLevel::Mitl, [0.8, 0.8, 0.8, 0.8], 1));
    input.proposed_lattice = Some(make_lattice(GovernanceLevel::Yolo, [0.5, 0.5, 0.5, 0.5], 1));
    let output = evaluate_kernel(&input, &[], &[]);
    assert_eq!(output.verdict, ReductionVerdict::Reject);
    assert_eq!(output.reason, "lattice_violation");
    match output.admissibility {
        Some(AdmissibilityResult::BothViolated) => {}
        other => panic!("expected BothViolated, got {:?}", other),
    }
}
