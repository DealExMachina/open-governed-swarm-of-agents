use super::evidence_state::EvidenceState;

/// A detected contradiction: pairwise disagreement between two roles on a dimension.
#[derive(Debug, Clone)]
pub struct DetectedContradiction {
    pub role_i: usize,
    pub role_j: usize,
    pub dimension: usize,
    pub channel: ContradictionChannel,
    pub magnitude: f64,
}

/// Which evidence channel the contradiction was detected in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContradictionChannel {
    Support,
    Refutation,
}

/// Extract contradictions: pairwise role-dimension disagreements exceeding threshold.
///
/// From the paper (§4, Theorem 3):
///   Contradict(x, θ) = {(i, j, d) : |x⁺ᵢ(d) - x⁺ⱼ(d)| > θ or |x⁻ᵢ(d) - x⁻ⱼ(d)| > θ}
///
/// Returns all (role_i, role_j, dimension, channel) tuples where the disagreement
/// exceeds the threshold. Only considers pairs where i < j (no duplicates).
pub fn extract_contradictions(
    state: &EvidenceState,
    threshold: f64,
) -> Vec<DetectedContradiction> {
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
