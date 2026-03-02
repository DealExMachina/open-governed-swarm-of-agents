use crate::convergence::compute_dimension_scores;
use crate::convergence::SnapshotInput;
use crate::types::DEFAULT_WEIGHTS;

/// Compute weighted goal score (0-1) for the scope.
///
/// Formula: `sum(dimension_score[i] * weight[i])` clamped to [0, 1].
///
/// This delegates to `compute_dimension_scores` (already in Rust) and then
/// dot-products with the weights.
///
/// Port of `computeGoalScore` from finalityEvaluator.ts lines 220-237.
pub fn compute_goal_score(snapshot: &SnapshotInput, weights: &[f64; 4]) -> f64 {
    let scores = compute_dimension_scores(snapshot);
    let goal_score: f64 = scores
        .iter()
        .zip(weights.iter())
        .map(|(s, w)| s * w)
        .sum();
    goal_score.clamp(0.0, 1.0)
}

/// Compute goal score with default weights.
pub fn compute_goal_score_default(snapshot: &SnapshotInput) -> f64 {
    compute_goal_score(snapshot, &DEFAULT_WEIGHTS)
}
