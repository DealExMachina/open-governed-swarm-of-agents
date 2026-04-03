//! E4: Bilattice Contradiction vs Ignorance
//!
//! Validates:
//! - Bilattice semantics: support/refutation distinguishes contradiction from ignorance
//! - Contradiction extraction with correct channel discrimination
//! - Sheaf diffusion resolves contradictions over time
//!
//! Run: cargo test --test exp_bilattice -- --nocapture

use sgrs_core::propagation::{
    spectral_analysis, AdmissibleProjection, CellularSheaf, ContradictionChannel,
    EvidenceState, EvidenceVector, compute_disagreement, contradiction_count,
    extract_contradictions, per_dimension_disagreement, propagation_step,
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

// ─── Tests ───────────────────────────────────────────────────────────────────

#[test]
fn bilattice_consensus_zero_disagreement() {
    println!("\n=== E4.1: Consensus → Ω ≈ 0, no contradictions ===\n");

    let n = 4;
    let num_dims = 2;
    let state = EvidenceState {
        role_states: vec![
            EvidenceVector { support: vec![0.7, 0.5], refutation: vec![0.2, 0.3] };
            n
        ],
        num_roles: n,
        num_dims,
    };

    let omega = compute_disagreement(&state);
    let contradictions = extract_contradictions(&state, 0.1);

    println!("  Ω = {:.15}", omega);
    println!("  contradictions = {}", contradictions.len());

    assert!(omega < 1e-12, "consensus should have Ω ≈ 0, got {}", omega);
    assert!(contradictions.is_empty(), "consensus should have 0 contradictions");

    println!("\nResult: consensus has zero disagreement and no contradictions ✓");
}

#[test]
fn bilattice_ignorance_zero_disagreement() {
    println!("\n=== E4.2: Shared ignorance → Ω ≈ 0, ignorance detected ===\n");

    let n = 4;
    let num_dims = 2;
    let state = EvidenceState {
        role_states: vec![
            EvidenceVector { support: vec![0.05, 0.08], refutation: vec![0.03, 0.07] };
            n
        ],
        num_roles: n,
        num_dims,
    };

    let omega = compute_disagreement(&state);
    let contradictions = extract_contradictions(&state, 0.1);

    // Check ignorance detection per-vector
    let ignorance_dims = state.role_states[0].ignorance_dimensions(0.2);

    println!("  Ω = {:.15}", omega);
    println!("  contradictions = {}", contradictions.len());
    println!("  ignorant dimensions (θ=0.2): {:?}", ignorance_dims);

    assert!(omega < 1e-12, "shared ignorance should have Ω ≈ 0, got {}", omega);
    assert!(contradictions.is_empty(), "shared ignorance has no contradictions");
    assert_eq!(ignorance_dims, vec![0, 1], "both dims should be ignorant");

    println!("\nResult: shared ignorance — zero disagreement, ignorance detected ✓");
}

#[test]
fn bilattice_contradiction_detected() {
    println!("\n=== E4.3: Opposing roles → Ω > 0, contradictions detected ===\n");

    let n = 4;
    let num_dims = 2;

    // Role 0,2,3: strong support on dim 0, low refutation
    // Role 1: low support on dim 0, high refutation (opposing view)
    // All agree on dim 1
    let state = EvidenceState {
        role_states: vec![
            EvidenceVector { support: vec![0.9, 0.5], refutation: vec![0.1, 0.3] },
            EvidenceVector { support: vec![0.1, 0.5], refutation: vec![0.9, 0.3] },
            EvidenceVector { support: vec![0.9, 0.5], refutation: vec![0.1, 0.3] },
            EvidenceVector { support: vec![0.9, 0.5], refutation: vec![0.1, 0.3] },
        ],
        num_roles: n,
        num_dims,
    };

    let omega = compute_disagreement(&state);
    let contradictions = extract_contradictions(&state, 0.3);

    println!("  Ω = {:.6}", omega);
    println!("  contradictions (θ=0.3): {}", contradictions.len());

    // Classify by channel
    let support_contradictions: Vec<_> = contradictions.iter()
        .filter(|c| c.channel == ContradictionChannel::Support)
        .collect();
    let refutation_contradictions: Vec<_> = contradictions.iter()
        .filter(|c| c.channel == ContradictionChannel::Refutation)
        .collect();

    println!("  support channel: {} contradictions", support_contradictions.len());
    println!("  refutation channel: {} contradictions", refutation_contradictions.len());

    for c in &contradictions {
        println!(
            "    roles ({},{}) dim {} {:?} magnitude={:.2}",
            c.role_i, c.role_j, c.dimension, c.channel, c.magnitude
        );
    }

    assert!(omega > 0.0, "opposing roles should have Ω > 0");
    assert!(!contradictions.is_empty(), "should detect contradictions");

    // All contradictions should involve role 1 (the opposing role) on dim 0
    for c in &contradictions {
        assert!(
            c.role_i == 1 || c.role_j == 1,
            "contradictions should involve the opposing role 1"
        );
        assert_eq!(c.dimension, 0, "contradictions should be on dim 0 (dim 1 agrees)");
    }

    // Both channels should show contradictions on dim 0
    assert!(!support_contradictions.is_empty(), "support channel should have contradictions");
    assert!(!refutation_contradictions.is_empty(), "refutation channel should have contradictions");

    // Per-dimension disagreement should show dim 0 >> dim 1
    let per_dim = per_dimension_disagreement(&state);
    println!("  per-dim disagreement: {:?}", per_dim);
    assert!(per_dim[0] > per_dim[1] * 10.0, "dim 0 should dominate disagreement");

    println!("\nResult: contradictions correctly detected on opposing dimension ✓");
}

#[test]
fn bilattice_partial_knowledge() {
    println!("\n=== E4.4: Partial knowledge — some roles informed, others ignorant ===\n");

    let n = 4;
    let num_dims = 3;

    let state = EvidenceState {
        role_states: vec![
            // Roles 0,1: informed on dim 0 (high support)
            EvidenceVector { support: vec![0.9, 0.5, 0.4], refutation: vec![0.1, 0.3, 0.3] },
            EvidenceVector { support: vec![0.85, 0.5, 0.45], refutation: vec![0.15, 0.3, 0.35] },
            // Roles 2,3: ignorant on dim 0 (low support, low refutation)
            EvidenceVector { support: vec![0.1, 0.5, 0.42], refutation: vec![0.1, 0.3, 0.32] },
            EvidenceVector { support: vec![0.12, 0.5, 0.43], refutation: vec![0.08, 0.3, 0.33] },
        ],
        num_roles: n,
        num_dims,
    };

    let omega = compute_disagreement(&state);
    let per_dim = per_dimension_disagreement(&state);

    println!("  Ω = {:.6}", omega);
    println!("  per-dim: dim0={:.6}, dim1={:.6}, dim2={:.6}", per_dim[0], per_dim[1], per_dim[2]);

    assert!(omega > 0.0, "partial knowledge should have Ω > 0");
    assert!(per_dim[0] > per_dim[1], "dim 0 (partial info) should have highest disagreement");
    assert!(per_dim[0] > per_dim[2], "dim 0 should dominate over dim 2");

    // Sum of per-dim should equal total
    let per_dim_total: f64 = per_dim.iter().sum();
    assert!(
        (per_dim_total - omega).abs() < 1e-10,
        "per-dim sum {:.10} should equal total Ω {:.10}",
        per_dim_total, omega
    );

    println!("\nResult: partial knowledge correctly localized to dim 0 ✓");
}

#[test]
fn bilattice_diffusion_resolves_contradictions() {
    println!("\n=== E4.5: Diffusion resolves contradictions over time ===\n");

    let n = 4;
    let num_dims = 2;
    let stalk_dim = 2 * num_dims;
    let sheaf = CellularSheaf::constant(n, stalk_dim, &complete_edges(n));
    let sa = spectral_analysis(&sheaf);
    let alpha = sa.optimal_alpha;
    let proj = AdmissibleProjection::unit_box(num_dims);
    let zero_perturb = EvidenceState::zeros(n, num_dims);
    let threshold = 0.15;
    let steps = 30;

    // Start with opposing roles (contradiction)
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

    let omega_0 = compute_disagreement(&initial);
    let c_0 = contradiction_count(&initial, threshold);

    println!("  t=0: Ω={:.6}, contradictions={}", omega_0, c_0);

    let mut state = initial;
    let mut prev_omega = omega_0;
    let mut omega_monotone = true;

    println!(
        "\n  {:<4} | {:<12} | {:<14} | {:<6}",
        "t", "Ω(t)", "contradictions", "Ω↓?"
    );
    println!("  {:-<4}-+-{:-<12}-+-{:-<14}-+-{:-<6}", "", "", "", "");

    for t in 1..=steps {
        let result = propagation_step(&sheaf, &state, &zero_perturb, &proj, alpha);
        let c_t = contradiction_count(&result.new_state, threshold);

        if result.disagreement_after > prev_omega + 1e-12 {
            omega_monotone = false;
        }

        if t <= 10 || t % 5 == 0 || t == steps {
            println!(
                "  {:<4} | {:<12.6} | {:<14} | {}",
                t, result.disagreement_after, c_t,
                if result.disagreement_after <= prev_omega + 1e-12 { "✓" } else { "✗" }
            );
        }

        prev_omega = result.disagreement_after;
        state = result.new_state;
    }

    let omega_final = compute_disagreement(&state);
    let c_final = contradiction_count(&state, threshold);

    println!("\n  Final: Ω={:.2e}, contradictions={}", omega_final, c_final);
    println!("  Contraction: Ω_final/Ω_0 = {:.2e}", omega_final / omega_0);

    assert!(omega_monotone, "Ω should be monotonically non-increasing");
    assert!(
        omega_final < omega_0 * 0.01,
        "Ω should contract to < 1% of initial: {:.2e} vs {:.2e}",
        omega_final, omega_0
    );
    assert!(
        c_final < c_0,
        "contradictions should decrease: {} → {}",
        c_0, c_final
    );

    println!("\nResult: diffusion resolves contradictions, Ω contracts to <1% ✓");
}

#[test]
fn bilattice_channel_correctness() {
    println!("\n=== E4.6: Channel discrimination — support-only vs refutation-only ===\n");

    let n = 2;
    let num_dims = 1;

    // Case 1: Only support channel disagrees
    let support_only = EvidenceState {
        role_states: vec![
            EvidenceVector { support: vec![0.9], refutation: vec![0.3] },
            EvidenceVector { support: vec![0.2], refutation: vec![0.3] },
        ],
        num_roles: n,
        num_dims,
    };

    let c_support = extract_contradictions(&support_only, 0.3);
    println!("  Support-only disagreement:");
    for c in &c_support {
        println!("    dim {} {:?} magnitude={:.2}", c.dimension, c.channel, c.magnitude);
    }
    assert_eq!(c_support.len(), 1, "should have exactly 1 contradiction");
    assert_eq!(c_support[0].channel, ContradictionChannel::Support, "should be support channel");

    // Case 2: Only refutation channel disagrees
    let refutation_only = EvidenceState {
        role_states: vec![
            EvidenceVector { support: vec![0.5], refutation: vec![0.9] },
            EvidenceVector { support: vec![0.5], refutation: vec![0.1] },
        ],
        num_roles: n,
        num_dims,
    };

    let c_refutation = extract_contradictions(&refutation_only, 0.3);
    println!("\n  Refutation-only disagreement:");
    for c in &c_refutation {
        println!("    dim {} {:?} magnitude={:.2}", c.dimension, c.channel, c.magnitude);
    }
    assert_eq!(c_refutation.len(), 1, "should have exactly 1 contradiction");
    assert_eq!(c_refutation[0].channel, ContradictionChannel::Refutation, "should be refutation channel");

    // Case 3: Both channels disagree
    let both = EvidenceState {
        role_states: vec![
            EvidenceVector { support: vec![0.9], refutation: vec![0.1] },
            EvidenceVector { support: vec![0.1], refutation: vec![0.9] },
        ],
        num_roles: n,
        num_dims,
    };

    let c_both = extract_contradictions(&both, 0.3);
    println!("\n  Both channels disagree:");
    for c in &c_both {
        println!("    dim {} {:?} magnitude={:.2}", c.dimension, c.channel, c.magnitude);
    }
    assert_eq!(c_both.len(), 2, "should have 2 contradictions (one per channel)");
    let channels: Vec<_> = c_both.iter().map(|c| c.channel).collect();
    assert!(channels.contains(&ContradictionChannel::Support), "should include support");
    assert!(channels.contains(&ContradictionChannel::Refutation), "should include refutation");

    println!("\nResult: channel discrimination correct — support, refutation, and both ✓");
}
