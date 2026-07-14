use super::evidence_state::EvidenceState;

/// Compute the variance proxy Ω(x) = Σᵢ ‖xᵢ - x̄‖² for an evidence state.
///
/// This is the sum-of-squared-distances-from-mean, applied to the full
/// 2D-dimensional evidence vectors (support + refutation channels). It is a
/// cheap, topology-agnostic health signal — NOT the Lyapunov function for the
/// diffusion dynamics.
///
/// Relationship to the true sheaf Dirichlet energy f(x) = xᵀL_F x (see
/// [`super::dirichlet`]): Ω(x) = f(x)/N holds ONLY on the constant complete
/// sheaf. On projection sheaves (role-specific observation maps), Ω and f(x)
/// are generally not proportional, and Ω may plateau above zero even when the
/// reachable disagreement f(x) → 0. Gate finality on f(x), not Ω; retain Ω as a
/// topology health signal.
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
