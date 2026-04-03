use nalgebra::DMatrix;

use super::disagreement::compute_disagreement;
use super::evidence_state::{EvidenceState, EvidenceVector};
use super::projection::AdmissibleProjection;
use super::sheaf::CellularSheaf;

/// Result of one propagation step.
#[derive(Debug, Clone)]
pub struct PropagationStepResult {
    pub new_state: EvidenceState,
    pub disagreement_before: f64,
    pub disagreement_after: f64,
    pub contraction_ratio: f64,
    pub perturbation_norm: f64,
    pub contraction_achieved: bool,
}

/// Result of a hybrid propagation step with elimination (Phase 3, §6.8).
#[derive(Debug, Clone)]
pub struct HybridStepResult {
    /// Standard propagation result.
    pub propagation: PropagationStepResult,
    /// Disagreement after elimination (before re-projection).
    pub disagreement_after_elimination: f64,
    /// Number of dimensions eliminated in this step.
    pub eliminations_applied: usize,
}

/// One propagation step: x_{t+1} = Π_A[(I − αL_F)x_t + ε_t]
///
/// 1. Compute diffusion: y = (I - αL_F)x_t
/// 2. Add perturbation: z = y + ε_t
/// 3. Project onto admissible set: x_{t+1} = Π_A(z)
///
/// α must be in (0, 2/λ_max(L_F)) for contraction.
pub fn propagation_step(
    sheaf: &CellularSheaf,
    state: &EvidenceState,
    perturbation: &EvidenceState,
    projection: &AdmissibleProjection,
    alpha: f64,
) -> PropagationStepResult {
    let omega_before = compute_disagreement(state);

    // Compute the Laplacian
    let l_f = sheaf.laplacian();
    let n = l_f.nrows();

    // Flatten state to vector
    let x = state.to_flat();
    assert_eq!(x.len(), n, "State dimension must match Laplacian dimension");

    // Compute (I - αL_F)x
    let identity = DMatrix::identity(n, n);
    let diffusion_operator = &identity - alpha * &l_f;
    let x_vec = nalgebra::DVector::from_vec(x);
    let diffused = &diffusion_operator * &x_vec;

    // Flatten perturbation
    let eps = perturbation.to_flat();
    let perturbation_norm: f64 = eps.iter().map(|e| e * e).sum::<f64>().sqrt();

    // Add perturbation: z = diffused + ε
    let z: Vec<f64> = diffused.iter().zip(eps.iter()).map(|(d, e)| d + e).collect();

    // Reconstruct state from flat vector
    let perturbed = EvidenceState::from_flat(&z, state.num_roles, state.num_dims);

    // Project onto admissible set
    let new_state = projection.project(&perturbed);

    let omega_after = compute_disagreement(&new_state);

    let contraction_ratio = if omega_before > 1e-15 {
        omega_after / omega_before
    } else {
        0.0
    };

    PropagationStepResult {
        new_state,
        disagreement_before: omega_before,
        disagreement_after: omega_after,
        contraction_ratio,
        perturbation_norm,
        contraction_achieved: omega_after <= omega_before + 1e-12,
    }
}

/// Hybrid propagation step with bilattice elimination (Phase 3, §6.8).
///
/// Pipeline:
///   1. Diffuse:    y = (I − αL_F)x_t
///   2. Eliminate:   y' = meet_t(y_i, e_t)  for each role i
///   3. Perturb:    z = y' + ε_t
///   4. Re-project: x_{t+1} = Π_A(z)
///
/// The elimination step applies `meet_t` with an elimination mask for each
/// certified dimension. This is monotone in ≤_k (P2.5 verified) so it
/// cannot decrease knowledge — it only adds refutation evidence.
///
/// `elimination_targets` is a list of (dimension, refutation_evidence) pairs
/// from governance EliminationCertificates.
pub fn propagation_step_with_elimination(
    sheaf: &CellularSheaf,
    state: &EvidenceState,
    perturbation: &EvidenceState,
    projection: &AdmissibleProjection,
    alpha: f64,
    elimination_targets: &[(usize, f64)],
) -> HybridStepResult {
    let omega_before = compute_disagreement(state);

    // Step 1: Diffuse (same as standard propagation_step)
    let l_f = sheaf.laplacian();
    let n = l_f.nrows();
    let x = state.to_flat();
    assert_eq!(x.len(), n, "State dimension must match Laplacian dimension");

    let identity = DMatrix::identity(n, n);
    let diffusion_operator = &identity - alpha * &l_f;
    let x_vec = nalgebra::DVector::from_vec(x);
    let diffused = &diffusion_operator * &x_vec;

    // Reconstruct diffused state for meet_t operation
    let diffused_vec: Vec<f64> = diffused.iter().copied().collect();
    let mut diffused_state =
        EvidenceState::from_flat(&diffused_vec, state.num_roles, state.num_dims);

    // Step 2: Eliminate via meet_t for each certified dimension
    let mut eliminations_applied = 0;
    for &(dim, evidence) in elimination_targets {
        if dim < state.num_dims && evidence > 0.0 {
            let mask = EvidenceVector::elimination_mask(state.num_dims, dim, evidence);
            for role_state in &mut diffused_state.role_states {
                *role_state = role_state.meet_t(&mask);
            }
            eliminations_applied += 1;
        }
    }

    let omega_after_elim = compute_disagreement(&diffused_state);

    // Step 3: Perturb
    let eps = perturbation.to_flat();
    let perturbation_norm: f64 = eps.iter().map(|e| e * e).sum::<f64>().sqrt();

    let z_flat = diffused_state.to_flat();
    let z: Vec<f64> = z_flat.iter().zip(eps.iter()).map(|(d, e)| d + e).collect();

    // Step 4: Re-project
    let perturbed = EvidenceState::from_flat(&z, state.num_roles, state.num_dims);
    let new_state = projection.project(&perturbed);

    let omega_after = compute_disagreement(&new_state);

    let contraction_ratio = if omega_before > 1e-15 {
        omega_after / omega_before
    } else {
        0.0
    };

    HybridStepResult {
        propagation: PropagationStepResult {
            new_state,
            disagreement_before: omega_before,
            disagreement_after: omega_after,
            contraction_ratio,
            perturbation_norm,
            contraction_achieved: omega_after <= omega_before + 1e-12,
        },
        disagreement_after_elimination: omega_after_elim,
        eliminations_applied,
    }
}
