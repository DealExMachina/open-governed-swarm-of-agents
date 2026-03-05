use crate::types::DimensionId;

use super::trajectory::{compute_trajectory_quality, TrajectoryConfig};

/// A single convergence history point (input from TS layer).
#[derive(Debug, Clone)]
pub struct ConvergencePointInput {
    pub epoch: u64,
    pub goal_score: f64,
    pub lyapunov_v: f64,
    /// Indexed by DimensionId: [claim, contra, goal, risk].
    pub dimension_scores: [f64; 4],
    /// Indexed by DimensionId: [claim, contra, goal, risk].
    pub pressure: [f64; 4],
    /// Context sequence for epoch partitioning. None = unknown.
    pub context_seq: Option<u64>,
}

/// Configuration for convergence analysis.
#[derive(Debug, Clone)]
pub struct ConvergenceConfig {
    /// Monotonicity window: require non-decreasing for this many rounds (default 3).
    pub beta: usize,
    /// Plateau detection window: consecutive rounds below threshold (default 3).
    pub tau: usize,
    /// EMA smoothing factor for progress ratio (default 0.3).
    pub ema_alpha: f64,
    /// Progress ratio below which counts as plateau (default 0.01).
    pub plateau_threshold: f64,
    /// Convergence rate below this triggers divergence alert (default -0.05).
    pub divergence_rate: f64,
    /// Number of history points to consider (default 20).
    pub history_depth: usize,
    /// Trajectory quality: penalty per direction change (default 0.12).
    pub q_direction_penalty: f64,
    /// Trajectory quality: max direction changes before capping (default 5).
    pub q_max_directions: usize,
    /// Trajectory quality: autocorrelation threshold for oscillation (default -0.3).
    pub q_autocorr_threshold: f64,
    /// Trajectory quality: cap when oscillation detected (default 0.65).
    pub q_oscillation_cap: f64,
    /// Trajectory quality: cap on spike-and-drop (default 0.85).
    pub q_spike_drop_cap: f64,
}

impl Default for ConvergenceConfig {
    fn default() -> Self {
        Self {
            beta: 3,
            tau: 3,
            ema_alpha: 0.3,
            plateau_threshold: 0.01,
            divergence_rate: -0.05,
            history_depth: 20,
            q_direction_penalty: 0.12,
            q_max_directions: 5,
            q_autocorr_threshold: -0.3,
            q_oscillation_cap: 0.65,
            q_spike_drop_cap: 0.85,
        }
    }
}

/// Result of convergence analysis.
#[derive(Debug, Clone)]
pub struct ConvergenceAnalysis {
    /// Mixed convergence rate α: >0 converging, <0 diverging, 0 stalled.
    pub convergence_rate: f64,
    /// Intra-epoch α: rate within same context_seq.
    pub alpha_intra: f64,
    /// Number of evidence injection boundaries.
    pub cross_epoch_count: usize,
    /// Average V(t) delta at evidence boundaries.
    pub cross_epoch_v_delta_avg: f64,
    /// Dimensions with no improvement in last 5 evals.
    pub stalled_dimensions: Vec<DimensionId>,
    /// Estimated rounds to reach V < epsilon. None if not converging.
    pub estimated_rounds: Option<u32>,
    /// Goal score non-decreasing for β consecutive rounds.
    pub is_monotonic: bool,
    /// MACI progress ratio below threshold for τ rounds.
    pub is_plateaued: bool,
    /// Number of consecutive plateau rounds.
    pub plateau_rounds: u32,
    /// Dimension with highest pressure.
    pub highest_pressure_dimension: DimensionId,
    /// Gate C: oscillation detected.
    pub oscillation_detected: bool,
    /// Gate C: trajectory quality [0, 1].
    pub trajectory_quality: f64,
    /// Gate C: lag-1 autocorrelation of goal_score.
    pub autocorrelation_lag1: Option<f64>,

    // --- Per-dimension gates (Issue #18: non-scalar finality) ---

    /// GA_d: per-dimension monotonicity over last β rounds.
    /// Indexed by DimensionId: [claim, contra, goal, risk].
    pub per_dimension_monotonic: [bool; 4],
    /// GC_d: per-dimension trajectory quality [0, 1].
    /// Indexed by DimensionId: [claim, contra, goal, risk].
    pub per_dimension_trajectory_quality: [f64; 4],
}

/// Analyze convergence from history points. Pure function.
///
/// Input: history sorted oldest-first (ascending epoch).
///
/// Direct port of v1 `analyzeConvergence` (convergenceTracker.ts lines 207-411).
pub fn analyze_convergence(
    history: &[ConvergencePointInput],
    config: &ConvergenceConfig,
    auto_threshold: f64,
) -> ConvergenceAnalysis {
    let default = ConvergenceAnalysis {
        convergence_rate: 0.0,
        alpha_intra: 0.0,
        cross_epoch_count: 0,
        cross_epoch_v_delta_avg: 0.0,
        stalled_dimensions: Vec::new(),
        estimated_rounds: None,
        is_monotonic: false,
        is_plateaued: false,
        plateau_rounds: 0,
        highest_pressure_dimension: DimensionId::ClaimConfidence,
        oscillation_detected: false,
        trajectory_quality: 1.0,
        autocorrelation_lag1: None,
        per_dimension_monotonic: [false; 4],
        per_dimension_trajectory_quality: [1.0; 4],
    };

    if history.is_empty() {
        return default;
    }

    let latest = &history[history.len() - 1];

    // --- Highest pressure dimension ---
    let highest_dim = find_highest_pressure(&latest.pressure);

    if history.len() == 1 {
        return ConvergenceAnalysis {
            highest_pressure_dimension: highest_dim,
            ..default
        };
    }

    // --- Gate C: oscillation and trajectory quality ---
    let window_size = history.len().min(10);
    let scores: Vec<f64> = history[history.len() - window_size..]
        .iter()
        .map(|p| p.goal_score)
        .collect();

    let traj_config = TrajectoryConfig {
        direction_penalty: config.q_direction_penalty,
        max_directions: config.q_max_directions,
        autocorr_threshold: config.q_autocorr_threshold,
        oscillation_cap: config.q_oscillation_cap,
        spike_drop_cap: config.q_spike_drop_cap,
    };
    let traj = compute_trajectory_quality(&scores, &traj_config);

    // --- Convergence rate: partitioned into intra-epoch and cross-epoch ---
    let recent_count = history.len().min(5);
    let start = history.len() - recent_count;

    let mut alphas_all: Vec<f64> = Vec::new();
    let mut alphas_intra: Vec<f64> = Vec::new();
    let mut cross_epoch_deltas: Vec<f64> = Vec::new();

    for i in start..history.len() {
        if i == 0 {
            continue;
        }
        let v_prev = history[i - 1].lyapunov_v;
        let v_curr = history[i].lyapunov_v;

        if v_prev > 1e-10 {
            let ratio = (v_curr / v_prev).max(1e-10);
            let alpha = -ratio.ln();
            alphas_all.push(alpha);

            let seq_prev = history[i - 1].context_seq;
            let seq_curr = history[i].context_seq;
            let same_context = match (seq_prev, seq_curr) {
                (Some(a), Some(b)) => a == b,
                _ => true, // treat unknown as same context (v1 behavior)
            };

            if same_context {
                alphas_intra.push(alpha);
            } else {
                cross_epoch_deltas.push(v_curr - v_prev);
            }
        }
    }

    let avg_alpha = if alphas_all.is_empty() {
        0.0
    } else {
        alphas_all.iter().sum::<f64>() / alphas_all.len() as f64
    };

    let alpha_intra = if alphas_intra.is_empty() {
        0.0
    } else {
        alphas_intra.iter().sum::<f64>() / alphas_intra.len() as f64
    };

    let cross_epoch_count = cross_epoch_deltas.len();
    let cross_epoch_v_delta_avg = if cross_epoch_count == 0 {
        0.0
    } else {
        cross_epoch_deltas.iter().sum::<f64>() / cross_epoch_count as f64
    };

    // --- Stalled dimensions ---
    let stalled = find_stalled_dimensions(history);

    // --- Estimated rounds to auto-threshold ---
    let current_v = latest.lyapunov_v;
    let v_epsilon = 0.005;
    let estimated_rounds = if alpha_intra > 0.001 && current_v > v_epsilon {
        let rounds = (-((v_epsilon / current_v).ln()) / alpha_intra).ceil() as u32;
        if rounds > 1000 {
            None
        } else {
            Some(rounds)
        }
    } else if current_v <= v_epsilon {
        Some(0)
    } else {
        None
    };

    // --- Monotonicity gate: score non-decreasing for β consecutive rounds ---
    let is_monotonic = check_monotonicity(history, config.beta);

    // --- Plateau detection: EMA of progress ratio ---
    let plateau_rounds = compute_plateau_rounds(history, auto_threshold, config);
    let is_plateaued = plateau_rounds >= config.tau as u32;

    // --- Per-dimension gates (Issue #18: non-scalar finality) ---
    let per_dimension_monotonic = check_per_dimension_monotonicity(history, config.beta);
    let per_dimension_trajectory_quality =
        compute_per_dimension_trajectory_quality(history, &traj_config);

    ConvergenceAnalysis {
        convergence_rate: avg_alpha,
        alpha_intra,
        cross_epoch_count,
        cross_epoch_v_delta_avg,
        stalled_dimensions: stalled,
        estimated_rounds,
        is_monotonic,
        is_plateaued,
        plateau_rounds,
        highest_pressure_dimension: highest_dim,
        oscillation_detected: traj.oscillation_detected,
        trajectory_quality: traj.quality,
        autocorrelation_lag1: traj.autocorrelation_lag1,
        per_dimension_monotonic,
        per_dimension_trajectory_quality,
    }
}

/// Find the dimension with the highest pressure value.
fn find_highest_pressure(pressure: &[f64; 4]) -> DimensionId {
    let mut max_p = f64::NEG_INFINITY;
    let mut max_dim = DimensionId::ClaimConfidence;
    for dim in DimensionId::ALL {
        let p = pressure[dim.index()];
        if p > max_p {
            max_p = p;
            max_dim = dim;
        }
    }
    max_dim
}

/// Find dimensions with no intra-epoch improvement in the last 5 evaluations.
fn find_stalled_dimensions(history: &[ConvergencePointInput]) -> Vec<DimensionId> {
    if history.len() < 2 {
        return Vec::new();
    }

    let recent_start = if history.len() > 5 {
        history.len() - 5
    } else {
        0
    };
    let recent = &history[recent_start..];

    let mut stalled = Vec::new();
    for dim in DimensionId::ALL {
        let idx = dim.index();
        let vals: Vec<f64> = recent.iter().map(|p| p.dimension_scores[idx]).collect();
        let improved = vals
            .windows(2)
            .any(|w| w[1] > w[0] + 0.001);
        if !improved && vals.len() >= 2 {
            stalled.push(dim);
        }
    }
    stalled
}

/// Check goal_score monotonicity over the last β rounds.
/// True if goal_score is non-decreasing (with epsilon tolerance) for β consecutive rounds.
fn check_monotonicity(history: &[ConvergencePointInput], beta: usize) -> bool {
    if history.len() < beta {
        return false;
    }
    let window = &history[history.len() - beta..];
    for i in 1..window.len() {
        if window[i].goal_score < window[i - 1].goal_score - 0.001 {
            return false;
        }
    }
    true
}

/// Compute consecutive plateau rounds using EMA of progress ratio.
fn compute_plateau_rounds(
    history: &[ConvergencePointInput],
    auto_threshold: f64,
    config: &ConvergenceConfig,
) -> u32 {
    if history.len() < 2 {
        return 0;
    }

    let mut ema = 0.0;
    let mut consecutive = 0u32;

    for i in 1..history.len() {
        let delta = (history[i].goal_score - history[i - 1].goal_score).max(0.0);
        let remaining_gap = (auto_threshold - history[i].goal_score).max(0.001);
        let progress_ratio = delta / remaining_gap;

        ema = config.ema_alpha * progress_ratio + (1.0 - config.ema_alpha) * ema;

        if ema < config.plateau_threshold {
            consecutive += 1;
        } else {
            consecutive = 0;
        }
    }

    consecutive
}

// ---------------------------------------------------------------------------
// Per-dimension gates (Issue #18: non-scalar finality)
// ---------------------------------------------------------------------------

/// GA_d: check per-dimension monotonicity over the last β rounds.
/// Returns [bool; 4] indexed by DimensionId.
/// A dimension is monotonic if its score is non-decreasing (epsilon=0.001)
/// for β consecutive rounds.
fn check_per_dimension_monotonicity(
    history: &[ConvergencePointInput],
    beta: usize,
) -> [bool; 4] {
    let mut result = [false; 4];
    if history.len() < beta {
        return result;
    }
    let window = &history[history.len() - beta..];
    for dim in DimensionId::ALL {
        let idx = dim.index();
        let monotonic = window
            .windows(2)
            .all(|w| w[1].dimension_scores[idx] >= w[0].dimension_scores[idx] - 0.001);
        result[idx] = monotonic;
    }
    result
}

/// GC_d: compute per-dimension trajectory quality.
/// Returns [f64; 4] indexed by DimensionId.
/// Uses the same trajectory quality algorithm as the scalar version but
/// applied to each dimension's score history independently.
fn compute_per_dimension_trajectory_quality(
    history: &[ConvergencePointInput],
    traj_config: &TrajectoryConfig,
) -> [f64; 4] {
    let mut result = [1.0; 4];
    let window_size = history.len().min(10);
    if window_size < 2 {
        return result;
    }
    let window = &history[history.len() - window_size..];
    for dim in DimensionId::ALL {
        let idx = dim.index();
        let dim_scores: Vec<f64> = window.iter().map(|p| p.dimension_scores[idx]).collect();
        let traj = compute_trajectory_quality(&dim_scores, traj_config);
        result[idx] = traj.quality;
    }
    result
}
