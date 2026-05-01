//! Tarski Laplacian: meet-based aggregation on bilattice-valued sheaves.
//!
//! Exploratory module. Replaces the linear diffusion operator
//! `x_{t+1} = (I - αL_F)x_t` with a monotone lattice operator:
//!
//! `x_i^{t+1} = join_k(x_i^t, meet_k_{j in N(i)}(x_j^t))`
//!
//! This operator is monotone in the knowledge ordering (≤_k) by construction:
//! - meet_k of neighbors gives the consensus: what all neighbors agree on.
//! - join_k with self ensures knowledge never decreases (monotone ascent in ≤_k).
//!
//! By Tarski's fixed point theorem, repeated application converges to a fixed point
//! in the complete lattice ([0,1]^D × [0,1]^D, ≤_k). However, convergence *rates*
//! are not characterized — this is an open problem.
//!
//! Reference: Ghrist & Riess (2025) propose this for sheaves valued in lattices.

use super::disagreement::compute_disagreement;
use super::evidence_state::EvidenceState;

/// Result of one Tarski Laplacian step.
#[derive(Debug, Clone)]
pub struct TarskiStepResult {
    pub new_state: EvidenceState,
    pub disagreement_before: f64,
    pub disagreement_after: f64,
    pub contraction_ratio: f64,
    /// Whether any role's evidence changed (convergence test).
    pub any_changed: bool,
}

/// One step of the Tarski Laplacian: x_i ← join_k(x_i, meet_k_{j ∈ N(i)}(x_j)).
///
/// `edges` is the list of undirected edges (i, j) defining the communication graph.
/// The operator is monotone in ≤_k and idempotent at fixed points.
pub fn tarski_step(state: &EvidenceState, edges: &[(usize, usize)]) -> TarskiStepResult {
    let omega_before = compute_disagreement(state);
    let n = state.num_roles;

    // Build adjacency list from edges
    let mut neighbors: Vec<Vec<usize>> = vec![vec![]; n];
    for &(i, j) in edges {
        neighbors[i].push(j);
        neighbors[j].push(i);
    }

    let mut new_roles = state.role_states.clone();
    let mut any_changed = false;

    for i in 0..n {
        if neighbors[i].is_empty() {
            continue; // isolated vertex: no update
        }

        // Compute meet_k of all neighbors: consensus of what neighbors agree on
        let mut consensus = state.role_states[neighbors[i][0]].clone();
        for &j in &neighbors[i][1..] {
            consensus = consensus.meet_k(&state.role_states[j]);
        }

        // join_k with self: never lose knowledge
        let updated = state.role_states[i].join_k(&consensus);

        // Check if anything changed
        if updated.distance_squared(&state.role_states[i]) > 1e-20 {
            any_changed = true;
        }

        new_roles[i] = updated;
    }

    let new_state = EvidenceState {
        role_states: new_roles,
        num_roles: state.num_roles,
        num_dims: state.num_dims,
    };

    let omega_after = compute_disagreement(&new_state);
    let contraction_ratio = if omega_before > 1e-15 {
        omega_after / omega_before
    } else {
        0.0
    };

    TarskiStepResult {
        new_state,
        disagreement_before: omega_before,
        disagreement_after: omega_after,
        contraction_ratio,
        any_changed,
    }
}

/// Run the Tarski Laplacian until convergence or max_steps.
/// Returns the number of steps taken and the final state.
pub fn tarski_converge(
    state: &EvidenceState,
    edges: &[(usize, usize)],
    max_steps: usize,
    tolerance: f64,
) -> (usize, EvidenceState, Vec<f64>) {
    let mut current = state.clone();
    let mut omegas = vec![compute_disagreement(&current)];

    for step in 0..max_steps {
        let result = tarski_step(&current, edges);
        omegas.push(result.disagreement_after);

        if !result.any_changed || result.disagreement_after < tolerance {
            return (step + 1, result.new_state, omegas);
        }

        current = result.new_state;
    }

    (max_steps, current, omegas)
}
