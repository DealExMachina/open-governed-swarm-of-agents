use serde::{Deserialize, Serialize};
use std::fmt;

use crate::error::KernelError;

/// Content-addressed identifier: SHA-256 of CBOR-canonical(sorted_parents, payload, kind).
///
/// Two contributions with identical parents, payload, and kind always produce
/// the same `ContributionId`, regardless of metadata or insertion order.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ContributionId(pub [u8; 32]);

impl ContributionId {
    /// Decode from a 64-character hex string.
    pub fn from_hex(s: &str) -> Result<Self, KernelError> {
        if s.len() != 64 {
            return Err(KernelError::SerializationError(format!(
                "hex string must be 64 chars, got {}",
                s.len()
            )));
        }
        let mut bytes = [0u8; 32];
        for i in 0..32 {
            bytes[i] = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).map_err(|e| {
                KernelError::SerializationError(format!("invalid hex at position {}: {}", i * 2, e))
            })?;
        }
        Ok(ContributionId(bytes))
    }

    /// Encode as a 64-character lowercase hex string.
    pub fn to_hex(&self) -> String {
        self.0.iter().map(|b| format!("{:02x}", b)).collect()
    }
}

impl fmt::Display for ContributionId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_hex())
    }
}

/// Kind tag for a contribution in the causal DAG.
///
/// Maps to the paper's definition: k in {claim, contradiction, resolution, assessment, goal, evidence}.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ContributionKind {
    Claim,
    Contradiction,
    Resolution,
    Assessment,
    Goal,
    Evidence,
}

impl ContributionKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Claim => "claim",
            Self::Contradiction => "contradiction",
            Self::Resolution => "resolution",
            Self::Assessment => "assessment",
            Self::Goal => "goal",
            Self::Evidence => "evidence",
        }
    }

    pub fn from_str(s: &str) -> Result<Self, KernelError> {
        match s {
            "claim" => Ok(Self::Claim),
            "contradiction" => Ok(Self::Contradiction),
            "resolution" => Ok(Self::Resolution),
            "assessment" => Ok(Self::Assessment),
            "goal" => Ok(Self::Goal),
            "evidence" => Ok(Self::Evidence),
            _ => Err(KernelError::ConfigError(format!(
                "unknown contribution kind: {}",
                s
            ))),
        }
    }
}

impl fmt::Display for ContributionKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Substantive content of a contribution.
///
/// Stored as arbitrary JSON to support heterogeneous payloads across
/// different contribution kinds.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContributionPayload {
    pub content: serde_json::Value,
}

impl PartialEq for ContributionPayload {
    fn eq(&self, other: &Self) -> bool {
        self.content == other.content
    }
}

impl Eq for ContributionPayload {}

/// Metadata associated with a contribution.
///
/// Metadata is *not* included in the content hash — only (parents, payload, kind) determine
/// the content-addressed identifier. This allows the same logical contribution to carry
/// different metadata in different contexts without affecting identity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContributionMetadata {
    pub role_id: String,
    pub authority_tier: u8,
    pub governance_mode: String,
    pub valid_from: Option<i64>,
    pub valid_to: Option<i64>,
    pub transaction_time: i64,
}

/// A contribution in the causal DAG.
///
/// Definition 1 from the paper: delta = (rid, parents, payload, k, m) where
/// - rid = H(CBOR-canonical(sorted(parents), payload, k))
/// - parents subset of existing contribution IDs
/// - payload = substantive content
/// - k = kind tag
/// - m = metadata (not included in hash)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contribution {
    pub rid: ContributionId,
    pub parents: Vec<ContributionId>,
    pub payload: ContributionPayload,
    pub kind: ContributionKind,
    pub metadata: ContributionMetadata,
}
