use super::analyze::*;
use crate::types::DimensionId;

// ---------------------------------------------------------------------------
// Test helpers — mirror the TS makeSnapshot, makePoint, makeImprovingHistory
// ---------------------------------------------------------------------------

fn make_point(overrides: PartialPoint) -> ConvergencePointInput {
    ConvergencePointInput {
        epoch: overrides.epoch.unwrap_or(1),
        goal_score: overrides.goal_score.unwrap_or(0.5),
        lyapunov_v: overrides.lyapunov_v.unwrap_or(0.1),
        dimension_scores: overrides.dimension_scores.unwrap_or([0.5, 0.5, 0.5, 0.5]),
        pressure: overrides.pressure.unwrap_or([0.15, 0.15, 0.125, 0.075]),
        context_seq: overrides.context_seq.unwrap_or(None),
    }
}

#[derive(Default)]
struct PartialPoint {
    epoch: Option<u64>,
    goal_score: Option<f64>,
    lyapunov_v: Option<f64>,
    dimension_scores: Option<[f64; 4]>,
    pressure: Option<[f64; 4]>,
    context_seq: Option<Option<u64>>,
}

impl ConvergencePointInput {
    fn with_context_seq(mut self, seq: Option<u64>) -> Self {
        self.context_seq = seq;
        self
    }
}

fn make_improving_history(
    n: usize,
    start_score: f64,
    end_score: f64,
) -> Vec<ConvergencePointInput> {
    let mut points = Vec::with_capacity(n);
    for i in 0..n {
        let t = if n == 1 {
            1.0
        } else {
            i as f64 / (n - 1) as f64
        };
        let score = start_score + t * (end_score - start_score);
        let v = ((1.0 - score).powi(2) * 0.3).max(0.001);
        let gap = (1.0 - score).max(0.0);
        points.push(ConvergencePointInput {
            epoch: (i + 1) as u64,
            goal_score: score,
            lyapunov_v: v,
            dimension_scores: [score, score, score, score],
            pressure: [0.3 * gap, 0.3 * gap, 0.25 * gap, 0.15 * gap],
            context_seq: None,
        });
    }
    points
}

// ---------------------------------------------------------------------------
// analyzeConvergence — ported from convergenceTracker.test.ts
// ---------------------------------------------------------------------------

#[test]
fn empty_history_returns_safe_defaults() {
    let state = analyze_convergence(&[], &ConvergenceConfig::default(), 0.92);
    assert_eq!(state.convergence_rate, 0.0);
    assert!(state.estimated_rounds.is_none());
    assert!(!state.is_monotonic);
    assert!(!state.is_plateaued);
    assert_eq!(state.plateau_rounds, 0);
}

#[test]
fn single_point_returns_safe_defaults() {
    let points = [make_point(PartialPoint {
        pressure: Some([0.2, 0.1, 0.0, 0.0]),
        ..Default::default()
    })];
    let state = analyze_convergence(&points, &ConvergenceConfig::default(), 0.92);
    assert_eq!(state.convergence_rate, 0.0);
    assert!(state.estimated_rounds.is_none());
    assert!(!state.is_monotonic);
    assert!(!state.is_plateaued);
    assert_eq!(
        state.highest_pressure_dimension,
        DimensionId::ClaimConfidence
    );
}

// --- Monotonicity ---

#[test]
fn detects_monotonically_improving_history() {
    let history = make_improving_history(5, 0.5, 0.9);
    let config = ConvergenceConfig {
        beta: 3,
        ..Default::default()
    };
    let state = analyze_convergence(&history, &config, 0.92);
    assert!(state.is_monotonic);
}

#[test]
fn detects_non_monotonic_when_score_drops() {
    let mut history = make_improving_history(4, 0.5, 0.8);
    history[3] = make_point(PartialPoint {
        epoch: Some(4),
        goal_score: Some(0.6),
        lyapunov_v: Some(0.05),
        ..Default::default()
    });
    let config = ConvergenceConfig {
        beta: 3,
        ..Default::default()
    };
    let state = analyze_convergence(&history, &config, 0.92);
    assert!(!state.is_monotonic);
}

#[test]
fn requires_at_least_beta_points_for_monotonicity() {
    let history = make_improving_history(2, 0.5, 0.7);
    let config = ConvergenceConfig {
        beta: 3,
        ..Default::default()
    };
    let state = analyze_convergence(&history, &config, 0.92);
    assert!(!state.is_monotonic);
}

#[test]
fn allows_tiny_epsilon_tolerance() {
    let history = [
        make_point(PartialPoint {
            epoch: Some(1),
            goal_score: Some(0.80),
            lyapunov_v: Some(0.05),
            ..Default::default()
        }),
        make_point(PartialPoint {
            epoch: Some(2),
            goal_score: Some(0.7995), // drop of 0.0005 < epsilon
            lyapunov_v: Some(0.049),
            ..Default::default()
        }),
        make_point(PartialPoint {
            epoch: Some(3),
            goal_score: Some(0.80),
            lyapunov_v: Some(0.048),
            ..Default::default()
        }),
    ];
    let config = ConvergenceConfig {
        beta: 3,
        ..Default::default()
    };
    let state = analyze_convergence(&history, &config, 0.92);
    assert!(state.is_monotonic);
}

// --- Plateau detection ---

#[test]
fn detects_plateau_when_score_barely_changes() {
    let mut history = Vec::new();
    for i in 0..8 {
        let score = 0.70 + if i % 2 == 0 { 0.001 } else { -0.001 };
        history.push(make_point(PartialPoint {
            epoch: Some(i + 1),
            goal_score: Some(score),
            lyapunov_v: Some((1.0 - score).powi(2) * 0.3),
            ..Default::default()
        }));
    }
    let config = ConvergenceConfig {
        tau: 3,
        ..Default::default()
    };
    let state = analyze_convergence(&history, &config, 0.92);
    assert!(state.is_plateaued);
    assert!(state.plateau_rounds >= 3);
}

#[test]
fn does_not_false_plateau_during_fast_convergence() {
    let history = make_improving_history(5, 0.5, 0.9);
    let config = ConvergenceConfig {
        tau: 3,
        ..Default::default()
    };
    let state = analyze_convergence(&history, &config, 0.92);
    assert!(!state.is_plateaued);
}

#[test]
fn does_not_plateau_with_insufficient_history() {
    let history = [
        make_point(PartialPoint {
            epoch: Some(1),
            goal_score: Some(0.70),
            lyapunov_v: Some(0.03),
            ..Default::default()
        }),
        make_point(PartialPoint {
            epoch: Some(2),
            goal_score: Some(0.70),
            lyapunov_v: Some(0.03),
            ..Default::default()
        }),
    ];
    let config = ConvergenceConfig {
        tau: 3,
        ..Default::default()
    };
    let state = analyze_convergence(&history, &config, 0.92);
    // Only 1 delta (2 points), can't reach tau=3
    assert!(!state.is_plateaued);
}

// --- Convergence rate ---

#[test]
fn positive_rate_when_v_decreasing() {
    let history = [
        make_point(PartialPoint {
            epoch: Some(1),
            goal_score: Some(0.5),
            lyapunov_v: Some(0.10),
            ..Default::default()
        }),
        make_point(PartialPoint {
            epoch: Some(2),
            goal_score: Some(0.6),
            lyapunov_v: Some(0.07),
            ..Default::default()
        }),
        make_point(PartialPoint {
            epoch: Some(3),
            goal_score: Some(0.7),
            lyapunov_v: Some(0.04),
            ..Default::default()
        }),
    ];
    let state = analyze_convergence(&history, &ConvergenceConfig::default(), 0.92);
    assert!(state.convergence_rate > 0.0);
}

#[test]
fn negative_rate_when_v_increasing() {
    let history = [
        make_point(PartialPoint {
            epoch: Some(1),
            goal_score: Some(0.7),
            lyapunov_v: Some(0.03),
            ..Default::default()
        }),
        make_point(PartialPoint {
            epoch: Some(2),
            goal_score: Some(0.6),
            lyapunov_v: Some(0.06),
            ..Default::default()
        }),
        make_point(PartialPoint {
            epoch: Some(3),
            goal_score: Some(0.5),
            lyapunov_v: Some(0.10),
            ..Default::default()
        }),
    ];
    let state = analyze_convergence(&history, &ConvergenceConfig::default(), 0.92);
    assert!(state.convergence_rate < 0.0);
}

#[test]
fn provides_finite_estimated_rounds_when_converging() {
    let history = make_improving_history(6, 0.3, 0.8);
    let state = analyze_convergence(&history, &ConvergenceConfig::default(), 0.92);
    assert!(state.estimated_rounds.is_some());
    let rounds = state.estimated_rounds.unwrap();
    assert!(rounds > 0);
    assert!(rounds < 1000);
}

#[test]
fn null_estimated_rounds_when_diverging() {
    let history = [
        make_point(PartialPoint {
            epoch: Some(1),
            goal_score: Some(0.7),
            lyapunov_v: Some(0.03),
            ..Default::default()
        }),
        make_point(PartialPoint {
            epoch: Some(2),
            goal_score: Some(0.6),
            lyapunov_v: Some(0.06),
            ..Default::default()
        }),
        make_point(PartialPoint {
            epoch: Some(3),
            goal_score: Some(0.5),
            lyapunov_v: Some(0.10),
            ..Default::default()
        }),
    ];
    let state = analyze_convergence(&history, &ConvergenceConfig::default(), 0.92);
    assert!(state.estimated_rounds.is_none());
}

#[test]
fn zero_estimated_rounds_when_v_near_zero() {
    let history = [
        make_point(PartialPoint {
            epoch: Some(1),
            goal_score: Some(0.95),
            lyapunov_v: Some(0.003),
            ..Default::default()
        }),
        make_point(PartialPoint {
            epoch: Some(2),
            goal_score: Some(0.96),
            lyapunov_v: Some(0.002),
            ..Default::default()
        }),
    ];
    let state = analyze_convergence(&history, &ConvergenceConfig::default(), 0.92);
    assert_eq!(state.estimated_rounds, Some(0));
}

// --- Highest pressure dimension ---

#[test]
fn identifies_highest_pressure_dimension() {
    let points = [make_point(PartialPoint {
        pressure: Some([0.05, 0.20, 0.10, 0.02]),
        ..Default::default()
    })];
    let state = analyze_convergence(&points, &ConvergenceConfig::default(), 0.92);
    assert_eq!(
        state.highest_pressure_dimension,
        DimensionId::ContradictionResolution
    );
}

// --- Spike-and-drop ---

#[test]
fn monotonicity_gate_blocks_after_score_drop() {
    let history = [
        make_point(PartialPoint {
            epoch: Some(1),
            goal_score: Some(0.70),
            lyapunov_v: Some(0.03),
            ..Default::default()
        }),
        make_point(PartialPoint {
            epoch: Some(2),
            goal_score: Some(0.80),
            lyapunov_v: Some(0.02),
            ..Default::default()
        }),
        make_point(PartialPoint {
            epoch: Some(3),
            goal_score: Some(0.95),
            lyapunov_v: Some(0.001),
            ..Default::default()
        }),
        make_point(PartialPoint {
            epoch: Some(4),
            goal_score: Some(0.72),
            lyapunov_v: Some(0.025),
            ..Default::default()
        }),
    ];
    let config = ConvergenceConfig {
        beta: 3,
        ..Default::default()
    };
    let state = analyze_convergence(&history, &config, 0.92);
    assert!(!state.is_monotonic);
}

// --- Gate C: oscillation and trajectory quality ---

#[test]
fn no_oscillation_for_monotonic_history() {
    let history = make_improving_history(6, 0.5, 0.9);
    let state = analyze_convergence(&history, &ConvergenceConfig::default(), 0.92);
    assert!(!state.oscillation_detected);
    assert!(state.trajectory_quality >= 0.8);
    assert!(state.autocorrelation_lag1.is_some());
}

#[test]
fn detects_oscillation_with_direction_changes() {
    let history = [
        make_point(PartialPoint {
            epoch: Some(1),
            goal_score: Some(0.70),
            ..Default::default()
        }),
        make_point(PartialPoint {
            epoch: Some(2),
            goal_score: Some(0.75),
            ..Default::default()
        }),
        make_point(PartialPoint {
            epoch: Some(3),
            goal_score: Some(0.72),
            ..Default::default()
        }),
        make_point(PartialPoint {
            epoch: Some(4),
            goal_score: Some(0.76),
            ..Default::default()
        }),
        make_point(PartialPoint {
            epoch: Some(5),
            goal_score: Some(0.73),
            ..Default::default()
        }),
    ];
    let state = analyze_convergence(&history, &ConvergenceConfig::default(), 0.92);
    assert!(state.oscillation_detected);
    assert!(state.trajectory_quality < 1.0);
}

#[test]
fn autocorrelation_null_for_fewer_than_4_points() {
    let history = make_improving_history(3, 0.5, 0.7);
    let state = analyze_convergence(&history, &ConvergenceConfig::default(), 0.92);
    assert!(state.autocorrelation_lag1.is_none());
}

// --- Intra/cross-epoch partitioning ---

#[test]
fn computes_alpha_intra_from_same_context_seq() {
    let history = [
        make_point(PartialPoint {
            epoch: Some(1),
            lyapunov_v: Some(0.5),
            goal_score: Some(0.5),
            ..Default::default()
        })
        .with_context_seq(Some(1)),
        make_point(PartialPoint {
            epoch: Some(2),
            lyapunov_v: Some(0.4),
            goal_score: Some(0.55),
            ..Default::default()
        })
        .with_context_seq(Some(1)),
        make_point(PartialPoint {
            epoch: Some(3),
            lyapunov_v: Some(0.8),
            goal_score: Some(0.3),
            ..Default::default()
        })
        .with_context_seq(Some(2)),
        make_point(PartialPoint {
            epoch: Some(4),
            lyapunov_v: Some(0.7),
            goal_score: Some(0.35),
            ..Default::default()
        })
        .with_context_seq(Some(2)),
        make_point(PartialPoint {
            epoch: Some(5),
            lyapunov_v: Some(0.6),
            goal_score: Some(0.4),
            ..Default::default()
        })
        .with_context_seq(Some(2)),
    ];
    let state = analyze_convergence(&history, &ConvergenceConfig::default(), 0.92);
    assert!(state.alpha_intra > 0.0);
    assert_eq!(state.cross_epoch_count, 1);
    assert!(state.cross_epoch_v_delta_avg > 0.0);
}

#[test]
fn zero_cross_epoch_when_all_same_context_seq() {
    let history = [
        make_point(PartialPoint {
            epoch: Some(1),
            lyapunov_v: Some(0.5),
            goal_score: Some(0.5),
            ..Default::default()
        })
        .with_context_seq(Some(1)),
        make_point(PartialPoint {
            epoch: Some(2),
            lyapunov_v: Some(0.4),
            goal_score: Some(0.55),
            ..Default::default()
        })
        .with_context_seq(Some(1)),
        make_point(PartialPoint {
            epoch: Some(3),
            lyapunov_v: Some(0.3),
            goal_score: Some(0.6),
            ..Default::default()
        })
        .with_context_seq(Some(1)),
    ];
    let state = analyze_convergence(&history, &ConvergenceConfig::default(), 0.92);
    assert_eq!(state.cross_epoch_count, 0);
    assert!(state.alpha_intra > 0.0);
}

#[test]
fn detects_stalled_dimensions() {
    let mut history = Vec::new();
    for i in 0..6 {
        history.push(make_point(PartialPoint {
            epoch: Some(i + 1),
            goal_score: Some(0.5),
            lyapunov_v: Some(0.3),
            dimension_scores: Some([0.9, 0.5, 0.0, 1.0]),
            ..Default::default()
        }));
    }
    let state = analyze_convergence(&history, &ConvergenceConfig::default(), 0.92);
    assert!(state
        .stalled_dimensions
        .contains(&DimensionId::GoalCompletion));
    assert!(state
        .stalled_dimensions
        .contains(&DimensionId::ContradictionResolution));
    assert!(state.stalled_dimensions.len() >= 2);
}

#[test]
fn uses_alpha_intra_for_eta() {
    let history = [
        make_point(PartialPoint {
            epoch: Some(1),
            lyapunov_v: Some(0.5),
            goal_score: Some(0.5),
            ..Default::default()
        })
        .with_context_seq(Some(1)),
        make_point(PartialPoint {
            epoch: Some(2),
            lyapunov_v: Some(0.3),
            goal_score: Some(0.65),
            ..Default::default()
        })
        .with_context_seq(Some(1)),
        make_point(PartialPoint {
            epoch: Some(3),
            lyapunov_v: Some(0.8),
            goal_score: Some(0.3),
            ..Default::default()
        })
        .with_context_seq(Some(2)),
        make_point(PartialPoint {
            epoch: Some(4),
            lyapunov_v: Some(0.6),
            goal_score: Some(0.4),
            ..Default::default()
        })
        .with_context_seq(Some(2)),
    ];
    let state = analyze_convergence(&history, &ConvergenceConfig::default(), 0.92);
    assert!(state.alpha_intra > 0.0);
    // Mixed alpha includes cross-epoch spike, so differs from alpha_intra
    assert!((state.convergence_rate - state.alpha_intra).abs() > 1e-10);
}

// --- Combined scenario ---

#[test]
fn identifies_plateau_and_highest_pressure_simultaneously() {
    let mut history = Vec::new();
    for i in 0..6 {
        history.push(make_point(PartialPoint {
            epoch: Some(i + 1),
            goal_score: Some(0.65 + if i % 2 == 0 { 0.002 } else { -0.001 }),
            lyapunov_v: Some(0.04),
            pressure: Some([0.02, 0.18, 0.03, 0.01]),
            ..Default::default()
        }));
    }
    let config = ConvergenceConfig {
        tau: 3,
        ..Default::default()
    };
    let state = analyze_convergence(&history, &config, 0.92);
    assert!(state.is_plateaued);
    assert_eq!(
        state.highest_pressure_dimension,
        DimensionId::ContradictionResolution
    );
}
