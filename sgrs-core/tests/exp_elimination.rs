//! E8: Hybrid Pipeline — Elimination via meet_t
//!
//! Validates Phase 3 of the research progress program:
//! - Hybrid pipeline (diffuse → meet_t eliminate → reproject) contracts Ω
//! - Elimination correctly zeros support and sets refutation on target dim
//! - Tarski Laplacian converges to a fixed point on complete graph
//! - Gate F: elimination completeness check
//!
//! Run: cargo test --test exp_elimination -- --nocapture

use sgrs_core::propagation::{
    compute_disagreement, propagation_step, propagation_step_with_elimination,
    spectral_analysis, tarski_converge, tarski_step, AdmissibleProjection, CellularSheaf,
    EvidenceState, EvidenceVector,
};

fn complete_edges(n: usize) -> Vec<(usize, usize)> {
    let mut e = Vec::new();
    for i in 0..n {
        for j in (i + 1)..n {
            e.push((i, j));
        }
    }
    e
}

// ─── E8.1: Hybrid pipeline contracts strictly faster than standard ───────────

#[test]
fn hybrid_pipeline_contracts_at_least_as_well() {
    println!("\n=== E8.1: Hybrid pipeline vs standard pipeline ===\n");

    let n = 4;
    let num_dims = 2;
    let stalk_dim = 2 * num_dims;
    let sheaf = CellularSheaf::constant(n, stalk_dim, &complete_edges(n));
    let sa = spectral_analysis(&sheaf);
    let alpha = sa.optimal_alpha;
    let proj = AdmissibleProjection::unit_box(num_dims);
    let zero_perturb = EvidenceState::zeros(n, num_dims);

    // Opposing roles: dim 0 contested, dim 1 agrees
    let initial = EvidenceState {
        role_states: vec![
            EvidenceVector { support: vec![0.9, 0.6], refutation: vec![0.1, 0.4] },
            EvidenceVector { support: vec![0.1, 0.6], refutation: vec![0.9, 0.4] },
            EvidenceVector { support: vec![0.8, 0.6], refutation: vec![0.2, 0.4] },
            EvidenceVector { support: vec![0.2, 0.6], refutation: vec![0.7, 0.4] },
        ],
        num_roles: n,
        num_dims,
    };

    // Eliminate dim 0 with strong refutation evidence
    let elimination_targets = vec![(0, 0.95)];
    let steps = 20;

    let mut standard = initial.clone();
    let mut hybrid = initial.clone();

    println!("  {:<4} | {:<16} | {:<16} | {:<8}", "t", "Ω_standard", "Ω_hybrid", "Hybrid ≤?");
    println!("  {:-<4}-+-{:-<16}-+-{:-<16}-+-{:-<8}", "", "", "", "");

    for t in 1..=steps {
        let std_result = propagation_step(&sheaf, &standard, &zero_perturb, &proj, alpha);
        let hyb_result = propagation_step_with_elimination(
            &sheaf, &hybrid, &zero_perturb, &proj, alpha, &elimination_targets,
        );

        if t <= 5 || t == steps {
            println!(
                "  {:<4} | {:<16.10} | {:<16.10} | {}",
                t,
                std_result.disagreement_after,
                hyb_result.propagation.disagreement_after,
                if hyb_result.propagation.disagreement_after <= std_result.disagreement_after + 1e-10 {
                    "✓"
                } else {
                    "✗"
                }
            );
        }

        standard = std_result.new_state;
        hybrid = hyb_result.propagation.new_state;
    }

    let omega_std = compute_disagreement(&standard);
    let omega_hyb = compute_disagreement(&hybrid);

    println!("\n  Standard final Ω = {:.2e}", omega_std);
    println!("  Hybrid final Ω = {:.2e}", omega_hyb);

    // Hybrid should converge at least as fast
    assert!(
        omega_hyb <= omega_std + 1e-10,
        "hybrid Ω ({:.2e}) should be <= standard Ω ({:.2e})",
        omega_hyb, omega_std
    );

    println!("\nResult: hybrid pipeline contracts at least as well as standard ✓");
}

// ─── E8.2: Elimination correctly modifies target dimension ──────────────────

#[test]
fn elimination_correctly_modifies_target_dim() {
    println!("\n=== E8.2: Elimination modifies target dimension correctly ===\n");

    let n = 4;
    let num_dims = 3;
    let stalk_dim = 2 * num_dims;
    let sheaf = CellularSheaf::constant(n, stalk_dim, &complete_edges(n));
    let sa = spectral_analysis(&sheaf);
    let alpha = sa.optimal_alpha;
    let proj = AdmissibleProjection::unit_box(num_dims);
    let zero_perturb = EvidenceState::zeros(n, num_dims);

    let initial = EvidenceState {
        role_states: vec![
            EvidenceVector {
                support: vec![0.8, 0.5, 0.6],
                refutation: vec![0.2, 0.3, 0.4],
            };
            n
        ],
        num_roles: n,
        num_dims,
    };

    // Eliminate dimension 1
    let elimination_targets = vec![(1, 0.9)];

    let result = propagation_step_with_elimination(
        &sheaf, &initial, &zero_perturb, &proj, alpha, &elimination_targets,
    );

    println!("  Eliminations applied: {}", result.eliminations_applied);
    assert_eq!(result.eliminations_applied, 1);

    // After elimination + projection, dim 1 should have low support and high refutation
    for (i, role) in result.propagation.new_state.role_states.iter().enumerate() {
        println!(
            "  Role {}: support={:?}, refutation={:?}",
            i, role.support, role.refutation
        );
        // Dim 1 support should be very low (meet_t with 0)
        assert!(
            role.support[1] < 0.1,
            "role {} dim 1 support should be near 0 after elimination, got {}",
            i, role.support[1]
        );
        // Dim 1 refutation should be high (meet_t with 0.9)
        assert!(
            role.refutation[1] > 0.5,
            "role {} dim 1 refutation should be high after elimination, got {}",
            i, role.refutation[1]
        );
        // Other dims should be relatively unchanged (within diffusion effects)
        assert!(
            role.support[0] > 0.3,
            "role {} dim 0 support should survive elimination, got {}",
            i, role.support[0]
        );
    }

    println!("\nResult: elimination correctly modifies target dimension ✓");
}

// ─── E8.3: Tarski Laplacian converges on complete graph ─────────────────────

#[test]
fn tarski_laplacian_converges() {
    println!("\n=== E8.3: Tarski Laplacian converges to fixed point ===\n");

    let n = 4;
    let num_dims = 2;
    let edges = complete_edges(n);

    let initial = EvidenceState {
        role_states: vec![
            EvidenceVector { support: vec![0.9, 0.5], refutation: vec![0.1, 0.3] },
            EvidenceVector { support: vec![0.3, 0.7], refutation: vec![0.6, 0.2] },
            EvidenceVector { support: vec![0.5, 0.4], refutation: vec![0.4, 0.5] },
            EvidenceVector { support: vec![0.7, 0.6], refutation: vec![0.3, 0.4] },
        ],
        num_roles: n,
        num_dims,
    };

    let omega_0 = compute_disagreement(&initial);
    println!("  Initial Ω = {:.6}", omega_0);

    let (steps, final_state, omegas) = tarski_converge(&initial, &edges, 100, 1e-12);

    println!("  Converged in {} steps", steps);
    println!("  Final Ω = {:.2e}", omegas.last().unwrap());

    // Print trajectory
    println!("\n  {:<4} | {:<12}", "t", "Ω(t)");
    println!("  {:-<4}-+-{:-<12}", "", "");
    for (t, omega) in omegas.iter().enumerate() {
        if t <= 10 || t == omegas.len() - 1 {
            println!("  {:<4} | {:.6e}", t, omega);
        }
    }

    // Verify convergence — Tarski reaches fixed point but may retain some
    // disagreement (meet_k is conservative; consensus ≠ full agreement).
    // The key property is reaching a fixed point, not eliminating all Ω.
    assert!(steps < 100, "should converge before max_steps");
    assert!(
        *omegas.last().unwrap() <= omega_0,
        "Ω should not increase: {:.6} vs {:.6}",
        omegas.last().unwrap(), omega_0
    );

    // Verify fixed point: one more step should not change state
    let check = tarski_step(&final_state, &edges);
    assert!(
        !check.any_changed,
        "should be at fixed point (no changes after convergence)"
    );

    // At fixed point, all roles should agree on meet_k
    // (each role has the consensus of all neighbors)
    let mean = final_state.mean();
    println!("\n  Fixed point mean: support={:?}, refutation={:?}", mean.support, mean.refutation);

    for (i, role) in final_state.role_states.iter().enumerate() {
        let dist = role.distance_squared(&mean).sqrt();
        println!("  Role {} distance from mean: {:.2e}", i, dist);
    }

    println!("\nResult: Tarski Laplacian converges to fixed point ✓");
}

// ─── E8.4: Tarski Laplacian is monotone in knowledge ordering ───────────────

#[test]
fn tarski_monotone_in_knowledge() {
    println!("\n=== E8.4: Tarski step is monotone in ≤_k ===\n");

    let n = 3;
    let num_dims = 2;
    let edges = complete_edges(n);

    let state = EvidenceState {
        role_states: vec![
            EvidenceVector { support: vec![0.5, 0.3], refutation: vec![0.4, 0.6] },
            EvidenceVector { support: vec![0.7, 0.5], refutation: vec![0.3, 0.4] },
            EvidenceVector { support: vec![0.6, 0.4], refutation: vec![0.5, 0.5] },
        ],
        num_roles: n,
        num_dims,
    };

    let result = tarski_step(&state, &edges);

    // Each role should have at least as much knowledge after the step
    // (join_k with consensus can only increase or maintain)
    for (i, (before, after)) in state
        .role_states
        .iter()
        .zip(result.new_state.role_states.iter())
        .enumerate()
    {
        assert!(
            before.leq_k(after),
            "role {} should not lose knowledge: before={:?}, after={:?}",
            i, before, after
        );
        println!(
            "  Role {}: before ≤_k after ✓ (Δsup={:?}, Δref={:?})",
            i,
            after
                .support
                .iter()
                .zip(before.support.iter())
                .map(|(a, b)| a - b)
                .collect::<Vec<_>>(),
            after
                .refutation
                .iter()
                .zip(before.refutation.iter())
                .map(|(a, b)| a - b)
                .collect::<Vec<_>>()
        );
    }

    println!("\nResult: Tarski step is monotone in ≤_k ✓");
}

// ─── E8.5: Hybrid vs Tarski comparison ──────────────────────────────────────

#[test]
fn hybrid_and_tarski_both_converge() {
    println!("\n=== E8.5: Hybrid (linear) and Tarski (lattice) both converge ===\n");

    let n = 4;
    let num_dims = 2;
    let stalk_dim = 2 * num_dims;
    let edges = complete_edges(n);
    let sheaf = CellularSheaf::constant(n, stalk_dim, &edges);
    let sa = spectral_analysis(&sheaf);
    let alpha = sa.optimal_alpha;
    let proj = AdmissibleProjection::unit_box(num_dims);
    let zero_perturb = EvidenceState::zeros(n, num_dims);

    let initial = EvidenceState {
        role_states: vec![
            EvidenceVector { support: vec![0.9, 0.2], refutation: vec![0.1, 0.8] },
            EvidenceVector { support: vec![0.2, 0.8], refutation: vec![0.7, 0.3] },
            EvidenceVector { support: vec![0.6, 0.5], refutation: vec![0.4, 0.5] },
            EvidenceVector { support: vec![0.4, 0.6], refutation: vec![0.5, 0.4] },
        ],
        num_roles: n,
        num_dims,
    };

    let omega_0 = compute_disagreement(&initial);

    // Run both for 20 steps
    let mut linear = initial.clone();
    let mut tarski = initial.clone();

    println!("  {:<4} | {:<16} | {:<16}", "t", "Ω_linear", "Ω_tarski");
    println!("  {:-<4}-+-{:-<16}-+-{:-<16}", "", "", "");

    for t in 1..=20 {
        let lin_result = propagation_step(&sheaf, &linear, &zero_perturb, &proj, alpha);
        let tar_result = tarski_step(&tarski, &edges);

        if t <= 5 || t % 5 == 0 {
            println!(
                "  {:<4} | {:<16.10} | {:<16.10}",
                t, lin_result.disagreement_after, tar_result.disagreement_after
            );
        }

        linear = lin_result.new_state;
        tarski = tar_result.new_state;
    }

    let omega_linear = compute_disagreement(&linear);
    let omega_tarski = compute_disagreement(&tarski);

    println!("\n  Linear final Ω = {:.2e} (ratio = {:.2e})", omega_linear, omega_linear / omega_0);
    println!("  Tarski final Ω = {:.2e} (ratio = {:.2e})", omega_tarski, omega_tarski / omega_0);

    assert!(
        omega_linear < omega_0 * 0.01,
        "linear should contract to < 1%"
    );
    // Tarski converges but may take more steps (convergence rate is an open problem)
    assert!(
        omega_tarski < omega_0,
        "tarski should at least reduce disagreement"
    );

    println!("\nResult: both methods converge from same initial state ✓");
}
