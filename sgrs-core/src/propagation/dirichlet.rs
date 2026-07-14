use nalgebra::{DMatrix, DVector};

use super::evidence_state::EvidenceState;
use super::sheaf::CellularSheaf;

/// True sheaf Dirichlet energy f(x) = xᵀ L_F x = ‖δx‖².
///
/// This is the correct Lyapunov function for x_{t+1} = Π_A[(I − αL_F)x_t + ε_t].
/// It contracts at rate ρ² = (1 − αλ₂)² per step, governed by the spectral gap
/// λ₂(L_F). Compare with the variance proxy Ω(x) = Σ‖x_i − x̄‖², which equals
/// f(x)/N only on the constant complete sheaf. On projection sheaves (role-specific
/// observation maps), Ω(x) and f(x) are generally not proportional.
///
/// The zero set {x : f(x) = 0} = ker(δ) = global sections of the sheaf, i.e.
/// all roles agree (consensus) on the observed subspace — the propagation-layer
/// analogue of finality_gap_vector returning the zero vector at the semantic layer.
pub fn dirichlet_energy_from_laplacian(l_f: &DMatrix<f64>, flat_x: &[f64]) -> f64 {
    let x = DVector::from_column_slice(flat_x);
    // Clamp tiny negatives that arise from numerical noise in PSD computation
    (x.transpose() * l_f * &x)[(0, 0)].max(0.0)
}

/// Compute sheaf Dirichlet energy for an evidence state.
///
/// Builds L_F from the sheaf once; use `dirichlet_energy_from_laplacian` directly
/// when L_F is already in scope (e.g. inside propagation_step).
pub fn dirichlet_energy(sheaf: &CellularSheaf, state: &EvidenceState) -> f64 {
    let l_f = sheaf.laplacian();
    dirichlet_energy_from_laplacian(&l_f, &state.to_flat())
}

/// Per-edge Dirichlet energy: ‖δ_e x‖² for each edge e.
///
/// The sum equals f(x). Use for bottleneck attribution — the highest-energy edge
/// identifies the role pair with the most disagreement on their shared observations.
/// Useful for governance topology design: edges with persistently high energy are
/// candidates for stronger restriction maps or additional communication.
pub fn dirichlet_energy_by_edge(sheaf: &CellularSheaf, state: &EvidenceState) -> Vec<f64> {
    let delta = sheaf.coboundary_matrix();
    let x = DVector::from_column_slice(&state.to_flat());
    let delta_x = &delta * &x;

    let mut result = Vec::with_capacity(sheaf.restriction_maps.len());
    let mut row = 0;
    for map in &sheaf.restriction_maps {
        let edge_energy: f64 = (row..row + map.edge_dim)
            .map(|r| delta_x[r] * delta_x[r])
            .sum();
        result.push(edge_energy);
        row += map.edge_dim;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::propagation::{CellularSheaf, EvidenceState};

    fn constant_complete_sheaf(n: usize, d: usize) -> CellularSheaf {
        let mut edges = Vec::new();
        for i in 0..n {
            for j in (i + 1)..n {
                edges.push((i, j));
            }
        }
        // stalk_dim = 2*d: each role holds (support[d], refutation[d])
        CellularSheaf::constant(n, 2 * d, &edges)
    }

    fn uniform_state(n: usize, d: usize, val: f64) -> EvidenceState {
        EvidenceState::from_flat(&vec![val; n * 2 * d], n, d)
    }

    #[test]
    fn consensus_has_zero_energy() {
        // x̄ = x_i for all i  ⟹  f(x) = 0
        let sheaf = constant_complete_sheaf(4, 2);
        let state = uniform_state(4, 2, 0.5);
        let energy = dirichlet_energy(&sheaf, &state);
        assert!(energy < 1e-12, "uniform state should have zero Dirichlet energy, got {energy}");
    }

    #[test]
    fn energy_proportional_to_omega_on_constant_complete_sheaf() {
        use crate::propagation::compute_disagreement;
        // On the constant complete sheaf: f(x) = N·Ω(x) where N = num_roles.
        // (Each edge contributes ‖x_i - x_j‖² and the complete-graph Laplacian sums
        //  over all pairs; the identity maps make this exactly N times the variance.)
        let n = 3usize;
        let d = 2usize;
        let sheaf = constant_complete_sheaf(n, d);
        let flat = vec![0.1, 0.2, 0.8, 0.5, 0.4, 0.3, 0.7, 0.9, 0.6, 0.1, 0.5, 0.4];
        let state = EvidenceState::from_flat(&flat, n, d);
        let f = dirichlet_energy(&sheaf, &state);
        let omega = compute_disagreement(&state);
        // f = N · Ω on constant complete sheaf
        let ratio = f / omega;
        assert!(
            (ratio - n as f64).abs() < 1e-10,
            "f/Ω should equal N={n} on constant complete sheaf, got ratio={ratio:.6}"
        );
    }

    #[test]
    fn projection_sheaf_energy_differs_from_omega() {
        use crate::propagation::compute_disagreement;
        // Build a 2-role projection sheaf where roles observe disjoint dimensions.
        // role 0 observes dim 0 only; role 1 observes dim 1 only.
        // The shared subspace is empty → edge_dim = 0 → f(x) = 0, but Ω ≠ 0 in general.
        let n = 2usize;
        let d = 2usize;
        let obs = vec![vec![0usize], vec![1usize]];
        let edges = vec![(0usize, 1usize)];
        let sheaf = CellularSheaf::from_role_observations(n, d, &obs, &edges);
        let flat = vec![0.2, 0.8, 0.1, 0.9, 0.6, 0.4, 0.7, 0.3];
        let state = EvidenceState::from_flat(&flat, n, d);
        let f = dirichlet_energy(&sheaf, &state);
        let omega = compute_disagreement(&state);
        // Disjoint observations → no shared edge subspace → f = 0
        assert!(f < 1e-12, "disjoint projection sheaf should have f=0, got {f}");
        // Ω would be non-zero (roles differ overall)
        assert!(omega > 1e-6, "Ω should be nonzero for differing roles, got {omega}");
        // This proves Ω ≠ f/N on projection sheaves.
    }

    #[test]
    fn per_edge_sums_to_total() {
        let n = 3usize;
        let d = 2usize;
        let sheaf = constant_complete_sheaf(n, d);
        let flat: Vec<f64> = (0..n * 2 * d).map(|i| (i as f64) * 0.1).collect();
        let state = EvidenceState::from_flat(&flat, n, d);
        let total = dirichlet_energy(&sheaf, &state);
        let per_edge: f64 = dirichlet_energy_by_edge(&sheaf, &state).iter().sum();
        assert!((total - per_edge).abs() < 1e-10,
            "per-edge sum {per_edge} should equal total {total}");
    }
}
