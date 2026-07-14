use crate::types::{AdmissibilityResult, DimensionId, GovernanceLevel, LatticePoint};

use super::policy::{can_transition, evaluate_rules, DriftLevel, PolicyRule, TransitionRule};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Verdict produced by the reduction kernel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReductionVerdict {
    Accept,
    Reject,
    Escalate,
    /// Eliminate evidence on a specific dimension via bilattice meet_t.
    /// Governance certifies that refutation evidence warrants hypothesis removal.
    Eliminate,
}

impl ReductionVerdict {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Accept => "accept",
            Self::Reject => "reject",
            Self::Escalate => "escalate",
            Self::Eliminate => "eliminate",
        }
    }
}

/// Certificate for an elimination action.
///
/// When the kernel produces `Eliminate`, this certificate specifies which
/// dimension to eliminate and the evidence backing the elimination.
/// The propagation layer uses this to construct an elimination mask
/// applied via `meet_t`.
#[derive(Debug, Clone)]
pub struct EliminationCertificate {
    /// Which base dimension to eliminate (0-indexed into EvidenceVector).
    pub dimension: usize,
    /// Refutation evidence strength — must exceed θ_refute threshold.
    pub refutation_evidence: f64,
    /// Which role(s) originated the elimination request.
    pub originating_roles: Vec<usize>,
    /// Human-readable reason for elimination.
    pub reason: String,
}

/// Input to the reduction kernel — all data needed for a deterministic decision.
#[derive(Debug, Clone)]
pub struct KernelInput {
    pub from_state: String,
    pub to_state: String,
    pub drift_level: DriftLevel,
    pub drift_types: Vec<String>,
    pub mode: GovernanceLevel,
    /// Current lattice point (optional — lattice check skipped when None).
    pub current_lattice: Option<LatticePoint>,
    /// Proposed lattice point (optional — lattice check skipped when None).
    pub proposed_lattice: Option<LatticePoint>,
}

/// Output from the reduction kernel.
#[derive(Debug, Clone)]
pub struct KernelOutput {
    pub verdict: ReductionVerdict,
    pub reason: String,
    pub suggested_actions: Vec<String>,
    pub admissibility: Option<AdmissibilityResult>,
    pub regressed_dimensions: Vec<DimensionId>,
    /// Present when verdict = Eliminate — specifies the elimination target.
    pub elimination: Option<EliminationCertificate>,
}

// ---------------------------------------------------------------------------
// Kernel evaluation
// ---------------------------------------------------------------------------

/// Evaluate a governance proposal through the reduction kernel.
///
/// Flow:
/// 1. Policy evaluation: `can_transition` + `evaluate_rules`
/// 2. If policy blocks: MASTER → Reject, MITL → Escalate, YOLO → Accept (with obligations)
/// 3. Lattice admissibility (when lattice data present)
/// 4. Final mode routing: MITL → Escalate, MASTER/YOLO → Accept
///
/// Mode semantics:
/// - YOLO: Most permissive — accepts even when policy blocks (with logged obligations)
/// - MITL: Moderate — escalates to human for blocked transitions
/// - MASTER: Most restrictive — rejects on any policy block
pub fn evaluate_kernel(
    input: &KernelInput,
    rules: &[PolicyRule],
    transition_rules: &[TransitionRule],
) -> KernelOutput {
    // 1. Policy evaluation
    let transition = can_transition(
        &input.from_state,
        &input.to_state,
        &input.drift_level,
        transition_rules,
    );
    let suggested_actions = evaluate_rules(&input.drift_level, &input.drift_types, rules);

    // 2. If policy blocks
    if !transition.allowed {
        let verdict = match input.mode {
            GovernanceLevel::Master => ReductionVerdict::Reject,
            GovernanceLevel::Mitl => ReductionVerdict::Escalate,
            // YOLO: accept despite policy block — "proceed at your own risk"
            GovernanceLevel::Yolo => ReductionVerdict::Accept,
        };
        let reason = match input.mode {
            // YOLO override: record that we accepted despite a policy block
            GovernanceLevel::Yolo => format!("yolo_override: {}", transition.reason),
            _ => transition.reason,
        };
        // For YOLO overrides, include the block reason in suggested_actions
        // so the oversight agent can see what was overridden.
        let mut actions = suggested_actions;
        if matches!(input.mode, GovernanceLevel::Yolo) {
            actions.push(format!("blocked_transition_overridden: {}", reason));
        }
        return KernelOutput {
            verdict,
            reason,
            suggested_actions: actions,
            admissibility: None,
            regressed_dimensions: vec![],
            elimination: None,
        };
    }

    // 3. Lattice admissibility check (optional)
    if let (Some(current), Some(proposed)) = (&input.current_lattice, &input.proposed_lattice) {
        let same_epoch = current.rank.epoch == proposed.rank.epoch;
        let admissibility = current.check_transition(proposed, same_epoch);

        match &admissibility {
            AdmissibilityResult::Admissible => {
                // Continue to final mode routing
            }
            AdmissibilityResult::GovernanceViolation | AdmissibilityResult::BothViolated => {
                return KernelOutput {
                    verdict: ReductionVerdict::Reject,
                    reason: "lattice_violation".to_string(),
                    suggested_actions,
                    admissibility: Some(admissibility),
                    regressed_dimensions: vec![],
                    elimination: None,
                };
            }
            AdmissibilityResult::ConvergenceViolation { regressed } => {
                let dims = regressed.clone();
                let verdict = match input.mode {
                    GovernanceLevel::Master => ReductionVerdict::Reject,
                    GovernanceLevel::Mitl => ReductionVerdict::Escalate,
                    GovernanceLevel::Yolo => ReductionVerdict::Accept,
                };
                return KernelOutput {
                    verdict,
                    reason: if matches!(input.mode, GovernanceLevel::Yolo) {
                        "yolo_override: convergence_violation".to_string()
                    } else {
                        "convergence_violation".to_string()
                    },
                    suggested_actions,
                    admissibility: Some(admissibility),
                    regressed_dimensions: dims,
                    elimination: None,
                };
            }
            AdmissibilityResult::Incomparable {
                improved: _,
                regressed,
            } => {
                let dims = regressed.clone();
                let verdict = match input.mode {
                    GovernanceLevel::Master => ReductionVerdict::Reject,
                    GovernanceLevel::Mitl => ReductionVerdict::Escalate,
                    GovernanceLevel::Yolo => ReductionVerdict::Accept,
                };
                return KernelOutput {
                    verdict,
                    reason: if matches!(input.mode, GovernanceLevel::Yolo) {
                        "yolo_override: lattice_incomparable".to_string()
                    } else {
                        "lattice_incomparable".to_string()
                    },
                    suggested_actions,
                    admissibility: Some(admissibility),
                    regressed_dimensions: dims,
                    elimination: None,
                };
            }
        }
    }

    // 4. Final mode routing
    match input.mode {
        GovernanceLevel::Mitl => KernelOutput {
            verdict: ReductionVerdict::Escalate,
            reason: "mitl_required".to_string(),
            suggested_actions,
            admissibility: None,
            regressed_dimensions: vec![],
            elimination: None,
        },
        GovernanceLevel::Master | GovernanceLevel::Yolo => KernelOutput {
            verdict: ReductionVerdict::Accept,
            reason: "policy_passed".to_string(),
            suggested_actions,
            admissibility: None,
            regressed_dimensions: vec![],
            elimination: None,
        },
    }
}
