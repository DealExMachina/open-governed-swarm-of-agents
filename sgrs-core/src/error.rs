use thiserror::Error;

/// Typed errors for the governance kernel.
/// No panics, no silent degradation — every failure is explicit.
#[derive(Debug, Error)]
pub enum KernelError {
    #[error("invalid governance config: {0}")]
    ConfigError(String),

    #[error("unknown state: {0}")]
    UnknownState(String),

    #[error("invalid numeric input: {field} = {value}")]
    InvalidNumeric { field: String, value: f64 },

    #[error("epoch mismatch: proposal epoch {proposal} < current {current}")]
    StaleEpoch { proposal: u64, current: u64 },

    // --- Causal contribution layer ---
    #[error("missing parent: contribution {child} references unknown parent {parent}")]
    MissingParent { child: String, parent: String },

    #[error("cycle detected: inserting contribution {contribution} would create a cycle")]
    CycleDetected { contribution: String },

    #[error("hash mismatch: expected {expected}, got {actual}")]
    HashMismatch { expected: String, actual: String },

    #[error("serialization error: {0}")]
    SerializationError(String),
}
