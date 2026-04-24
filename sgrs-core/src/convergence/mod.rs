pub mod analyze;
pub mod scores;
pub mod trajectory;

// Re-export main entry points.
pub use analyze::{analyze_convergence, ConvergenceAnalysis, ConvergenceConfig, ConvergencePointInput};
pub use scores::{
    compute_dimension_scores, compute_pressure, scalar_lyapunov_v,
    gap_norm_squared, lyapunov_order_property, verify_pressure_equals_gap_weights,
    SnapshotInput,
};
pub use trajectory::{
    autocorrelation_lag1, compute_trajectory_quality, pearson_correlation, TrajectoryConfig,
    TrajectoryResult,
};

#[cfg(test)]
mod tests;
