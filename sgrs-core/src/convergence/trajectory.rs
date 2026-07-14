//! Trajectory quality analysis: oscillation detection, autocorrelation, quality score.
//! Implements Gate C from the finality predicate.

/// Configuration for trajectory quality computation.
#[derive(Debug, Clone)]
pub struct TrajectoryConfig {
    /// Penalty per direction change (default 0.12).
    pub direction_penalty: f64,
    /// Max direction changes before capping (default 5).
    pub max_directions: usize,
    /// Autocorrelation threshold for oscillation detection (default -0.3).
    pub autocorr_threshold: f64,
    /// Quality cap when oscillation detected (default 0.65).
    pub oscillation_cap: f64,
    /// Quality cap on spike-and-drop (default 0.85).
    pub spike_drop_cap: f64,
}

impl Default for TrajectoryConfig {
    fn default() -> Self {
        Self {
            direction_penalty: 0.12,
            max_directions: 5,
            autocorr_threshold: -0.3,
            oscillation_cap: 0.65,
            spike_drop_cap: 0.85,
        }
    }
}

/// Result of trajectory quality computation.
#[derive(Debug, Clone)]
pub struct TrajectoryResult {
    pub quality: f64,
    pub oscillation_detected: bool,
    pub autocorrelation_lag1: Option<f64>,
    pub direction_changes: usize,
}

/// Pearson correlation coefficient between two slices.
/// Returns `None` if fewer than 2 elements or if standard deviation is zero.
///
/// Replaces the `simple-statistics.sampleCorrelation` dependency from v1.
pub fn pearson_correlation(x: &[f64], y: &[f64]) -> Option<f64> {
    let n = x.len().min(y.len());
    if n < 2 {
        return None;
    }

    let mean_x: f64 = x[..n].iter().sum::<f64>() / n as f64;
    let mean_y: f64 = y[..n].iter().sum::<f64>() / n as f64;

    let mut sum_xy = 0.0;
    let mut sum_x2 = 0.0;
    let mut sum_y2 = 0.0;

    for i in 0..n {
        let dx = x[i] - mean_x;
        let dy = y[i] - mean_y;
        sum_xy += dx * dy;
        sum_x2 += dx * dx;
        sum_y2 += dy * dy;
    }

    let denom = (sum_x2 * sum_y2).sqrt();
    if denom < 1e-15 {
        return None; // zero variance
    }

    let r = sum_xy / denom;
    if r.is_finite() {
        Some(r)
    } else {
        None
    }
}

/// Compute lag-1 autocorrelation of a score series.
/// Returns `None` if fewer than 4 points (matching v1 behavior).
pub fn autocorrelation_lag1(scores: &[f64]) -> Option<f64> {
    if scores.len() < 4 {
        return None;
    }
    let n = scores.len();
    let current = &scores[..n - 1];
    let lagged = &scores[1..];
    pearson_correlation(current, lagged)
}

/// Count direction changes (sign reversals in consecutive deltas).
/// Uses a significance threshold of 0.001 to filter noise.
pub fn count_direction_changes(scores: &[f64]) -> usize {
    let threshold = 0.001;
    let mut changes = 0;
    for i in 2..scores.len() {
        let d_prev = scores[i - 1] - scores[i - 2];
        let d_curr = scores[i] - scores[i - 1];
        if (d_curr > threshold && d_prev < -threshold)
            || (d_curr < -threshold && d_prev > threshold)
        {
            changes += 1;
        }
    }
    changes
}

/// Compute trajectory quality from a window of goal scores.
///
/// Port of v1 convergenceTracker.ts lines 256-285.
pub fn compute_trajectory_quality(scores: &[f64], config: &TrajectoryConfig) -> TrajectoryResult {
    if scores.len() < 2 {
        return TrajectoryResult {
            quality: 1.0,
            oscillation_detected: false,
            autocorrelation_lag1: None,
            direction_changes: 0,
        };
    }

    let dir_changes = count_direction_changes(scores);
    let autocorr = autocorrelation_lag1(scores);

    let oscillation_detected = dir_changes >= 2
        || autocorr
            .map(|a| a < config.autocorr_threshold)
            .unwrap_or(false);

    let mut quality =
        1.0 - config.direction_penalty * dir_changes.min(config.max_directions) as f64;

    if oscillation_detected {
        if let Some(a) = autocorr {
            if a < config.autocorr_threshold {
                quality = quality.min(config.oscillation_cap);
            }
        }
    }

    // Spike-and-drop detection
    if scores.len() >= 3 {
        let max_score = scores.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let last_score = scores[scores.len() - 1];
        if max_score - last_score > 0.05 {
            quality = quality.min(config.spike_drop_cap);
        }
    }

    quality = quality.clamp(0.0, 1.0);

    TrajectoryResult {
        quality,
        oscillation_detected,
        autocorrelation_lag1: autocorr,
        direction_changes: dir_changes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pearson_perfect_positive_correlation() {
        let x = [1.0, 2.0, 3.0, 4.0, 5.0];
        let y = [2.0, 4.0, 6.0, 8.0, 10.0];
        let r = pearson_correlation(&x, &y).unwrap();
        assert!((r - 1.0).abs() < 1e-10);
    }

    #[test]
    fn pearson_perfect_negative_correlation() {
        let x = [1.0, 2.0, 3.0, 4.0, 5.0];
        let y = [10.0, 8.0, 6.0, 4.0, 2.0];
        let r = pearson_correlation(&x, &y).unwrap();
        assert!((r - (-1.0)).abs() < 1e-10);
    }

    #[test]
    fn pearson_returns_none_for_constant() {
        let x = [5.0, 5.0, 5.0, 5.0];
        let y = [1.0, 2.0, 3.0, 4.0];
        assert!(pearson_correlation(&x, &y).is_none());
    }

    #[test]
    fn pearson_returns_none_for_too_few() {
        assert!(pearson_correlation(&[1.0], &[2.0]).is_none());
    }

    #[test]
    fn autocorrelation_returns_none_for_few_points() {
        assert!(autocorrelation_lag1(&[0.5, 0.6, 0.7]).is_none());
    }

    #[test]
    fn autocorrelation_returns_value_for_sufficient_points() {
        let scores = [0.5, 0.6, 0.7, 0.8, 0.9];
        assert!(autocorrelation_lag1(&scores).is_some());
    }

    #[test]
    fn no_oscillation_for_monotonic() {
        let scores: Vec<f64> = (0..6).map(|i| 0.5 + i as f64 * 0.08).collect();
        let result = compute_trajectory_quality(&scores, &TrajectoryConfig::default());
        assert!(!result.oscillation_detected);
        assert!(result.quality >= 0.8);
    }

    #[test]
    fn detects_oscillation() {
        let scores = [0.70, 0.75, 0.72, 0.76, 0.73];
        let result = compute_trajectory_quality(&scores, &TrajectoryConfig::default());
        assert!(result.oscillation_detected);
        assert!(result.quality < 1.0);
    }

    #[test]
    fn spike_and_drop_caps_quality() {
        let scores = [0.70, 0.80, 0.95, 0.72]; // spike then drop
        let result = compute_trajectory_quality(&scores, &TrajectoryConfig::default());
        assert!(result.quality <= 0.85);
    }
}
