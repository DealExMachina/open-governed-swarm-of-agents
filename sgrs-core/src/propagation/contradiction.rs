use super::evidence_state::EvidenceState;

/// A detected inter-role disagreement: two roles differ on the same
/// (dimension, channel) by more than a threshold.
///
/// Despite the name, this is **not** the Belnap intra-role contradiction
/// (`s > θ ∧ r > θ` inside one role) — see
/// `EvidenceVector::belnap_contradiction_dimensions` for that. The name
/// "Contradiction" is kept because the paper's §4 Theorem 3 uses it for this
/// operator, and because renaming would be a breaking change across the
/// NAPI bridge (`extractContradictionsBridge`) and the downstream ISS
/// telemetry pipeline. The type alias `DetectedInterRoleDisagreement` is
/// provided as the semantically precise name for new code.
#[derive(Debug, Clone)]
pub struct DetectedContradiction {
    pub role_i: usize,
    pub role_j: usize,
    pub dimension: usize,
    pub channel: ContradictionChannel,
    pub magnitude: f64,
}

/// Semantically precise alias for `DetectedContradiction`. New code should
/// prefer this name; the old name is retained for NAPI / paper compatibility.
pub type DetectedInterRoleDisagreement = DetectedContradiction;

/// Which evidence channel the disagreement was detected in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContradictionChannel {
    Support,
    Refutation,
}

/// Extract inter-role disagreements exceeding a threshold.
///
/// From the paper (§4, Theorem 3):
///   Contradict(x, θ) = {(i, j, d) : |x⁺ᵢ(d) - x⁺ⱼ(d)| > θ or |x⁻ᵢ(d) - x⁻ⱼ(d)| > θ}
///
/// Returns all (role_i, role_j, dimension, channel) tuples where the
/// componentwise absolute difference between roles exceeds the threshold.
/// Only considers pairs where `i < j` (no duplicates, no self-pairs).
///
/// # What this is not
///
/// This function detects **inter-role** disagreement — pairs of distinct
/// roles disagreeing. It does not detect the Belnap-style intra-role
/// contradiction (a single role's `(s, r)` having both components above
/// threshold), which is the job of
/// `EvidenceVector::belnap_contradiction_dimensions`.
pub fn extract_contradictions(state: &EvidenceState, threshold: f64) -> Vec<DetectedContradiction> {
    let mut contradictions = Vec::new();

    for i in 0..state.num_roles {
        for j in (i + 1)..state.num_roles {
            let vi = &state.role_states[i];
            let vj = &state.role_states[j];

            for d in 0..state.num_dims {
                // Support channel
                let support_diff = (vi.support[d] - vj.support[d]).abs();
                if support_diff > threshold {
                    contradictions.push(DetectedContradiction {
                        role_i: i,
                        role_j: j,
                        dimension: d,
                        channel: ContradictionChannel::Support,
                        magnitude: support_diff,
                    });
                }

                // Refutation channel
                let refutation_diff = (vi.refutation[d] - vj.refutation[d]).abs();
                if refutation_diff > threshold {
                    contradictions.push(DetectedContradiction {
                        role_i: i,
                        role_j: j,
                        dimension: d,
                        channel: ContradictionChannel::Refutation,
                        magnitude: refutation_diff,
                    });
                }
            }
        }
    }

    contradictions
}

/// Count contradictions (for ISS κ estimation).
pub fn contradiction_count(state: &EvidenceState, threshold: f64) -> usize {
    extract_contradictions(state, threshold).len()
}
