pub mod kernel;
pub mod policy;
#[cfg(test)]
mod tests;

pub use kernel::{
    evaluate_kernel, EliminationCertificate, KernelInput, KernelOutput, ReductionVerdict,
};
pub use policy::{
    can_transition, evaluate_rules, required_governance_level,
    DriftLevel, PolicyRule, TransitionDecision, TransitionRule,
};
