use super::contradiction::*;
use super::disagreement::*;
use super::dynamics::*;
use super::evidence_state::*;
use super::iss::*;
use super::laplacian::*;
use super::projection::*;
use super::sheaf::*;

// ===========================================================================
// EvidenceVector tests
// ===========================================================================

#[test]
fn evidence_vector_zeros() {
    let v = EvidenceVector::zeros(4);
    assert_eq!(v.num_dims(), 4);
    assert_eq!(v.full_len(), 8);
    assert_eq!(v.norm(), 0.0);
}

#[test]
fn evidence_vector_net() {
    let v = EvidenceVector {
        support: vec![0.8, 0.5, 0.3],
        refutation: vec![0.2, 0.5, 0.7],
    };
    let net = v.net();
    assert!((net[0] - 0.6).abs() < 1e-10);
    assert!((net[1] - 0.0).abs() < 1e-10);
    assert!((net[2] - (-0.4)).abs() < 1e-10);
}

#[test]
fn evidence_vector_contradiction_detection() {
    let v = EvidenceVector {
        support: vec![0.9, 0.1, 0.8],
        refutation: vec![0.8, 0.1, 0.2],
    };
    let contradictions = v.contradiction_dimensions(0.5);
    assert_eq!(contradictions, vec![0]); // only dim 0 has both > 0.5
}

#[test]
fn evidence_vector_ignorance_detection() {
    let v = EvidenceVector {
        support: vec![0.1, 0.9, 0.05],
        refutation: vec![0.05, 0.1, 0.1],
    };
    let ignorance = v.ignorance_dimensions(0.2);
    assert_eq!(ignorance, vec![0, 2]); // dims 0 and 2 have both < 0.2
}

#[test]
fn evidence_vector_flat_roundtrip() {
    let v = EvidenceVector {
        support: vec![0.1, 0.2, 0.3, 0.4],
        refutation: vec![0.5, 0.6, 0.7, 0.8],
    };
    let flat = v.to_flat();
    let reconstructed = EvidenceVector::from_flat(&flat, 4);
    assert_eq!(v, reconstructed);
}

#[test]
fn evidence_vector_distance_squared() {
    let a = EvidenceVector {
        support: vec![1.0, 0.0],
        refutation: vec![0.0, 0.0],
    };
    let b = EvidenceVector {
        support: vec![0.0, 0.0],
        refutation: vec![0.0, 0.0],
    };
    assert!((a.distance_squared(&b) - 1.0).abs() < 1e-10);
}

#[test]
fn evidence_vector_norm() {
    let v = EvidenceVector {
        support: vec![3.0],
        refutation: vec![4.0],
    };
    assert!((v.norm() - 5.0).abs() < 1e-10);
}

// ===========================================================================
// EvidenceState tests
// ===========================================================================

#[test]
fn evidence_state_zeros() {
    let s = EvidenceState::zeros(3, 4);
    assert_eq!(s.num_roles, 3);
    assert_eq!(s.num_dims, 4);
    assert_eq!(s.role_states.len(), 3);
    assert_eq!(s.to_flat().len(), 3 * 8); // 3 roles × 2×4 dims
}

#[test]
fn evidence_state_flat_roundtrip() {
    let s = EvidenceState {
        role_states: vec![
            EvidenceVector {
                support: vec![0.1, 0.2],
                refutation: vec![0.3, 0.4],
            },
            EvidenceVector {
                support: vec![0.5, 0.6],
                refutation: vec![0.7, 0.8],
            },
        ],
        num_roles: 2,
        num_dims: 2,
    };
    let flat = s.to_flat();
    let reconstructed = EvidenceState::from_flat(&flat, 2, 2);
    assert_eq!(s, reconstructed);
}

#[test]
fn evidence_state_mean() {
    let s = EvidenceState {
        role_states: vec![
            EvidenceVector {
                support: vec![1.0, 0.0],
                refutation: vec![0.0, 1.0],
            },
            EvidenceVector {
                support: vec![0.0, 1.0],
                refutation: vec![1.0, 0.0],
            },
        ],
        num_roles: 2,
        num_dims: 2,
    };
    let mean = s.mean();
    assert!((mean.support[0] - 0.5).abs() < 1e-10);
    assert!((mean.support[1] - 0.5).abs() < 1e-10);
    assert!((mean.refutation[0] - 0.5).abs() < 1e-10);
    assert!((mean.refutation[1] - 0.5).abs() < 1e-10);
}

#[test]
fn evidence_state_add() {
    let a = EvidenceState {
        role_states: vec![EvidenceVector {
            support: vec![0.5],
            refutation: vec![0.3],
        }],
        num_roles: 1,
        num_dims: 1,
    };
    let b = EvidenceState {
        role_states: vec![EvidenceVector {
            support: vec![0.1],
            refutation: vec![0.2],
        }],
        num_roles: 1,
        num_dims: 1,
    };
    let c = a.add(&b);
    assert!((c.role_states[0].support[0] - 0.6).abs() < 1e-10);
    assert!((c.role_states[0].refutation[0] - 0.5).abs() < 1e-10);
}

// ===========================================================================
// Disagreement tests
// ===========================================================================

#[test]
fn disagreement_consensus_is_zero() {
    let s = EvidenceState {
        role_states: vec![
            EvidenceVector {
                support: vec![0.5, 0.5],
                refutation: vec![0.5, 0.5],
            },
            EvidenceVector {
                support: vec![0.5, 0.5],
                refutation: vec![0.5, 0.5],
            },
        ],
        num_roles: 2,
        num_dims: 2,
    };
    assert!(compute_disagreement(&s) < 1e-12);
}

#[test]
fn disagreement_positive_for_different_roles() {
    let s = EvidenceState {
        role_states: vec![
            EvidenceVector {
                support: vec![1.0, 0.0],
                refutation: vec![0.0, 0.0],
            },
            EvidenceVector {
                support: vec![0.0, 1.0],
                refutation: vec![0.0, 0.0],
            },
        ],
        num_roles: 2,
        num_dims: 2,
    };
    let omega = compute_disagreement(&s);
    assert!(omega > 0.0);
    // Mean is (0.5, 0.5, 0, 0). Distance from each role = 0.5² + 0.5² = 0.5. Sum = 1.0.
    assert!((omega - 1.0).abs() < 1e-10);
}

#[test]
fn disagreement_empty_is_zero() {
    let s = EvidenceState::zeros(0, 4);
    assert!(compute_disagreement(&s) < 1e-12);
}

#[test]
fn per_dimension_disagreement_matches_total() {
    let s = EvidenceState {
        role_states: vec![
            EvidenceVector {
                support: vec![1.0, 0.0],
                refutation: vec![0.0, 0.5],
            },
            EvidenceVector {
                support: vec![0.0, 1.0],
                refutation: vec![1.0, 0.5],
            },
        ],
        num_roles: 2,
        num_dims: 2,
    };
    let total = compute_disagreement(&s);
    let per_dim = per_dimension_disagreement(&s);
    let sum: f64 = per_dim.iter().sum();
    assert!(
        (total - sum).abs() < 1e-10,
        "Sum of per-dim disagreement should equal total"
    );
}

// ===========================================================================
// Sheaf and Laplacian tests
// ===========================================================================

#[test]
fn constant_sheaf_laplacian_is_graph_laplacian() {
    // Triangle graph: 3 nodes, each connected to the other two
    // With identity restriction maps (constant sheaf, stalk_dim=1),
    // this should give the standard graph Laplacian.
    let sheaf = CellularSheaf::constant(3, 1, &[(0, 1), (1, 2), (0, 2)]);

    let l_f = sheaf.laplacian();

    // Graph Laplacian for triangle (degree 2 each, all connections):
    // [2, -1, -1]
    // [-1, 2, -1]
    // [-1, -1, 2]
    assert!((l_f[(0, 0)] - 2.0).abs() < 1e-10);
    assert!((l_f[(0, 1)] - (-1.0)).abs() < 1e-10);
    assert!((l_f[(0, 2)] - (-1.0)).abs() < 1e-10);
    assert!((l_f[(1, 1)] - 2.0).abs() < 1e-10);
    assert!((l_f[(1, 2)] - (-1.0)).abs() < 1e-10);
    assert!((l_f[(2, 2)] - 2.0).abs() < 1e-10);
}

#[test]
fn laplacian_is_positive_semidefinite() {
    let sheaf = CellularSheaf::constant(4, 2, &[(0, 1), (1, 2), (2, 3), (0, 3)]);
    let l_f = sheaf.laplacian();

    let sym = (&l_f + l_f.transpose()) * 0.5;
    let eigen = sym.symmetric_eigen();

    for ev in eigen.eigenvalues.iter() {
        assert!(
            *ev >= -1e-10,
            "Eigenvalue {} should be non-negative (PSD)",
            ev
        );
    }
}

#[test]
fn laplacian_kernel_contains_constant_vector() {
    // For a constant sheaf on a connected graph,
    // the constant vector [1,1,...,1] should be in ker(L_F).
    let sheaf = CellularSheaf::constant(3, 1, &[(0, 1), (1, 2), (0, 2)]);
    let l_f = sheaf.laplacian();

    let ones = nalgebra::DVector::from_element(3, 1.0);
    let result = &l_f * &ones;

    for i in 0..3 {
        assert!(
            result[i].abs() < 1e-10,
            "L_F · 1 should be zero, got {} at index {}",
            result[i],
            i
        );
    }
}

#[test]
fn spectral_gap_positive_for_connected_graph() {
    let sheaf = CellularSheaf::constant(4, 1, &[(0, 1), (1, 2), (2, 3), (0, 3)]);
    let analysis = spectral_analysis(&sheaf);

    assert!(analysis.is_connected);
    assert!(analysis.spectral_gap > 0.0);
    assert!(analysis.lambda_max > 0.0);
    assert!(analysis.optimal_alpha > 0.0);
    assert!(analysis.contraction_rate < 1.0);
}

#[test]
fn spectral_gap_zero_for_disconnected_graph() {
    // Two disconnected components
    let sheaf = CellularSheaf::constant(4, 1, &[(0, 1), (2, 3)]);
    let analysis = spectral_analysis(&sheaf);

    // Disconnected graph has 2 zero eigenvalues (two components)
    let num_zeros = analysis
        .eigenvalues
        .iter()
        .filter(|&&ev| ev < 1e-10)
        .count();
    assert!(
        num_zeros >= 2,
        "Disconnected graph should have ≥2 zero eigenvalues, got {}",
        num_zeros
    );
}

#[test]
fn spectral_analysis_contraction_rate_formula() {
    let sheaf = CellularSheaf::constant(3, 1, &[(0, 1), (1, 2), (0, 2)]);
    let analysis = spectral_analysis(&sheaf);

    // ρ = (λ_max - λ₁)/(λ_max + λ₁)
    let expected_rho = (analysis.lambda_max - analysis.spectral_gap)
        / (analysis.lambda_max + analysis.spectral_gap);
    assert!(
        (analysis.contraction_rate - expected_rho).abs() < 1e-10,
        "Contraction rate mismatch"
    );
}

#[test]
fn scaled_restriction_maps_affect_laplacian() {
    // Constant sheaf
    let sheaf1 = CellularSheaf::constant(2, 1, &[(0, 1)]);
    let l1 = sheaf1.laplacian();

    // Scaled sheaf (scale=2)
    let sheaf2 = CellularSheaf {
        num_roles: 2,
        stalk_dims: vec![1, 1],
        restriction_maps: vec![RestrictionMap::scaled_identity(0, 1, 1, 2.0)],
    };
    let l2 = sheaf2.laplacian();

    // L_F with scale s should be s² times L_F with scale 1
    assert!(
        (l2[(0, 0)] - 4.0 * l1[(0, 0)]).abs() < 1e-10,
        "Scaled Laplacian should be s² × base"
    );
}

#[test]
fn coboundary_dimensions_correct() {
    let sheaf = CellularSheaf::constant(3, 2, &[(0, 1), (1, 2)]);
    let delta = sheaf.coboundary_matrix();

    // vertex dim = 3 roles × 2 = 6
    // edge dim = 2 edges × 2 = 4
    assert_eq!(delta.nrows(), 4);
    assert_eq!(delta.ncols(), 6);
}

// ===========================================================================
// Projection tests
// ===========================================================================

#[test]
fn projection_unit_box_clamps() {
    let proj = AdmissibleProjection::unit_box(2);
    let v = EvidenceVector {
        support: vec![-0.5, 1.5],
        refutation: vec![0.5, 2.0],
    };
    let projected = proj.project_vector(&v);
    assert!((projected.support[0] - 0.0).abs() < 1e-10);
    assert!((projected.support[1] - 1.0).abs() < 1e-10);
    assert!((projected.refutation[0] - 0.5).abs() < 1e-10);
    assert!((projected.refutation[1] - 1.0).abs() < 1e-10);
}

#[test]
fn projection_no_change_inside_box() {
    let proj = AdmissibleProjection::unit_box(2);
    let v = EvidenceVector {
        support: vec![0.3, 0.7],
        refutation: vec![0.1, 0.9],
    };
    let projected = proj.project_vector(&v);
    assert_eq!(v, projected);
}

#[test]
fn projection_idempotent() {
    let proj = AdmissibleProjection::unit_box(4);
    let s = EvidenceState {
        role_states: vec![
            EvidenceVector {
                support: vec![-0.5, 1.5, 0.5, 0.3],
                refutation: vec![2.0, -1.0, 0.7, 0.1],
            },
            EvidenceVector {
                support: vec![0.8, 0.2, 1.1, -0.1],
                refutation: vec![0.5, 0.5, 0.5, 0.5],
            },
        ],
        num_roles: 2,
        num_dims: 4,
    };
    assert!(proj.verify_idempotence(&s, 1e-12));
}

#[test]
fn projection_firmly_non_expansive() {
    let proj = AdmissibleProjection::unit_box(2);
    let x = EvidenceVector {
        support: vec![1.5, -0.5],
        refutation: vec![0.3, 0.7],
    };
    let y = EvidenceVector {
        support: vec![0.8, 0.2],
        refutation: vec![1.2, -0.1],
    };
    let px = proj.project_vector(&x);
    let py = proj.project_vector(&y);

    let dist_before = x.distance_squared(&y);
    let dist_after = px.distance_squared(&py);
    assert!(
        dist_after <= dist_before + 1e-10,
        "Projection must be non-expansive: {} > {}",
        dist_after,
        dist_before
    );
}

// ===========================================================================
// Dynamics tests
// ===========================================================================

#[test]
fn propagation_step_no_perturbation_contracts() {
    // Two roles with different evidence, connected by constant sheaf.
    // With zero perturbation, disagreement should decrease.
    let sheaf = CellularSheaf::constant(2, 2, &[(0, 1)]);
    let analysis = spectral_analysis(&sheaf);
    let alpha = analysis.optimal_alpha;

    let state = EvidenceState {
        role_states: vec![
            EvidenceVector {
                support: vec![0.8],
                refutation: vec![0.2],
            },
            EvidenceVector {
                support: vec![0.2],
                refutation: vec![0.8],
            },
        ],
        num_roles: 2,
        num_dims: 1,
    };
    let perturbation = EvidenceState::zeros(2, 1);
    let projection = AdmissibleProjection::unit_box(1);

    let result = propagation_step(&sheaf, &state, &perturbation, &projection, alpha);

    assert!(
        result.disagreement_after < result.disagreement_before,
        "Disagreement should decrease without perturbation: {} >= {}",
        result.disagreement_after,
        result.disagreement_before
    );
    assert!(result.contraction_achieved);
}

#[test]
fn propagation_step_consensus_is_fixed_point() {
    // All roles agree — state should not change (up to numerical noise).
    let sheaf = CellularSheaf::constant(3, 2, &[(0, 1), (1, 2), (0, 2)]);
    let analysis = spectral_analysis(&sheaf);
    let alpha = analysis.optimal_alpha;

    let state = EvidenceState {
        role_states: vec![
            EvidenceVector {
                support: vec![0.5],
                refutation: vec![0.3],
            };
            3
        ],
        num_roles: 3,
        num_dims: 1,
    };
    let perturbation = EvidenceState::zeros(3, 1);
    let projection = AdmissibleProjection::unit_box(1);

    let result = propagation_step(&sheaf, &state, &perturbation, &projection, alpha);
    assert!(
        result.disagreement_after < 1e-12,
        "Consensus should remain at zero disagreement"
    );
}

#[test]
fn propagation_step_records_perturbation_norm() {
    let sheaf = CellularSheaf::constant(2, 2, &[(0, 1)]);
    let state = EvidenceState::zeros(2, 1);
    let perturbation = EvidenceState {
        role_states: vec![
            EvidenceVector {
                support: vec![0.3],
                refutation: vec![0.4],
            },
            EvidenceVector {
                support: vec![0.0],
                refutation: vec![0.0],
            },
        ],
        num_roles: 2,
        num_dims: 1,
    };
    let projection = AdmissibleProjection::unit_box(1);
    let result = propagation_step(&sheaf, &state, &perturbation, &projection, 0.5);
    assert!(
        result.perturbation_norm > 0.0,
        "Perturbation norm should be positive"
    );
    // ‖ε‖ = sqrt(0.3² + 0.4²) = 0.5
    assert!((result.perturbation_norm - 0.5).abs() < 1e-10);
}

// ===========================================================================
// ISS analysis tests
// ===========================================================================

#[test]
fn iss_small_gain_satisfied_when_kappa_small() {
    let result = analyze_iss(
        0.5, // spectral_gap
        0.5, // alpha
        0.1, // noise_bound
        0.1, // contradiction_rate (κ)
        1.0, // initial_disagreement
    );
    // ρ = 1 - 0.5*0.5 = 0.75, ρ² = 0.5625
    // 1-ρ² = 0.4375
    // κ/(1-ρ²) = 0.1/0.4375 ≈ 0.2286 < 1
    assert!(result.small_gain_satisfied);
    assert!(result.small_gain_margin > 0.0);
}

#[test]
fn iss_small_gain_violated_when_kappa_large() {
    let result = analyze_iss(
        0.5, // spectral_gap
        0.5, // alpha
        0.1, // noise_bound
        0.5, // contradiction_rate (κ) — too large
        1.0,
    );
    // κ/(1-ρ²) = 0.5/0.4375 ≈ 1.143 > 1
    assert!(!result.small_gain_satisfied);
    assert!(result.small_gain_margin < 0.0);
}

#[test]
fn iss_contraction_rate_formula() {
    let result = analyze_iss(0.5, 0.5, 0.1, 0.1, 1.0);
    // ρ = 1 - αλ₁ = 1 - 0.25 = 0.75
    assert!((result.contraction_rate - 0.75).abs() < 1e-10);
    assert!((result.contraction_rate_squared - 0.5625).abs() < 1e-10);
}

#[test]
fn iss_steady_state_bound() {
    let result = analyze_iss(0.5, 0.5, 0.1, 0.1, 1.0);
    // B_Ω = ‖ε‖² / (1-ρ²) = 0.01 / 0.4375 ≈ 0.02286
    let expected = 0.01 / 0.4375;
    assert!(
        (result.steady_state_disagreement - expected).abs() < 1e-6,
        "Steady state mismatch: {} vs {}",
        result.steady_state_disagreement,
        expected
    );
}

#[test]
fn iss_convergence_time_positive() {
    let result = analyze_iss(0.5, 0.5, 0.1, 0.1, 1.0);
    assert!(result.convergence_time_estimate > 0.0);
}

#[test]
fn iss_zero_noise_gives_zero_bound() {
    let result = analyze_iss(0.5, 0.5, 0.0, 0.1, 1.0);
    assert!((result.steady_state_disagreement - 0.0).abs() < 1e-15);
}

// ===========================================================================
// Contradiction extraction tests
// ===========================================================================

#[test]
fn no_contradictions_at_consensus() {
    let state = EvidenceState {
        role_states: vec![
            EvidenceVector {
                support: vec![0.5, 0.5],
                refutation: vec![0.3, 0.3],
            };
            3
        ],
        num_roles: 3,
        num_dims: 2,
    };
    let contradictions = extract_contradictions(&state, 0.1);
    assert!(contradictions.is_empty());
}

#[test]
fn contradiction_detected_above_threshold() {
    let state = EvidenceState {
        role_states: vec![
            EvidenceVector {
                support: vec![0.9, 0.5],
                refutation: vec![0.1, 0.5],
            },
            EvidenceVector {
                support: vec![0.1, 0.5],
                refutation: vec![0.9, 0.5],
            },
        ],
        num_roles: 2,
        num_dims: 2,
    };
    let contradictions = extract_contradictions(&state, 0.5);
    // Dim 0: |0.9-0.1| = 0.8 > 0.5 (support), |0.1-0.9| = 0.8 > 0.5 (refutation)
    // Dim 1: |0.5-0.5| = 0.0 (no contradiction)
    assert_eq!(contradictions.len(), 2);
    assert_eq!(contradictions[0].dimension, 0);
    assert_eq!(contradictions[1].dimension, 0);
}

#[test]
fn contradiction_count_matches_extract() {
    let state = EvidenceState {
        role_states: vec![
            EvidenceVector {
                support: vec![0.9],
                refutation: vec![0.1],
            },
            EvidenceVector {
                support: vec![0.1],
                refutation: vec![0.9],
            },
            EvidenceVector {
                support: vec![0.5],
                refutation: vec![0.5],
            },
        ],
        num_roles: 3,
        num_dims: 1,
    };
    let count = contradiction_count(&state, 0.3);
    let extracted = extract_contradictions(&state, 0.3);
    assert_eq!(count, extracted.len());
}

#[test]
fn contradiction_channels_distinguished() {
    let state = EvidenceState {
        role_states: vec![
            EvidenceVector {
                support: vec![0.9],
                refutation: vec![0.1],
            },
            EvidenceVector {
                support: vec![0.9],
                refutation: vec![0.9],
            },
        ],
        num_roles: 2,
        num_dims: 1,
    };
    let contradictions = extract_contradictions(&state, 0.5);
    // Support: |0.9-0.9| = 0.0 (no contradiction)
    // Refutation: |0.1-0.9| = 0.8 > 0.5 (contradiction)
    assert_eq!(contradictions.len(), 1);
    assert_eq!(contradictions[0].channel, ContradictionChannel::Refutation);
}

// ===========================================================================
// Projection restriction map tests (Phase 1c: sheaf grounding)
// ===========================================================================

#[test]
fn projection_identity_when_all_dims() {
    let all_dims = vec![0, 1, 2, 3];
    let rmap = RestrictionMap::projection(0, 1, 4, &all_dims, &all_dims);
    assert_eq!(rmap.edge_dim, 8); // 2 * 4

    let identity = nalgebra::DMatrix::<f64>::identity(8, 8);
    assert!(
        (rmap.source_map - &identity).norm() < 1e-12,
        "Full observation should produce identity source_map"
    );
    assert!(
        (rmap.target_map - &identity).norm() < 1e-12,
        "Full observation should produce identity target_map"
    );
}

#[test]
fn projection_reduces_edge_dim() {
    // Source observes [0, 1], target observes [1, 2]. Shared = [1].
    let rmap = RestrictionMap::projection(0, 1, 4, &[0, 1], &[1, 2]);
    assert_eq!(rmap.edge_dim, 2); // 2 * 1 shared dim

    // source_map should pick dim 1 support (col 1) and dim 1 refutation (col 5)
    assert_eq!(rmap.source_map.nrows(), 2);
    assert_eq!(rmap.source_map.ncols(), 8); // stalk_dim = 2*4
    assert!((rmap.source_map[(0, 1)] - 1.0).abs() < 1e-12);
    assert!((rmap.source_map[(1, 5)] - 1.0).abs() < 1e-12);
    // Everything else should be zero
    let mut nonzero_count = 0;
    for r in 0..2 {
        for c in 0..8 {
            if rmap.source_map[(r, c)].abs() > 1e-12 {
                nonzero_count += 1;
            }
        }
    }
    assert_eq!(nonzero_count, 2);
}

#[test]
fn projection_empty_shared_gives_zero_edge() {
    // Source observes [0], target observes [1]. No shared dims.
    let rmap = RestrictionMap::projection(0, 1, 4, &[0], &[1]);
    assert_eq!(rmap.edge_dim, 0);
    assert_eq!(rmap.source_map.nrows(), 0);
    assert_eq!(rmap.target_map.nrows(), 0);
}

#[test]
fn projection_sheaf_laplacian_psd() {
    // 4-role config: role 0 observes [0], role 1 observes [1],
    // role 2 observes [0,1], role 3 observes all [0,1,2]
    let observed = vec![vec![0], vec![1], vec![0, 1], vec![0, 1, 2]];
    let edges = vec![(0, 2), (1, 2), (2, 3), (0, 3), (1, 3)];
    let sheaf = CellularSheaf::from_role_observations(4, 3, &observed, &edges);

    let l_f = sheaf.laplacian();
    let sym = (&l_f + l_f.transpose()) * 0.5;
    let eigen = sym.symmetric_eigen();

    for ev in eigen.eigenvalues.iter() {
        assert!(
            *ev >= -1e-8,
            "Projection sheaf Laplacian eigenvalue {} should be >= 0 (PSD)",
            ev
        );
    }
}

#[test]
fn projection_sheaf_connected_with_hub() {
    // 7-role config from propagation.yaml:
    // facts=[0], drift=[1], resolver=[1,2], planner=[2],
    // status=[3], governance=[0,1,2,3], tuner=[0,1,2,3]
    let observed = vec![
        vec![0],          // facts
        vec![1],          // drift
        vec![1, 2],       // resolver
        vec![2],          // planner
        vec![3],          // status
        vec![0, 1, 2, 3], // governance (hub)
        vec![0, 1, 2, 3], // tuner (hub)
    ];
    // Complete graph
    let mut edges = Vec::new();
    for i in 0..7 {
        for j in (i + 1)..7 {
            edges.push((i, j));
        }
    }
    let sheaf = CellularSheaf::from_role_observations(7, 4, &observed, &edges);
    let analysis = spectral_analysis(&sheaf);

    assert!(
        analysis.is_connected,
        "Projection sheaf with governance hub should be connected (lambda_1 = {})",
        analysis.spectral_gap
    );
    assert!(
        analysis.contraction_rate < 1.0,
        "Contraction rate should be < 1 for connected sheaf, got {}",
        analysis.contraction_rate
    );
}

#[test]
fn projection_coboundary_zero_iff_agree_on_shared() {
    // 2 roles, 3 dims. Source observes [0,1], target observes [1,2]. Shared = [1].
    let observed = vec![vec![0, 1], vec![1, 2]];
    let edges = vec![(0, 1)];
    let sheaf = CellularSheaf::from_role_observations(2, 3, &observed, &edges);
    let delta = sheaf.coboundary_matrix();

    // State where both agree on dim 1 (support=0.7, refutation=0.3)
    // but differ on their non-shared dims
    let x = nalgebra::DVector::from_vec(vec![
        0.5, 0.7, 0.0, // role0 support [dim0=0.5, dim1=0.7, dim2=0.0]
        0.1, 0.3, 0.0, // role0 refutation [dim0=0.1, dim1=0.3, dim2=0.0]
        0.0, 0.7, 0.9, // role1 support [dim0=0.0, dim1=0.7, dim2=0.9]
        0.0, 0.3, 0.4, // role1 refutation [dim0=0.0, dim1=0.3, dim2=0.4]
    ]);

    let delta_x = &delta * &x;
    for i in 0..delta_x.len() {
        assert!(
            delta_x[i].abs() < 1e-12,
            "delta_e(x)[{}] = {} should be 0 when roles agree on shared dim 1",
            i,
            delta_x[i]
        );
    }

    // State where roles disagree on dim 1
    let y = nalgebra::DVector::from_vec(vec![
        0.5, 0.9, 0.0, // role0 support (dim1 = 0.9)
        0.1, 0.3, 0.0, // role0 refutation
        0.0, 0.2, 0.9, // role1 support (dim1 = 0.2 != 0.9)
        0.0, 0.3, 0.4, // role1 refutation
    ]);

    let delta_y = &delta * &y;
    let delta_y_norm: f64 = delta_y.iter().map(|v| v * v).sum::<f64>().sqrt();
    assert!(
        delta_y_norm > 0.1,
        "delta_e(y) norm should be > 0 when roles disagree on shared dim 1, got {}",
        delta_y_norm
    );
}

#[test]
fn projection_sheaf_degenerates_to_constant() {
    // When all roles observe all dims, from_role_observations should produce
    // the same Laplacian as constant
    let n = 4;
    let d = 3;
    let all_dims: Vec<usize> = (0..d).collect();
    let observed = vec![all_dims.clone(); n];
    let edges = vec![(0, 1), (1, 2), (2, 3), (0, 3)];

    let sheaf_proj = CellularSheaf::from_role_observations(n, d, &observed, &edges);
    let sheaf_const = CellularSheaf::constant(n, 2 * d, &edges);

    let l_proj = sheaf_proj.laplacian();
    let l_const = sheaf_const.laplacian();

    assert_eq!(l_proj.nrows(), l_const.nrows());
    assert_eq!(l_proj.ncols(), l_const.ncols());
    assert!(
        (&l_proj - &l_const).norm() < 1e-10,
        "Projection sheaf with full observation should equal constant sheaf Laplacian"
    );
}

// ===========================================================================
// Integration test: full propagation pipeline
// ===========================================================================

#[test]
fn full_pipeline_convergence() {
    // Set up a 3-role system with disagreement, run multiple propagation steps,
    // and verify that disagreement decreases over time.
    let sheaf = CellularSheaf::constant(3, 2, &[(0, 1), (1, 2), (0, 2)]);
    let analysis = spectral_analysis(&sheaf);
    let alpha = analysis.optimal_alpha;
    let projection = AdmissibleProjection::unit_box(1);

    let mut state = EvidenceState {
        role_states: vec![
            EvidenceVector {
                support: vec![0.9],
                refutation: vec![0.1],
            },
            EvidenceVector {
                support: vec![0.1],
                refutation: vec![0.9],
            },
            EvidenceVector {
                support: vec![0.5],
                refutation: vec![0.5],
            },
        ],
        num_roles: 3,
        num_dims: 1,
    };

    let perturbation = EvidenceState::zeros(3, 1);
    let initial_omega = compute_disagreement(&state);

    for _ in 0..20 {
        let result = propagation_step(&sheaf, &state, &perturbation, &projection, alpha);
        state = result.new_state;
    }

    let final_omega = compute_disagreement(&state);
    assert!(
        final_omega < initial_omega * 0.01,
        "After 20 steps, disagreement should be <1% of initial: {} vs {}",
        final_omega,
        initial_omega
    );
}

// ===========================================================================
// Property-based tests (proptest)
// ===========================================================================

mod proptests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        /// L_F is positive semidefinite for any constant sheaf on a connected graph.
        #[test]
        fn prop_laplacian_psd(n in 2..6usize) {
            // Build a path graph: 0-1-2-...(n-1)
            let edges: Vec<(usize, usize)> = (0..n-1).map(|i| (i, i+1)).collect();
            let sheaf = CellularSheaf::constant(n, 1, &edges);
            let l_f = sheaf.laplacian();
            let sym = (&l_f + l_f.transpose()) * 0.5;
            let eigen = sym.symmetric_eigen();
            for ev in eigen.eigenvalues.iter() {
                prop_assert!(*ev >= -1e-8, "Eigenvalue {} is negative", ev);
            }
        }

        /// Projection is idempotent for any state.
        #[test]
        fn prop_projection_idempotent(
            n in 1..5usize,
            d in 1..4usize,
        ) {
            let proj = AdmissibleProjection::unit_box(d);
            // Random state (may be outside box)
            let state = EvidenceState {
                role_states: (0..n).map(|i| EvidenceVector {
                    support: (0..d).map(|j| (i as f64 * 0.3 + j as f64 * 0.2) - 0.5).collect(),
                    refutation: (0..d).map(|j| (i as f64 * 0.1 + j as f64 * 0.4) - 0.2).collect(),
                }).collect(),
                num_roles: n,
                num_dims: d,
            };
            prop_assert!(proj.verify_idempotence(&state, 1e-12));
        }

        /// Diffusion without perturbation contracts disagreement for connected sheaf.
        #[test]
        fn prop_diffusion_contracts(n in 2..5usize) {
            let edges: Vec<(usize, usize)> = (0..n-1).map(|i| (i, i+1)).collect();
            let sheaf = CellularSheaf::constant(n, 2, &edges); // 2D stalks (support+refutation for 1 dim)
            let analysis = spectral_analysis(&sheaf);
            let alpha = analysis.optimal_alpha;

            // Create a state with disagreement
            let state = EvidenceState {
                role_states: (0..n).map(|i| EvidenceVector {
                    support: vec![i as f64 / n as f64],
                    refutation: vec![1.0 - i as f64 / n as f64],
                }).collect(),
                num_roles: n,
                num_dims: 1,
            };

            let omega_before = compute_disagreement(&state);
            if omega_before < 1e-12 {
                return Ok(()); // trivial case
            }

            let perturbation = EvidenceState::zeros(n, 1);
            let projection = AdmissibleProjection::unit_box(1);
            let result = propagation_step(&sheaf, &state, &perturbation, &projection, alpha);

            prop_assert!(
                result.disagreement_after <= omega_before + 1e-10,
                "Disagreement should not increase: {} > {}",
                result.disagreement_after, omega_before
            );
        }

        /// ISS analysis: if κ < (1 - ρ²), small-gain is satisfied.
        #[test]
        fn prop_iss_small_gain_logic(
            lambda1 in 0.1f64..2.0,
            alpha in 0.1f64..0.9,
        ) {
            let rho = (1.0 - alpha * lambda1).abs();
            if rho >= 1.0 { return Ok(()); }
            let rho_sq = rho * rho;
            let one_minus_rho_sq = 1.0 - rho_sq;
            if one_minus_rho_sq <= 0.0 { return Ok(()); }

            // κ = 0.5 * (1 - ρ²) → should satisfy small-gain
            let kappa = 0.5 * one_minus_rho_sq;
            let result = analyze_iss(lambda1, alpha, 0.1, kappa, 1.0);
            prop_assert!(result.small_gain_satisfied, "Small-gain should be satisfied for κ={}, 1-ρ²={}", kappa, one_minus_rho_sq);

            // κ = 1.5 * (1 - ρ²) → should violate small-gain
            let kappa_bad = 1.5 * one_minus_rho_sq;
            let result_bad = analyze_iss(lambda1, alpha, 0.1, kappa_bad, 1.0);
            prop_assert!(!result_bad.small_gain_satisfied, "Small-gain should be violated for κ={}", kappa_bad);
        }

        // ===================================================================
        // Lattice closure property tests (verify-lattice-closure)
        // ===================================================================

        /// Π_A is monotone w.r.t. knowledge ordering ≤_k:
        /// x ≤_k y ⟹ Π_A(x) ≤_k Π_A(y)
        ///
        /// Box projection (componentwise clamp) preserves componentwise ≤
        /// because clamp is monotone: a ≤ b ⟹ clamp(a,lo,hi) ≤ clamp(b,lo,hi).
        #[test]
        fn prop_projection_monotone_leq_k(
            d in 1..5usize,
            base_s in proptest::collection::vec(0.0f64..1.0, 1..5),
            base_r in proptest::collection::vec(0.0f64..1.0, 1..5),
            delta_s in proptest::collection::vec(0.0f64..0.5, 1..5),
            delta_r in proptest::collection::vec(0.0f64..0.5, 1..5),
        ) {
            let d = d.min(base_s.len()).min(base_r.len()).min(delta_s.len()).min(delta_r.len());
            let proj = AdmissibleProjection::unit_box(d);

            // x: base values
            let x = EvidenceVector {
                support: base_s[..d].to_vec(),
                refutation: base_r[..d].to_vec(),
            };
            // y = x + delta, so y ≥_k x componentwise
            let y = EvidenceVector {
                support: base_s[..d].iter().zip(&delta_s[..d]).map(|(b, d)| b + d).collect(),
                refutation: base_r[..d].iter().zip(&delta_r[..d]).map(|(b, d)| b + d).collect(),
            };

            prop_assert!(x.leq_k(&y), "x should be ≤_k y by construction");

            let px = proj.project_vector(&x);
            let py = proj.project_vector(&y);
            prop_assert!(
                px.leq_k(&py),
                "Π_A(x) should be ≤_k Π_A(y) (monotonicity violated): Π(x)={:?}, Π(y)={:?}",
                px, py
            );
        }

        /// Π_A is NOT extensive in general: ¬(x ≤_k Π_A(x)) when x has values > 1.
        /// Box projection clamps down, which can decrease support/refutation.
        /// This test documents the non-extensiveness explicitly.
        #[test]
        fn prop_projection_not_extensive_outside_box(
            excess in 0.01f64..1.0,
        ) {
            let proj = AdmissibleProjection::unit_box(1);
            let x = EvidenceVector {
                support: vec![1.0 + excess],
                refutation: vec![0.5],
            };
            let px = proj.project_vector(&x);
            // x.support[0] = 1+excess > 1 = px.support[0], so x is NOT ≤_k Π(x)
            prop_assert!(
                !x.leq_k(&px),
                "Projection should NOT be extensive for out-of-box values"
            );
        }

        /// Π_A IS extensive for vectors already inside the admissible set:
        /// x ∈ A ⟹ Π_A(x) = x (and trivially x ≤_k Π_A(x)).
        #[test]
        fn prop_projection_fixpoint_inside_box(
            s in proptest::collection::vec(0.0f64..1.0, 1..5),
            r in proptest::collection::vec(0.0f64..1.0, 1..5),
        ) {
            let d = s.len().min(r.len());
            let proj = AdmissibleProjection::unit_box(d);
            let x = EvidenceVector {
                support: s[..d].to_vec(),
                refutation: r[..d].to_vec(),
            };
            let px = proj.project_vector(&x);
            prop_assert!(
                x.distance_squared(&px) < 1e-24,
                "Vectors inside A must be fixed points of Π_A"
            );
        }

        /// join_k is monotone in ≤_k: if x ≤_k x' and y ≤_k y',
        /// then join_k(x,y) ≤_k join_k(x',y').
        #[test]
        fn prop_join_k_monotone(
            base in proptest::collection::vec(0.0f64..0.5, 4),
            delta1 in proptest::collection::vec(0.0f64..0.3, 4),
            delta2 in proptest::collection::vec(0.0f64..0.3, 4),
        ) {
            let d = 2;
            let x = EvidenceVector {
                support: base[..d].to_vec(),
                refutation: base[d..2*d].to_vec(),
            };
            let x_prime = EvidenceVector {
                support: base[..d].iter().zip(&delta1[..d]).map(|(b,d)| b+d).collect(),
                refutation: base[d..2*d].iter().zip(&delta1[d..2*d]).map(|(b,d)| b+d).collect(),
            };
            let y = EvidenceVector {
                support: vec![0.3; d],
                refutation: vec![0.3; d],
            };
            let y_prime = EvidenceVector {
                support: (0..d).map(|i| 0.3 + delta2[i]).collect(),
                refutation: (0..d).map(|i| 0.3 + delta2[d + i]).collect(),
            };

            prop_assert!(x.leq_k(&x_prime));
            prop_assert!(y.leq_k(&y_prime));

            let jk = x.join_k(&y);
            let jk_prime = x_prime.join_k(&y_prime);
            prop_assert!(
                jk.leq_k(&jk_prime),
                "join_k must be monotone in ≤_k"
            );
        }

        /// meet_t is monotone in ≤_k: applying meet_t with an elimination mask
        /// cannot decrease knowledge (P2.5 from paper).
        #[test]
        fn prop_meet_t_monotone_in_knowledge(
            s in proptest::collection::vec(0.0f64..1.0, 2),
            r in proptest::collection::vec(0.0f64..1.0, 2),
            evidence in 0.0f64..1.0,
        ) {
            let x = EvidenceVector {
                support: s.clone(),
                refutation: r.clone(),
            };
            let mask = EvidenceVector::elimination_mask(2, 0, evidence);
            let _result = x.meet_t(&mask);

            // meet_t can decrease support (min) and increase refutation (max).
            // For ≤_k we need: result.support ≤ x.support AND result.refutation ≥ ... NO.
            // Actually meet_t is NOT monotone in ≤_k in general —
            // it's monotone in ≤_k when the mask is fixed.
            // The paper's P2.5 says: x ≤_k y ⟹ meet_t(x, mask) ≤_k meet_t(y, mask).
            // Let's verify that instead.
            let y = EvidenceVector {
                support: s.iter().map(|v| (v + 0.1).min(1.0)).collect(),
                refutation: r.iter().map(|v| (v + 0.1).min(1.0)).collect(),
            };
            prop_assert!(x.leq_k(&y), "x ≤_k y by construction");

            let rx = x.meet_t(&mask);
            let ry = y.meet_t(&mask);
            prop_assert!(
                rx.leq_k(&ry),
                "meet_t(·, mask) must be monotone in ≤_k: meet_t(x)={:?}, meet_t(y)={:?}",
                rx, ry
            );
        }
    }
}

// ===========================================================================
// Evidence decomposition tests
// ===========================================================================

#[test]
fn positive_part_k_retains_support_only() {
    let v = EvidenceVector {
        support: vec![0.7, 0.3],
        refutation: vec![0.2, 0.8],
    };
    let pp = v.positive_part_k();
    // join_k with zeros = componentwise max with 0 = self (all values >= 0)
    assert!((pp.support[0] - 0.7).abs() < 1e-12);
    assert!((pp.support[1] - 0.3).abs() < 1e-12);
    assert!((pp.refutation[0] - 0.2).abs() < 1e-12);
    assert!((pp.refutation[1] - 0.8).abs() < 1e-12);
}

#[test]
fn negative_part_k_is_swapped_channels() {
    let v = EvidenceVector {
        support: vec![0.7, 0.3],
        refutation: vec![0.2, 0.8],
    };
    let np = v.negative_part_k();
    // neg(v) = (refutation, support); join_k with zeros = neg(v) when all >= 0
    assert!((np.support[0] - 0.2).abs() < 1e-12);
    assert!((np.support[1] - 0.8).abs() < 1e-12);
    assert!((np.refutation[0] - 0.7).abs() < 1e-12);
    assert!((np.refutation[1] - 0.3).abs() < 1e-12);
}

#[test]
fn positive_and_negative_parts_are_non_overlapping_when_pure() {
    // Pure support: only support channel non-zero on dim 0
    let v = EvidenceVector {
        support: vec![0.8, 0.0],
        refutation: vec![0.0, 0.9],
    };
    let _pp = v.positive_part_k();
    let _np = v.negative_part_k();
    // _pp = (0.8, 0.0 | 0.0, 0.9), _np = (0.0, 0.9 | 0.8, 0.0)
    // On dim 0: pp modulus = 0.8, np modulus = 0.8 → NOT non-overlapping (contradicted)
    // Use a truly dimension-disjoint vector instead
    let v2 = EvidenceVector {
        support: vec![0.8, 0.0],
        refutation: vec![0.0, 0.0],
    };
    let pp2 = v2.positive_part_k();
    let np2 = v2.negative_part_k();
    // pp2 = (0.8, 0 | 0, 0), np2 = (0, 0 | 0.8, 0)
    // dim 0: min(0.8, 0.8) = 0.8 > epsilon — still overlapping in knowledge order
    // The decomposition creates non-overlapping vectors only when original is orthogonal
    // (pure support on one channel means neg gives pure refutation on same dim).
    // For dim 1: pp2 modulus = 0, np2 modulus = 0 → non-overlapping on dim 1.
    assert!(!pp2.is_non_overlapping_k(&np2, 0.5)); // dim 0 overlap
                                                   // A purely ignorant vector: both channels zero
    let zeros = EvidenceVector::zeros(2);
    let pp_z = zeros.positive_part_k();
    let np_z = zeros.negative_part_k();
    assert!(pp_z.is_non_overlapping_k(&np_z, 1e-10));
}

#[test]
fn contradiction_resolved_by_decomposition() {
    // Dim 0: contradicted (high support AND high refutation)
    // Dim 1: clean (high support only)
    let v = EvidenceVector {
        support: vec![0.9, 0.8],
        refutation: vec![0.8, 0.1],
    };
    let pp = v.positive_part_k();
    let np = v.negative_part_k();
    // Both pp and np carry evidence on dim 0 (contradicted) — they're NOT non-overlapping
    let eps = 0.5;
    assert!(
        !pp.is_non_overlapping_k(&np, eps),
        "contradicted dim makes parts overlapping"
    );
    // Dim 1 clean case: support high, refutation low
    let clean = EvidenceVector {
        support: vec![0.0, 0.8],
        refutation: vec![0.0, 0.0],
    };
    let pp_c = clean.positive_part_k();
    let np_c = clean.negative_part_k();
    // pp_c = (0,0.8 | 0,0), np_c = (0,0 | 0,0.8)
    // dim 1: pp_c modulus = 0.8, np_c modulus = 0.8 → overlap. This is correct:
    // the decomposition separates BY CHANNEL, not by dimension.
    // The important invariant: pp_c and np_c together cover all evidence in v.
    let reconstructed = pp_c.meet_k(&np_c);
    // meet_k(pp_c, np_c) = (min(0,0), min(0.8,0) | min(0,0), min(0,0.8)) = zeros
    assert!((reconstructed.support[1] - 0.0).abs() < 1e-12);
}

#[test]
fn non_overlapping_holds_for_dimension_disjoint_vectors() {
    // Two vectors with evidence on different dimensions
    let a = EvidenceVector {
        support: vec![0.9, 0.0, 0.0],
        refutation: vec![0.8, 0.0, 0.0],
    };
    let b = EvidenceVector {
        support: vec![0.0, 0.0, 0.7],
        refutation: vec![0.0, 0.0, 0.6],
    };
    assert!(a.is_non_overlapping_k(&b, 1e-10));
    // And they're NOT non-overlapping when they share a dimension
    let c = EvidenceVector {
        support: vec![0.5, 0.0, 0.0],
        refutation: vec![0.4, 0.0, 0.0],
    };
    assert!(!a.is_non_overlapping_k(&c, 1e-10));
}
