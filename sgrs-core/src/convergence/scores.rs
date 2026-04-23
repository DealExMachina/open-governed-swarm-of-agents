use crate::types::{DEFAULT_TARGETS, DEFAULT_WEIGHTS};

/// Input snapshot for computing dimension scores.
/// Mirrors the fields from v1 FinalitySnapshot that are needed for convergence math.
#[derive(Debug, Clone)]
pub struct SnapshotInput {
    pub claims_active_avg_confidence: f64,
    pub contradictions_unresolved_count: u32,
    pub contradictions_total_count: u32,
    pub goals_completion_ratio: f64,
    pub scope_risk_score: f64,
}

/// Compute dimension scores from a snapshot.
///
/// Returns `[f64; 4]` indexed by `DimensionId`:
///   [0] ClaimConfidence     = min(avg_confidence / 0.85, 1.0)
///   [1] ContradictionResolution = 1.0 - unresolved/total (or 1.0 if total == 0)
///   [2] GoalCompletion      = goals_completion_ratio
///   [3] RiskInverse          = 1.0 - min(scope_risk_score, 1.0)
pub fn compute_dimension_scores(snapshot: &SnapshotInput) -> [f64; 4] {
    let claim = (snapshot.claims_active_avg_confidence / 0.85).min(1.0);
    let contra = if snapshot.contradictions_total_count == 0 {
        1.0
    } else {
        1.0 - (snapshot.contradictions_unresolved_count as f64
            / snapshot.contradictions_total_count as f64)
    };
    let goal = snapshot.goals_completion_ratio;
    let risk = 1.0 - snapshot.scope_risk_score.min(1.0);
    [claim, contra, goal, risk]
}

/// Scalar Lyapunov disagreement function: V = Σ(w[i] × (target[i] - score[i])²)
///
/// V >= 0; V = 0 means all dimensions at target (perfect finality).
/// V decreasing over time guarantees convergence.
///
/// This is a derived diagnostic — NOT used for lattice admissibility in v2.
pub fn scalar_lyapunov_v(scores: &[f64; 4], targets: &[f64; 4], weights: &[f64; 4]) -> f64 {
    scores
        .iter()
        .enumerate()
        .map(|(i, &s)| weights[i] * (targets[i] - s).powi(2))
        .sum::<f64>()
        .max(0.0)
}

/// Convenience: compute V from a snapshot with default targets and weights.
pub fn lyapunov_v_from_snapshot(snapshot: &SnapshotInput) -> f64 {
    let scores = compute_dimension_scores(snapshot);
    scalar_lyapunov_v(&scores, &DEFAULT_TARGETS, &DEFAULT_WEIGHTS)
}

/// Per-dimension pressure: how far each dimension is from target, weighted.
/// Higher pressure = bigger bottleneck. Used for stigmergic agent routing.
///
/// pressure[i] = weight[i] × max(0, 1 - score[i])
pub fn compute_pressure(scores: &[f64; 4], weights: &[f64; 4]) -> [f64; 4] {
    let mut p = [0.0; 4];
    for i in 0..4 {
        p[i] = weights[i] * (1.0 - scores[i]).max(0.0);
    }
    p
}

/// Squared weighted norm of the gap vector.
/// V = Σ_i  weights[i] × max(0, target[i] - scores[i])²
///
/// Differs from scalar_lyapunov_v when a score exceeds its target:
/// the excess does not contribute (gap is clamped to 0, not squared as a negative).
pub fn gap_norm_squared(scores: &[f64; 4], targets: &[f64; 4], weights: &[f64; 4]) -> f64 {
    scores.iter().enumerate()
        .map(|(i, &s)| { let g = (targets[i] - s).max(0.0); weights[i] * g * g })
        .sum()
}

/// Order property: if rank_b dominates rank_a, then V(rank_b) ≤ V(rank_a).
/// Returns true iff the monotonicity condition holds for the given pair.
pub fn lyapunov_order_property(
    scores_a: &[f64; 4],
    scores_b: &[f64; 4],
    targets: &[f64; 4],
    weights: &[f64; 4],
) -> bool {
    use crate::types::EPSILON;
    let b_dominates_a = scores_b.iter().zip(scores_a.iter()).all(|(b, a)| *b >= *a - EPSILON);
    if b_dominates_a {
        gap_norm_squared(scores_b, targets, weights)
            <= gap_norm_squared(scores_a, targets, weights) + EPSILON
    } else {
        true
    }
}

/// Confirm that pressure equals the weighted gap vector for targets = [1,1,1,1].
/// pressure[i] = weights[i] × max(0, targets[i] - scores[i])
/// Returns false if the relationship does not hold within EPSILON.
pub fn pressure_equals_gap_weights(scores: &[f64; 4], targets: &[f64; 4], weights: &[f64; 4]) -> bool {
    use crate::types::EPSILON;
    let pressure = compute_pressure(scores, weights);
    for i in 0..4 {
        let gap = (targets[i] - scores[i]).max(0.0);
        if (pressure[i] - weights[i] * gap).abs() > EPSILON { return false; }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_snapshot() -> SnapshotInput {
        SnapshotInput {
            claims_active_avg_confidence: 1.0,
            contradictions_unresolved_count: 0,
            contradictions_total_count: 0,
            goals_completion_ratio: 1.0,
            scope_risk_score: 0.0,
        }
    }

    // --- compute_dimension_scores ---

    #[test]
    fn returns_all_ones_for_perfect_snapshot() {
        let scores = compute_dimension_scores(&make_snapshot());
        assert_eq!(scores[0], 1.0); // claim_confidence
        assert_eq!(scores[1], 1.0); // contradiction_resolution
        assert_eq!(scores[2], 1.0); // goal_completion
        assert_eq!(scores[3], 1.0); // risk_score_inverse
    }

    #[test]
    fn clamps_claim_confidence_ratio_to_one() {
        let s = SnapshotInput {
            claims_active_avg_confidence: 0.95,
            ..make_snapshot()
        };
        let scores = compute_dimension_scores(&s);
        // 0.95 / 0.85 > 1, clamped to 1
        assert_eq!(scores[0], 1.0);
    }

    #[test]
    fn computes_contradiction_resolution_correctly() {
        let s = SnapshotInput {
            contradictions_unresolved_count: 1,
            contradictions_total_count: 4,
            ..make_snapshot()
        };
        let scores = compute_dimension_scores(&s);
        assert!((scores[1] - 0.75).abs() < 1e-10);
    }

    // --- scalar_lyapunov_v ---

    #[test]
    fn returns_zero_for_perfect_snapshot() {
        let v = lyapunov_v_from_snapshot(&make_snapshot());
        assert_eq!(v, 0.0);
    }

    #[test]
    fn returns_positive_for_imperfect_snapshot() {
        let s = SnapshotInput {
            claims_active_avg_confidence: 0.5,
            contradictions_unresolved_count: 2,
            contradictions_total_count: 4,
            goals_completion_ratio: 0.6,
            scope_risk_score: 0.3,
            ..make_snapshot()
        };
        let v = lyapunov_v_from_snapshot(&s);
        assert!(v > 0.0);
    }

    #[test]
    fn increases_as_dimensions_worsen() {
        let good = SnapshotInput {
            claims_active_avg_confidence: 0.8,
            goals_completion_ratio: 0.9,
            ..make_snapshot()
        };
        let bad = SnapshotInput {
            claims_active_avg_confidence: 0.4,
            goals_completion_ratio: 0.3,
            ..make_snapshot()
        };
        assert!(lyapunov_v_from_snapshot(&bad) > lyapunov_v_from_snapshot(&good));
    }

    #[test]
    fn returns_zero_when_avg_confidence_at_threshold() {
        let s = SnapshotInput {
            claims_active_avg_confidence: 0.85,
            ..make_snapshot()
        };
        let v = lyapunov_v_from_snapshot(&s);
        assert_eq!(v, 0.0);
    }

    #[test]
    fn handles_zero_contradictions_total() {
        let s = SnapshotInput {
            contradictions_total_count: 0,
            contradictions_unresolved_count: 0,
            ..make_snapshot()
        };
        let v = lyapunov_v_from_snapshot(&s);
        assert_eq!(v, 0.0);
    }

    // --- compute_pressure ---

    #[test]
    fn returns_near_zero_pressure_at_target() {
        let scores = compute_dimension_scores(&make_snapshot());
        let pressure = compute_pressure(&scores, &DEFAULT_WEIGHTS);
        for &p in &pressure {
            assert!(p.abs() < 1e-10);
        }
    }

    #[test]
    fn highest_pressure_on_worst_dimension() {
        let s = SnapshotInput {
            claims_active_avg_confidence: 0.85,
            contradictions_unresolved_count: 3,
            contradictions_total_count: 4,
            goals_completion_ratio: 0.95,
            scope_risk_score: 0.1,
        };
        let scores = compute_dimension_scores(&s);
        let pressure = compute_pressure(&scores, &DEFAULT_WEIGHTS);
        // contradiction_resolution should have highest pressure
        assert!(pressure[1] > pressure[0]);
        assert!(pressure[1] > pressure[2]);
        assert!(pressure[1] > pressure[3]);
    }

    #[test]
    fn pressure_respects_weights() {
        let s = SnapshotInput {
            goals_completion_ratio: 0.0,
            scope_risk_score: 1.0,
            ..make_snapshot()
        };
        let scores = compute_dimension_scores(&s);
        let pressure = compute_pressure(&scores, &DEFAULT_WEIGHTS);
        // goal weight = 0.25, risk weight = 0.15 -> goal pressure > risk pressure
        assert!(pressure[2] > pressure[3]);
    }

    // --- gap_norm_squared ---

    #[test]
    fn gap_norm_squared_equals_lyapunov_v_for_undershoot() {
        // When all scores < targets, gap_norm_squared == scalar_lyapunov_v
        let scores = [0.6, 0.5, 0.7, 0.8];
        let targets = [1.0, 1.0, 1.0, 1.0];
        let v_scalar = scalar_lyapunov_v(&scores, &targets, &DEFAULT_WEIGHTS);
        let v_gap    = gap_norm_squared(&scores, &targets, &DEFAULT_WEIGHTS);
        assert!((v_scalar - v_gap).abs() < 1e-12);
    }

    #[test]
    fn gap_norm_squared_is_zero_at_target() {
        let targets = [1.0, 1.0, 1.0, 1.0];
        let v = gap_norm_squared(&targets, &targets, &DEFAULT_WEIGHTS);
        assert!(v.abs() < 1e-15);
    }

    #[test]
    fn gap_norm_squared_clamps_excess_to_zero() {
        // When score exceeds target, gap = 0, not negative
        let scores  = [1.2, 0.5, 1.0, 1.0];
        let targets = [1.0, 1.0, 1.0, 1.0];
        let v = gap_norm_squared(&scores, &targets, &DEFAULT_WEIGHTS);
        // only dim 1 contributes: 0.3 * (0.5)^2 = 0.075
        assert!((v - 0.075).abs() < 1e-12);
    }

    // --- lyapunov_order_property ---

    #[test]
    fn lyapunov_order_property_holds_when_b_dominates_a() {
        let scores_a = [0.5, 0.5, 0.5, 0.5];
        let scores_b = [0.7, 0.7, 0.7, 0.7];
        let targets  = [1.0, 1.0, 1.0, 1.0];
        assert!(lyapunov_order_property(&scores_a, &scores_b, &targets, &DEFAULT_WEIGHTS));
    }

    #[test]
    fn lyapunov_order_property_v_actually_decreases() {
        let scores_a = [0.5, 0.6, 0.5, 0.5];
        let scores_b = [0.8, 0.9, 0.8, 0.8];
        let targets  = [1.0, 1.0, 1.0, 1.0];
        let va = gap_norm_squared(&scores_a, &targets, &DEFAULT_WEIGHTS);
        let vb = gap_norm_squared(&scores_b, &targets, &DEFAULT_WEIGHTS);
        assert!(vb < va);
        assert!(lyapunov_order_property(&scores_a, &scores_b, &targets, &DEFAULT_WEIGHTS));
    }

    // --- pressure_equals_gap_weights ---

    #[test]
    fn pressure_is_weighted_gap() {
        let scores  = [0.6, 0.7, 0.5, 0.8];
        let targets = [1.0, 1.0, 1.0, 1.0];
        assert!(pressure_equals_gap_weights(&scores, &targets, &DEFAULT_WEIGHTS));
    }

    #[test]
    fn v_equals_sum_of_squared_pressure_over_weight() {
        // V = Σ p[i]² / w[i] iff gap_norm_squared = Σ w[i]*gap[i]² = Σ p[i]²/w[i]
        // (since p[i] = w[i]*gap[i] → p[i]²/w[i] = w[i]*gap[i]²)
        let scores  = [0.6, 0.7, 0.5, 0.8];
        let targets = [1.0, 1.0, 1.0, 1.0];
        let pressure = compute_pressure(&scores, &DEFAULT_WEIGHTS);
        let v_from_pressure: f64 = pressure.iter().enumerate()
            .map(|(i, &p)| p * p / DEFAULT_WEIGHTS[i])
            .sum();
        let v_direct = gap_norm_squared(&scores, &targets, &DEFAULT_WEIGHTS);
        assert!((v_from_pressure - v_direct).abs() < 1e-12);
    }
}
