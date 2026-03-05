pub mod conditions;
pub mod gates;
pub mod goal_score;
pub mod vector;

#[cfg(test)]
mod tests;

pub use conditions::{
    condition_to_string, evaluate_condition, parse_condition, ComparisonOp, Condition,
    FinalitySnapshotFull,
};
pub use gates::{evaluate_conditions, evaluate_gates, ConditionMode, GateConfig, GateState};
pub use goal_score::compute_goal_score;
pub use vector::{
    dimension_final, dimension_gap, evaluate_vector_finality, DimensionFinalityResult,
    VectorFinalityConfig, VectorFinalityResult,
};
