use super::conditions::{evaluate_condition, parse_condition, FinalitySnapshotFull};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// Configuration for the six finality gates (A–F).
#[derive(Debug, Clone)]
pub struct GateConfig {
    /// Gate B: enforce evidence coverage check. Default false (gradual rollout).
    pub gate_b_enforced: bool,
    /// Gate C: minimum trajectory quality threshold. Default 0.7.
    pub trajectory_quality_threshold: f64,
    /// Gate D: maximum unresolved contradictions for quiescence. 0 = disabled.
    pub quiescence_max_unresolved: u32,
    /// Gate D: maximum active critical risks for quiescence. 0 = disabled.
    pub quiescence_max_risks: u32,
    /// Gate F: enforce elimination completeness check. Default false.
    pub gate_f_enforced: bool,
    /// Gate F: refutation threshold — dimensions with refutation above this
    /// must have been formally eliminated. Default 0.7.
    pub elimination_refutation_threshold: f64,
}

impl Default for GateConfig {
    fn default() -> Self {
        Self {
            gate_b_enforced: false,
            trajectory_quality_threshold: 0.7,
            quiescence_max_unresolved: 0,
            quiescence_max_risks: 0,
            gate_f_enforced: false,
            elimination_refutation_threshold: 0.7,
        }
    }
}

// ---------------------------------------------------------------------------
// Gate state
// ---------------------------------------------------------------------------

/// State of all six finality gates (A–F) after evaluation.
#[derive(Debug, Clone, PartialEq)]
pub struct GateState {
    /// Gate A: goal score is monotonically non-decreasing for beta rounds.
    pub a_monotonic: bool,
    /// Gate B: evidence coverage (contradiction mass == 0, coverage >= 0.99).
    pub b_evidence: bool,
    /// Gate C: trajectory quality >= threshold (no oscillation/spike-drop).
    pub c_trajectory: bool,
    /// Gate D: quiescence (idle cycles + risk check).
    pub d_quiescent: bool,
    /// Gate E: minimum content (at least one claim or incomplete goals).
    pub e_has_content: bool,
    /// Gate F: elimination completeness — all dimensions with refutation > θ_refute
    /// have been formally eliminated.
    pub f_elimination_complete: bool,
}

impl GateState {
    /// True if all six gates pass.
    pub fn all_passed(&self) -> bool {
        self.a_monotonic
            && self.b_evidence
            && self.c_trajectory
            && self.d_quiescent
            && self.e_has_content
            && self.f_elimination_complete
    }
}

// ---------------------------------------------------------------------------
// Condition mode
// ---------------------------------------------------------------------------

/// How to combine multiple conditions: all must pass, or any one suffices.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConditionMode {
    All,
    Any,
}

impl ConditionMode {
    pub fn from_str(s: &str) -> Self {
        match s {
            "any" => Self::Any,
            _ => Self::All,
        }
    }
}

// ---------------------------------------------------------------------------
// Gate evaluation
// ---------------------------------------------------------------------------

/// Evaluate all six finality gates (A–F). Pure function.
///
/// - Gate A: `is_monotonic` — passthrough from convergence analysis
/// - Gate B: `contradiction_mass == 0 && evidence_coverage >= 0.99`
///   (only enforced when `gate_b_enforced` is true)
/// - Gate C: `trajectory_quality >= threshold` (default 0.7)
/// - Gate D: quiescence — disabled when both params are 0
/// - Gate E: has content (`claims_active_count > 0 || goals_completion_ratio < 1`)
/// - Gate F: elimination completeness — all dimensions with mean refutation > θ must have support ≈ 0
///   (formally eliminated). Disabled when `gate_f_enforced` is false. `eliminated_dimensions`: indices
///   that have been formally eliminated.
pub fn evaluate_gates(
    snapshot: &FinalitySnapshotFull,
    is_monotonic: bool,
    trajectory_quality: f64,
    config: &GateConfig,
) -> GateState {
    // Gate B: evidence coverage
    let gate_b = if config.gate_b_enforced {
        snapshot.contradiction_mass == 0.0 && snapshot.evidence_coverage >= 0.99
    } else {
        true // not enforced = auto-pass
    };

    // Gate D: quiescence
    let gate_d = if config.quiescence_max_unresolved == 0 && config.quiescence_max_risks == 0 {
        true // disabled
    } else {
        snapshot.contradictions_unresolved_count <= config.quiescence_max_unresolved
            && snapshot.risks_critical_active_count <= config.quiescence_max_risks
    };

    // Gate F: elimination completeness
    let gate_f = if config.gate_f_enforced {
        // Check via eliminated_dimensions provided in snapshot
        snapshot.elimination_complete
    } else {
        true // not enforced = auto-pass
    };

    GateState {
        a_monotonic: is_monotonic,
        b_evidence: gate_b,
        c_trajectory: trajectory_quality >= config.trajectory_quality_threshold,
        d_quiescent: gate_d,
        e_has_content: snapshot.claims_active_count > 0 || snapshot.goals_completion_ratio < 1.0,
        f_elimination_complete: gate_f,
    }
}

// ---------------------------------------------------------------------------
// Batch condition evaluation
// ---------------------------------------------------------------------------

/// Evaluate a set of finality conditions against a snapshot.
///
/// - `mode = All`: all conditions must be met
/// - `mode = Any`: at least one condition must be met
///
/// Unknown keys (evaluate_condition returns None) are treated as not met.
pub fn evaluate_conditions(
    conditions: &[String],
    mode: ConditionMode,
    snapshot: &FinalitySnapshotFull,
) -> bool {
    let evaluated: Vec<bool> = conditions
        .iter()
        .map(|c| {
            let parsed = parse_condition(c);
            evaluate_condition(&parsed, snapshot).unwrap_or(false)
        })
        .collect();

    match mode {
        ConditionMode::All => evaluated.iter().all(|&r| r),
        ConditionMode::Any => evaluated.iter().any(|&r| r),
    }
}
