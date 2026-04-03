pub mod contradiction;
pub mod disagreement;
pub mod dynamics;
pub mod evidence_state;
pub mod gossip;
pub mod iss;
pub mod laplacian;
pub mod projection;
pub mod sheaf;
pub mod tarski;
pub mod topology;

#[cfg(test)]
mod tests;

pub use contradiction::{
    contradiction_count, extract_contradictions, ContradictionChannel, DetectedContradiction,
};
pub use disagreement::{compute_disagreement, per_dimension_disagreement};
pub use dynamics::{
    propagation_step, propagation_step_with_elimination, HybridStepResult, PropagationStepResult,
};
pub use evidence_state::{EvidenceState, EvidenceVector};
pub use iss::{analyze_iss, ISSAnalysis};
pub use laplacian::{spectral_analysis, SpectralAnalysis};
pub use projection::{AdmissibleProjection, Projected};
pub use sheaf::{CellularSheaf, RestrictionMap};
pub use gossip::{gossip_converge, gossip_round, gossip_spanning_tree_round, gossip_average_converge, gossip_average_round, push_sum_converge, push_sum_round, GossipRoundResult, PushSumState};
pub use tarski::{tarski_converge, tarski_step, TarskiStepResult};
