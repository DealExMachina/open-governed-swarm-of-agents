//! E1: Spectral Topology Sensitivity
//!
//! Validates:
//! - Claim 1: L_F = δᵀδ is positive semidefinite
//! - Claim 2: λ₁ > 0 for connected sheaf (spectral gap)
//! - PO-6: Diffusion contraction Ω((I−αL_F)x) ≤ ρ²Ω(x)
//!
//! Run: cargo test --test exp_spectral -- --nocapture

use sgrs_core::propagation::{
    compute_disagreement, propagation_step, spectral_analysis, AdmissibleProjection, CellularSheaf,
    EvidenceState, EvidenceVector,
};

// ─── Topology builders ──────────────────────────────────────────────────────

fn chain_edges(n: usize) -> Vec<(usize, usize)> {
    (0..n - 1).map(|i| (i, i + 1)).collect()
}

fn ring_edges(n: usize) -> Vec<(usize, usize)> {
    let mut e = chain_edges(n);
    e.push((n - 1, 0));
    e
}

fn star_edges(n: usize) -> Vec<(usize, usize)> {
    (1..n).map(|i| (0, i)).collect()
}

fn complete_edges(n: usize) -> Vec<(usize, usize)> {
    let mut e = Vec::new();
    for i in 0..n {
        for j in (i + 1)..n {
            e.push((i, j));
        }
    }
    e
}

/// Build a deterministic initial state with disagreement.
/// Role i gets support[0] = (i+1)/n, refutation[0] = 1 - support[0].
fn make_initial_state(n: usize, num_dims: usize) -> EvidenceState {
    let role_states = (0..n)
        .map(|i| {
            let base = (i as f64 + 1.0) / n as f64;
            EvidenceVector {
                support: (0..num_dims)
                    .map(|d| (base + d as f64 * 0.1).min(1.0))
                    .collect(),
                refutation: (0..num_dims)
                    .map(|d| (1.0 - base + d as f64 * 0.05).min(1.0))
                    .collect(),
            }
        })
        .collect();
    EvidenceState {
        role_states,
        num_roles: n,
        num_dims,
    }
}

struct TopologyCase {
    name: &'static str,
    n: usize,
    edges: Vec<(usize, usize)>,
}

fn all_topologies() -> Vec<TopologyCase> {
    vec![
        TopologyCase {
            name: "chain(5)",
            n: 5,
            edges: chain_edges(5),
        },
        TopologyCase {
            name: "ring(5)",
            n: 5,
            edges: ring_edges(5),
        },
        TopologyCase {
            name: "star(5)",
            n: 5,
            edges: star_edges(5),
        },
        TopologyCase {
            name: "complete(5)",
            n: 5,
            edges: complete_edges(5),
        },
        TopologyCase {
            name: "complete(10)",
            n: 10,
            edges: complete_edges(10),
        },
    ]
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[test]
fn spectral_laplacian_psd() {
    println!("\n=== E1.1: Laplacian positive semi-definiteness ===\n");
    println!("{:<15} | eigenvalues (first 5)", "Topology");
    println!("{:-<15}-+-{:-<50}", "", "");

    for tc in all_topologies() {
        let sheaf = CellularSheaf::constant(tc.n, 1, &tc.edges);
        let sa = spectral_analysis(&sheaf);

        // All eigenvalues must be >= -eps (PSD)
        let min_eigenvalue = sa.eigenvalues.iter().cloned().fold(f64::INFINITY, f64::min);
        assert!(
            min_eigenvalue >= -1e-10,
            "{}: min eigenvalue {} is negative (not PSD)",
            tc.name,
            min_eigenvalue
        );

        let display: Vec<String> = sa
            .eigenvalues
            .iter()
            .take(5)
            .map(|e| format!("{:.4}", e))
            .collect();
        println!("{:<15} | {}", tc.name, display.join(", "));
    }

    println!("\nResult: ALL topologies have PSD Laplacian ✓");
}

#[test]
fn spectral_gap_connected() {
    println!("\n=== E1.2: Spectral gap for connected graphs ===\n");
    println!("{:<15} | λ₁       | connected", "Topology");
    println!("{:-<15}-+-{:-<10}-+-{:-<10}", "", "", "");

    for tc in all_topologies() {
        let sheaf = CellularSheaf::constant(tc.n, 1, &tc.edges);
        let sa = spectral_analysis(&sheaf);

        assert!(sa.is_connected, "{}: should be connected", tc.name);
        assert!(sa.spectral_gap > 0.0, "{}: λ₁ should be > 0", tc.name);

        println!(
            "{:<15} | {:<8.4} | {}",
            tc.name, sa.spectral_gap, sa.is_connected
        );
    }

    // Disconnected graph: two isolated components
    // For a disconnected graph with k components (stalk_dim=1), ker(L_F) has
    // dimension k, so there are k zero eigenvalues. The spectral gap (smallest
    // nonzero eigenvalue) is still > 0 because within-component edges exist.
    // The correct connectivity test is: dim(ker L_F) == stalk_dim.
    let sheaf_dc = CellularSheaf::constant(4, 1, &[(0, 1), (2, 3)]);
    let sa_dc = spectral_analysis(&sheaf_dc);
    let zero_eigenvalues_dc = sa_dc
        .eigenvalues
        .iter()
        .filter(|&&e| e.abs() < 1e-10)
        .count();
    assert_eq!(
        zero_eigenvalues_dc, 2,
        "disconnected 2-component graph should have 2 zero eigenvalues, got {}",
        zero_eigenvalues_dc
    );
    println!(
        "{:<15} | {:<8.4} | dim(ker)={} (2 components → 2 zero eigenvalues)",
        "2-comp(4)", sa_dc.spectral_gap, zero_eigenvalues_dc
    );

    // Isolated node (no edges at all)
    let sheaf_isolated = CellularSheaf::constant(3, 1, &[]);
    let sa_isolated = spectral_analysis(&sheaf_isolated);
    assert!(
        !sa_isolated.is_connected,
        "isolated nodes should have is_connected=false"
    );
    println!(
        "{:<15} | {:<8.4} | is_connected={} (no edges)",
        "isolated(3)", sa_isolated.spectral_gap, sa_isolated.is_connected
    );

    println!(
        "\nResult: spectral gap positive for connected, kernel dimension reveals components ✓"
    );
}

#[test]
fn spectral_gap_ordering() {
    println!("\n=== E1.3: Spectral gap ordering (graph theory) ===\n");

    let gaps: Vec<(String, f64)> = all_topologies()
        .iter()
        .map(|tc| {
            let sheaf = CellularSheaf::constant(tc.n, 1, &tc.edges);
            let sa = spectral_analysis(&sheaf);
            (tc.name.to_string(), sa.spectral_gap)
        })
        .collect();

    for (name, gap) in &gaps {
        println!("  {:<15}: λ₁ = {:.6}", name, gap);
    }

    // Known ordering: chain < ring < complete (for same n)
    let chain5 = gaps[0].1;
    let ring5 = gaps[1].1;
    let complete5 = gaps[3].1;

    assert!(
        chain5 < ring5,
        "chain(5) λ₁={:.4} should < ring(5) λ₁={:.4}",
        chain5,
        ring5
    );
    assert!(
        ring5 < complete5,
        "ring(5) λ₁={:.4} should < complete(5) λ₁={:.4}",
        ring5,
        complete5
    );

    println!(
        "\nOrdering: chain({:.4}) < ring({:.4}) < complete({:.4}) ✓",
        chain5, ring5, complete5
    );
}

#[test]
fn diffusion_contraction_exponential() {
    println!("\n=== E1.4: Diffusion contraction — PO-6 validation ===\n");
    println!(
        "{:<15} | λ₁      | α_opt   | ρ_theory | ρ_empirical | Ω(0)     | Ω(100)      | PO-6",
        "Topology"
    );
    println!(
        "{:-<15}-+-{:-<8}-+-{:-<8}-+-{:-<9}-+-{:-<12}-+-{:-<9}-+-{:-<12}-+-{:-<6}",
        "", "", "", "", "", "", "", ""
    );

    let steps = 100;
    let num_dims = 1;

    for tc in all_topologies() {
        let stalk_dim = 2 * num_dims; // support + refutation
        let sheaf = CellularSheaf::constant(tc.n, stalk_dim, &tc.edges);
        let sa = spectral_analysis(&sheaf);
        let alpha = sa.optimal_alpha;
        let rho = sa.contraction_rate;
        let rho_sq = rho * rho;

        let projection = AdmissibleProjection::unit_box(num_dims);
        let zero_perturbation = EvidenceState::zeros(tc.n, num_dims);

        let initial = make_initial_state(tc.n, num_dims);
        let omega_0 = compute_disagreement(&initial);

        let mut state = initial;
        let mut po6_holds = true;

        for t in 1..=steps {
            let result = propagation_step(&sheaf, &state, &zero_perturbation, &projection, alpha);
            let theoretical_bound = omega_0 * rho_sq.powi(t) * 1.05; // 5% tolerance
            if result.disagreement_after > theoretical_bound && result.disagreement_after > 1e-14 {
                po6_holds = false;
            }
            state = result.new_state;
        }

        let omega_final = compute_disagreement(&state);
        let empirical_rho = if omega_0 > 1e-15 && omega_final > 1e-15 {
            (omega_final / omega_0).powf(1.0 / (2.0 * steps as f64))
        } else {
            0.0
        };

        println!(
            "{:<15} | {:<7.4} | {:<7.4} | {:<8.4}  | {:<11.4}  | {:<8.6} | {:<11.2e} | {}",
            tc.name,
            sa.spectral_gap,
            alpha,
            rho,
            empirical_rho,
            omega_0,
            omega_final,
            if po6_holds { "PASS" } else { "FAIL" }
        );

        assert!(po6_holds, "{}: PO-6 contraction bound violated", tc.name);
    }

    println!("\nResult: PO-6 contraction bound holds for all topologies ✓");
}

#[test]
fn spectral_kernel_is_consensus() {
    println!("\n=== E1.5: ker(L_F) = H⁰(G;F) = consensus vectors ===\n");

    for tc in all_topologies() {
        let sheaf = CellularSheaf::constant(tc.n, 1, &tc.edges);
        let sa = spectral_analysis(&sheaf);

        // For a connected constant sheaf with stalk_dim=1, ker(L_F) has dimension 1
        let zero_eigenvalues = sa.eigenvalues.iter().filter(|&&e| e.abs() < 1e-10).count();
        assert_eq!(
            zero_eigenvalues, 1,
            "{}: expected 1 zero eigenvalue (connected, stalk_dim=1), got {}",
            tc.name, zero_eigenvalues
        );
        println!("  {:<15}: dim(ker L_F) = {} ✓", tc.name, zero_eigenvalues);
    }

    // Higher stalk_dim: constant sheaf with stalk_dim=3 on complete(4)
    let sheaf3 = CellularSheaf::constant(4, 3, &complete_edges(4));
    let sa3 = spectral_analysis(&sheaf3);
    let zero3 = sa3.eigenvalues.iter().filter(|&&e| e.abs() < 1e-10).count();
    assert_eq!(
        zero3, 3,
        "constant sheaf stalk_dim=3 should have dim(ker)=3, got {}",
        zero3
    );
    println!(
        "  {:<15}: dim(ker L_F) = {} (stalk_dim=3) ✓",
        "complete(4)", zero3
    );

    println!("\nResult: kernel dimension = stalk_dim for all connected topologies ✓");
}
