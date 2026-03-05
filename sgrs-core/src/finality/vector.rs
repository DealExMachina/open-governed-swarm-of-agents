use crate::types::DimensionId;

use super::gates::GateState;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// Per-dimension finality configuration.
///
/// F*(t) = AND_d[e_d(t) <= eps_d AND GA_d AND GC_d] AND GB AND GD AND GE
///
/// where:
///   e_d(t) = max(0, tau_d - mu_d(t))   — per-dimension gap
///   tau_d  = dimension threshold
///   eps_d  = epsilon tolerance
///   GA_d   = per-dimension monotonicity gate
///   GC_d   = per-dimension trajectory quality gate
///   GB, GD, GE = global gates (evidence, quiescence, content)
#[derive(Debug, Clone)]
pub struct VectorFinalityConfig {
    /// Per-dimension thresholds indexed by DimensionId.
    pub thresholds: [f64; 4],
    /// Per-dimension epsilon tolerances.
    pub epsilon: [f64; 4],
    /// Which dimensions are required (must all pass for finality).
    pub required: [bool; 4],
    /// Which dimensions are veto dimensions (any failure blocks finality).
    pub veto: [bool; 4],
    /// Trajectory quality threshold for per-dimension GC_d (default 0.7).
    pub trajectory_quality_threshold: f64,
}

impl Default for VectorFinalityConfig {
    fn default() -> Self {
        Self {
            thresholds: [0.85, 0.95, 0.90, 0.80],
            epsilon: [0.02, 0.01, 0.02, 0.03],
            required: [true, true, true, true],
            veto: [false, true, false, false], // contradiction_resolution is veto
            trajectory_quality_threshold: 0.7,
        }
    }
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/// Per-dimension finality outcome.
#[derive(Debug, Clone)]
pub struct DimensionFinalityResult {
    pub dimension: DimensionId,
    pub score: f64,
    pub threshold: f64,
    pub gap: f64,
    pub epsilon: f64,
    pub passed: bool,
    pub is_veto: bool,
    pub is_required: bool,
    /// Per-dimension monotonicity gate (GA_d).
    pub gate_a_monotonic: bool,
    /// Per-dimension trajectory quality gate (GC_d).
    pub gate_c_trajectory_ok: bool,
}

/// Vector finality result — per-dimension pass/fail with veto tracking.
#[derive(Debug, Clone)]
pub struct VectorFinalityResult {
    pub dimension_results: Vec<DimensionFinalityResult>,
    /// All required dimensions passed their threshold + epsilon + GA_d + GC_d.
    pub all_required_passed: bool,
    /// At least one veto dimension failed.
    pub veto_triggered: bool,
    /// Which veto dimensions caused the block.
    pub veto_causes: Vec<DimensionId>,
    /// Global gates (GB, GD, GE) all passed.
    pub global_gates_passed: bool,
    /// Overall vector finality: F* = all_required AND !veto AND global_gates.
    pub finality_reached: bool,
    /// Scalar compensation detected: scalar score would pass but vector blocks.
    pub compensation_detected: bool,
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/// Per-dimension finality gap: e_d(t) = max(0, tau_d - mu_d(t))
#[inline]
pub fn dimension_gap(score: f64, threshold: f64) -> f64 {
    (threshold - score).max(0.0)
}

/// Per-dimension finality check with epsilon tolerance.
#[inline]
pub fn dimension_final(score: f64, threshold: f64, epsilon: f64) -> bool {
    dimension_gap(score, threshold) <= epsilon
}

/// Evaluate vector finality predicate.
///
/// F*(t) = AND_d[e_d <= eps_d AND GA_d AND GC_d] AND GB AND GD AND GE
///
/// Arguments:
/// - `scores`: per-dimension scores [0, 1] indexed by DimensionId
/// - `config`: vector finality configuration
/// - `per_dim_monotonic`: per-dimension monotonicity gate (GA_d)
/// - `per_dim_trajectory`: per-dimension trajectory quality [0, 1]
/// - `global_gates`: scalar gates (GB, GD, GE from existing gate evaluation)
/// - `scalar_score`: weighted scalar goal score (for compensation detection)
/// - `scalar_threshold`: auto-finality threshold (for compensation detection)
pub fn evaluate_vector_finality(
    scores: &[f64; 4],
    config: &VectorFinalityConfig,
    per_dim_monotonic: &[bool; 4],
    per_dim_trajectory: &[f64; 4],
    global_gates: &GateState,
    scalar_score: f64,
    scalar_threshold: f64,
) -> VectorFinalityResult {
    let mut dimension_results = Vec::with_capacity(4);
    let mut all_required_passed = true;
    let mut veto_triggered = false;
    let mut veto_causes = Vec::new();

    for dim in DimensionId::ALL {
        let idx = dim.index();
        let score = scores[idx];
        let threshold = config.thresholds[idx];
        let eps = config.epsilon[idx];
        let gap = dimension_gap(score, threshold);
        let is_required = config.required[idx];
        let is_veto = config.veto[idx];
        let gate_a = per_dim_monotonic[idx];
        let gate_c = per_dim_trajectory[idx] >= config.trajectory_quality_threshold;

        // Dimension passes iff: gap <= epsilon AND GA_d AND GC_d
        let passed = gap <= eps && gate_a && gate_c;

        if is_required && !passed {
            all_required_passed = false;
        }
        if is_veto && !passed {
            veto_triggered = true;
            veto_causes.push(dim);
        }

        dimension_results.push(DimensionFinalityResult {
            dimension: dim,
            score,
            threshold,
            gap,
            epsilon: eps,
            passed,
            is_veto,
            is_required,
            gate_a_monotonic: gate_a,
            gate_c_trajectory_ok: gate_c,
        });
    }

    // Global gates: we only need GB (evidence), GD (quiescent), GE (content)
    // GA and GC are now per-dimension, so we don't require the scalar versions.
    let global_gates_passed = global_gates.b_evidence
        && global_gates.d_quiescent
        && global_gates.e_has_content;

    let finality_reached = all_required_passed && !veto_triggered && global_gates_passed;

    // Compensation detection: scalar would pass but vector blocks
    let compensation_detected =
        scalar_score >= scalar_threshold && !finality_reached;

    VectorFinalityResult {
        dimension_results,
        all_required_passed,
        veto_triggered,
        veto_causes,
        global_gates_passed,
        finality_reached,
        compensation_detected,
    }
}
