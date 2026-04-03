pub mod context;
pub mod galois;
pub mod lattice;

pub use context::{build_context_rows, GovernanceAttr, ThresholdConfig};
pub use galois::check_finality_on_concepts;
pub use lattice::{concept_lattice_size, concept_provenance};
