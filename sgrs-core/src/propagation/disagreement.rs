use super::evidence_state::EvidenceState;

/// Compute disagreement Ω(x) = Σᵢ ‖xᵢ - x̄‖² for an evidence state.
///
/// This is the standard sum-of-squared-distances-from-mean, applied to the
/// full 2D-dimensional evidence vectors (support + refutation channels).
///
/// Ω(x) = 0 iff all roles agree (consensus).
/// The sheaf diffusion operator contracts Ω at rate ρ² = (1 - αλ₁)².
pub fn compute_disagreement(state: &EvidenceState) -> f64 {
    if state.num_roles == 0 {
        return 0.0;
    }
    let mean = state.mean();
    state
        .role_states
        .iter()
        .map(|v| v.distance_squared(&mean))
        .sum()
}

/// Compute per-dimension disagreement: Ω_d = Σᵢ (s_i,d - s̄_d)² + (r_i,d - r̄_d)²
/// for each base dimension d.
///
/// Returns a vector of length D (base dimensions).
pub fn per_dimension_disagreement(state: &EvidenceState) -> Vec<f64> {
    if state.num_roles == 0 {
        return vec![0.0; state.num_dims];
    }
    let mean = state.mean();
    let mut result = vec![0.0; state.num_dims];
    for role in &state.role_states {
        for (d, rd) in result.iter_mut().enumerate() {
            let ds = role.support[d] - mean.support[d];
            let dr = role.refutation[d] - mean.refutation[d];
            *rd += ds * ds + dr * dr;
        }
    }
    result
}
