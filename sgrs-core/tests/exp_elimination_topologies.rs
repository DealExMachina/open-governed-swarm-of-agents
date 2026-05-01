//! E8-T: Hybrid Pipeline & Tarski Laplacian — Topology Sensitivity
//!
//! Publication-grade experiments extending E8 across 5 topology families
//! and higher dimensions (D=2,4,8). Validates:
//!
//! - E8-T.1: Hybrid pipeline contraction across topologies (chain, ring, star, complete, 3-regular)
//! - E8-T.2: Elimination effectiveness: per-dimension Ω reduction on target dim
//! - E8-T.3: Tarski Laplacian convergence rate vs topology (steps to fixed point)
//! - E8-T.4: Tarski monotonicity (≤_k) across topologies × dimensions
//! - E8-T.5: Scaling: hybrid pipeline on D=2,4,8 × 5 topologies
//!
//! Run: cargo test --test exp_elimination_topologies -- --nocapture

use sgrs_core::propagation::{
    compute_disagreement, per_dimension_disagreement, propagation_step,
    propagation_step_with_elimination, spectral_analysis, tarski_converge, tarski_step,
    AdmissibleProjection, CellularSheaf, EvidenceState, EvidenceVector,
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

/// Deterministic 3-regular graph on 8 vertices (Petersen-like construction).
/// Vertices 0..7, each with degree 3. Manually constructed to avoid RNG.
fn regular3_edges_8() -> Vec<(usize, usize)> {
    vec![
        (0, 1),
        (1, 2),
        (2, 3),
        (3, 4),
        (4, 5),
        (5, 6),
        (6, 7),
        (7, 0), // ring
        (0, 4),
        (1, 5),
        (2, 6),
        (3, 7), // cross-links
    ]
}

struct TopologyCase {
    name: &'static str,
    n: usize,
    edges: Vec<(usize, usize)>,
}

fn all_topologies() -> Vec<TopologyCase> {
    vec![
        TopologyCase {
            name: "chain(8)",
            n: 8,
            edges: chain_edges(8),
        },
        TopologyCase {
            name: "ring(8)",
            n: 8,
            edges: ring_edges(8),
        },
        TopologyCase {
            name: "star(8)",
            n: 8,
            edges: star_edges(8),
        },
        TopologyCase {
            name: "complete(8)",
            n: 8,
            edges: complete_edges(8),
        },
        TopologyCase {
            name: "3-regular(8)",
            n: 8,
            edges: regular3_edges_8(),
        },
    ]
}

/// Build a deterministic initial state with cross-role disagreement.
/// Roles alternate between "supporting" and "opposing" patterns to create
/// nontrivial initial Ω across all dimensions.
fn make_contested_state(n: usize, num_dims: usize) -> EvidenceState {
    let role_states = (0..n)
        .map(|i| {
            let phase = i as f64 / n as f64;
            EvidenceVector {
                support: (0..num_dims)
                    .map(|d| {
                        let base = if i % 2 == 0 { 0.8 } else { 0.2 };
                        (base + d as f64 * 0.05 * (1.0 - 2.0 * phase)).clamp(0.0, 1.0)
                    })
                    .collect(),
                refutation: (0..num_dims)
                    .map(|d| {
                        let base = if i % 2 == 0 { 0.2 } else { 0.7 };
                        (base + d as f64 * 0.03 * phase).clamp(0.0, 1.0)
                    })
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

// ─── E8-T.1: Hybrid pipeline contraction across topologies ──────────────────

#[test]
fn hybrid_contraction_across_topologies() {
    println!("\n=== E8-T.1: Hybrid pipeline contraction across topologies ===\n");

    let num_dims = 4;
    let steps = 30;

    println!(
        "  {:<15} | {:<8} | {:<8} | {:<12} | {:<12} | {:<12} | {:<6}",
        "Topology", "λ₁", "α_opt", "Ω(0)", "Ω_std(30)", "Ω_hyb(30)", "hyb≤std"
    );
    println!(
        "  {:-<15}-+-{:-<8}-+-{:-<8}-+-{:-<12}-+-{:-<12}-+-{:-<12}-+-{:-<6}",
        "", "", "", "", "", "", ""
    );

    for tc in all_topologies() {
        let stalk_dim = 2 * num_dims;
        let sheaf = CellularSheaf::constant(tc.n, stalk_dim, &tc.edges);
        let sa = spectral_analysis(&sheaf);
        let alpha = sa.optimal_alpha;
        let proj = AdmissibleProjection::unit_box(num_dims);
        let zero_perturb = EvidenceState::zeros(tc.n, num_dims);

        let initial = make_contested_state(tc.n, num_dims);
        let omega_0 = compute_disagreement(&initial);

        // Eliminate dim 0 with strong evidence
        let elimination_targets = vec![(0, 0.95)];

        let mut standard = initial.clone();
        let mut hybrid = initial.clone();

        for _ in 1..=steps {
            let std_result = propagation_step(&sheaf, &standard, &zero_perturb, &proj, alpha);
            let hyb_result = propagation_step_with_elimination(
                &sheaf,
                &hybrid,
                &zero_perturb,
                &proj,
                alpha,
                &elimination_targets,
            );
            standard = std_result.new_state;
            hybrid = hyb_result.propagation.new_state;
        }

        let omega_std = compute_disagreement(&standard);
        let omega_hyb = compute_disagreement(&hybrid);
        let pass = omega_hyb <= omega_std + 1e-10;

        println!(
            "  {:<15} | {:<8.4} | {:<8.5} | {:<12.6} | {:<12.6e} | {:<12.6e} | {}",
            tc.name,
            sa.spectral_gap,
            alpha,
            omega_0,
            omega_std,
            omega_hyb,
            if pass { "PASS" } else { "FAIL" }
        );

        assert!(
            pass,
            "{}: hybrid Ω ({:.2e}) should be <= standard Ω ({:.2e})",
            tc.name, omega_hyb, omega_std
        );
    }

    println!(
        "\nResult: hybrid pipeline contracts at least as well as standard on all topologies ✓"
    );
}

// ─── E8-T.2: Per-dimension elimination effectiveness ─────────────────────────

#[test]
fn elimination_per_dimension_across_topologies() {
    println!("\n=== E8-T.2: Per-dimension elimination effectiveness ===\n");

    let num_dims = 4;
    let steps = 20;
    let target_dim = 1;
    let elimination_targets = vec![(target_dim, 0.9)];

    println!(
        "  {:<15} | {:<12} | {:<12} | {:<12} | {:<8}",
        "Topology", "Ω_d_target(0)", "Ω_d_target(T)", "reduction %", "zeroed?"
    );
    println!(
        "  {:-<15}-+-{:-<12}-+-{:-<12}-+-{:-<12}-+-{:-<8}",
        "", "", "", "", ""
    );

    for tc in all_topologies() {
        let stalk_dim = 2 * num_dims;
        let sheaf = CellularSheaf::constant(tc.n, stalk_dim, &tc.edges);
        let sa = spectral_analysis(&sheaf);
        let alpha = sa.optimal_alpha;
        let proj = AdmissibleProjection::unit_box(num_dims);
        let zero_perturb = EvidenceState::zeros(tc.n, num_dims);

        let initial = make_contested_state(tc.n, num_dims);
        let omega_d_0 = per_dimension_disagreement(&initial);

        let mut state = initial;
        for _ in 1..=steps {
            let result = propagation_step_with_elimination(
                &sheaf,
                &state,
                &zero_perturb,
                &proj,
                alpha,
                &elimination_targets,
            );
            state = result.propagation.new_state;
        }

        let omega_d_final = per_dimension_disagreement(&state);
        let reduction = if omega_d_0[target_dim] > 1e-15 {
            100.0 * (1.0 - omega_d_final[target_dim] / omega_d_0[target_dim])
        } else {
            100.0
        };

        // Verify target dim support is near zero for all roles
        let all_zeroed = state
            .role_states
            .iter()
            .all(|r| r.support[target_dim] < 0.05);

        println!(
            "  {:<15} | {:<12.6e} | {:<12.6e} | {:<11.2}% | {}",
            tc.name,
            omega_d_0[target_dim],
            omega_d_final[target_dim],
            reduction,
            if all_zeroed { "YES" } else { "NO" }
        );

        // After 20 hybrid steps, target dim should have very low support
        assert!(
            all_zeroed,
            "{}: target dim {} support should be near 0 after elimination",
            tc.name, target_dim
        );
    }

    // Print non-target dims to show they're preserved
    println!(
        "\n  Per-dimension final Ω (showing all dims, target=dim {}):",
        target_dim
    );
    for tc in all_topologies() {
        let stalk_dim = 2 * num_dims;
        let sheaf = CellularSheaf::constant(tc.n, stalk_dim, &tc.edges);
        let sa = spectral_analysis(&sheaf);
        let alpha = sa.optimal_alpha;
        let proj = AdmissibleProjection::unit_box(num_dims);
        let zero_perturb = EvidenceState::zeros(tc.n, num_dims);

        let initial = make_contested_state(tc.n, num_dims);
        let mut state = initial;
        for _ in 1..=steps {
            let result = propagation_step_with_elimination(
                &sheaf,
                &state,
                &zero_perturb,
                &proj,
                alpha,
                &elimination_targets,
            );
            state = result.propagation.new_state;
        }

        let omega_d = per_dimension_disagreement(&state);
        let formatted: Vec<String> = omega_d
            .iter()
            .enumerate()
            .map(|(d, v)| {
                if d == target_dim {
                    format!("[{:.2e}]*", v)
                } else {
                    format!("{:.2e}", v)
                }
            })
            .collect();
        println!("  {:<15} | Ω_d = {}", tc.name, formatted.join(", "));
    }

    println!("\nResult: elimination zeroes target dimension support across all topologies ✓");
}

// ─── E8-T.3: Tarski convergence rate vs topology ────────────────────────────

#[test]
fn tarski_convergence_across_topologies() {
    println!("\n=== E8-T.3: Tarski Laplacian convergence across topologies ===\n");

    let num_dims = 4;
    let max_steps = 200;
    let tolerance = 1e-14;

    println!(
        "  {:<15} | {:<8} | {:<12} | {:<12} | {:<8} | {:<10}",
        "Topology", "steps", "Ω(0)", "Ω(final)", "ratio", "fixed pt?"
    );
    println!(
        "  {:-<15}-+-{:-<8}-+-{:-<12}-+-{:-<12}-+-{:-<8}-+-{:-<10}",
        "", "", "", "", "", ""
    );

    for tc in all_topologies() {
        let initial = make_contested_state(tc.n, num_dims);
        let omega_0 = compute_disagreement(&initial);

        let (steps, final_state, omegas) =
            tarski_converge(&initial, &tc.edges, max_steps, tolerance);

        let omega_final = *omegas.last().unwrap();
        let ratio = if omega_0 > 1e-15 {
            omega_final / omega_0
        } else {
            0.0
        };

        // Verify fixed point: one more step should not change anything
        let check = tarski_step(&final_state, &tc.edges);
        let is_fixed = !check.any_changed;

        println!(
            "  {:<15} | {:<8} | {:<12.6} | {:<12.6e} | {:<8.4} | {}",
            tc.name,
            steps,
            omega_0,
            omega_final,
            ratio,
            if is_fixed { "YES" } else { "NO" }
        );

        // Tarski must converge before max_steps
        assert!(
            steps < max_steps,
            "{}: Tarski should converge before {} steps",
            tc.name,
            max_steps
        );
        // Must reach a fixed point
        assert!(is_fixed, "{}: should be at fixed point", tc.name);
        // Ω should not increase
        assert!(
            omega_final <= omega_0 + 1e-10,
            "{}: Ω should not increase ({:.6} vs {:.6})",
            tc.name,
            omega_final,
            omega_0
        );
    }

    // Print Ω trajectories for select topologies
    println!("\n  Ω trajectories (first 10 steps):");
    println!(
        "  {:<4} | {:<15} | {:<15} | {:<15}",
        "t", "chain(8)", "complete(8)", "3-regular(8)"
    );
    println!("  {:-<4}-+-{:-<15}-+-{:-<15}-+-{:-<15}", "", "", "", "");

    let topo_select = [
        ("chain(8)", chain_edges(8)),
        ("complete(8)", complete_edges(8)),
        ("3-regular(8)", regular3_edges_8()),
    ];
    let trajectories: Vec<Vec<f64>> = topo_select
        .iter()
        .map(|(_, edges)| {
            let initial = make_contested_state(8, num_dims);
            let (_, _, omegas) = tarski_converge(&initial, edges, max_steps, tolerance);
            omegas
        })
        .collect();

    for t in 0..=10 {
        let vals: Vec<String> = trajectories
            .iter()
            .map(|omegas| {
                if t < omegas.len() {
                    format!("{:<15.6e}", omegas[t])
                } else {
                    format!("{:<15}", "(converged)")
                }
            })
            .collect();
        println!("  {:<4} | {}", t, vals.join(" | "));
    }

    println!("\nResult: Tarski Laplacian converges to fixed point on all topologies ✓");
}

// ─── E8-T.4: Tarski monotonicity across topologies × dimensions ─────────────

#[test]
fn tarski_monotonicity_topologies_and_dims() {
    println!("\n=== E8-T.4: Tarski monotonicity (≤_k) across topologies × dimensions ===\n");

    let dims_to_test = [2, 4, 8];
    let multi_steps = 5;

    println!(
        "  {:<15} | {:<5} | {:<8} | {:<40}",
        "Topology", "D", "steps", "≤_k holds per step"
    );
    println!("  {:-<15}-+-{:-<5}-+-{:-<8}-+-{:-<40}", "", "", "", "");

    for tc in all_topologies() {
        for &num_dims in &dims_to_test {
            let initial = make_contested_state(tc.n, num_dims);
            let mut state = initial;
            let mut step_results: Vec<bool> = Vec::new();

            for _ in 0..multi_steps {
                let result = tarski_step(&state, &tc.edges);

                // Check ≤_k for every role
                let monotone = state
                    .role_states
                    .iter()
                    .zip(result.new_state.role_states.iter())
                    .all(|(before, after)| before.leq_k(after));

                step_results.push(monotone);
                state = result.new_state;
            }

            let all_pass = step_results.iter().all(|&b| b);
            let marks: Vec<&str> = step_results
                .iter()
                .map(|&b| if b { "✓" } else { "✗" })
                .collect();

            println!(
                "  {:<15} | {:<5} | {:<8} | {}  {}",
                tc.name,
                num_dims,
                multi_steps,
                marks.join(" "),
                if all_pass { "" } else { "FAILED" }
            );

            assert!(
                all_pass,
                "{} D={}: monotonicity violated",
                tc.name, num_dims
            );
        }
    }

    println!("\nResult: Tarski step is monotone in ≤_k for all topologies × dimensions ✓");
}

// ─── E8-T.5: Scaling — hybrid pipeline on D=2,4,8 × 5 topologies ───────────

#[test]
fn hybrid_scaling_dims_and_topologies() {
    println!("\n=== E8-T.5: Hybrid pipeline scaling — D × topology ===\n");

    let dims_to_test = [2, 4, 8];
    let steps = 30;

    println!(
        "  {:<15} | {:<4} | {:<10} | {:<12} | {:<12} | {:<12} | {:<10}",
        "Topology", "D", "λ₁", "Ω(0)", "Ω_std(30)", "Ω_hyb(30)", "speedup"
    );
    println!(
        "  {:-<15}-+-{:-<4}-+-{:-<10}-+-{:-<12}-+-{:-<12}-+-{:-<12}-+-{:-<10}",
        "", "", "", "", "", "", ""
    );

    for tc in all_topologies() {
        for &num_dims in &dims_to_test {
            let stalk_dim = 2 * num_dims;
            let sheaf = CellularSheaf::constant(tc.n, stalk_dim, &tc.edges);
            let sa = spectral_analysis(&sheaf);
            let alpha = sa.optimal_alpha;
            let proj = AdmissibleProjection::unit_box(num_dims);
            let zero_perturb = EvidenceState::zeros(tc.n, num_dims);

            let initial = make_contested_state(tc.n, num_dims);
            let omega_0 = compute_disagreement(&initial);

            // Eliminate dim 0 with strong evidence
            let elimination_targets = vec![(0, 0.95)];

            let mut standard = initial.clone();
            let mut hybrid = initial.clone();

            for _ in 1..=steps {
                let std_result = propagation_step(&sheaf, &standard, &zero_perturb, &proj, alpha);
                let hyb_result = propagation_step_with_elimination(
                    &sheaf,
                    &hybrid,
                    &zero_perturb,
                    &proj,
                    alpha,
                    &elimination_targets,
                );
                standard = std_result.new_state;
                hybrid = hyb_result.propagation.new_state;
            }

            let omega_std = compute_disagreement(&standard);
            let omega_hyb = compute_disagreement(&hybrid);

            // Speedup = ratio of contraction factors
            let speedup = if omega_hyb > 1e-15 && omega_std > 1e-15 {
                (omega_std / omega_0).ln() / (omega_hyb / omega_0).ln()
            } else if omega_hyb < 1e-15 {
                f64::INFINITY
            } else {
                1.0
            };

            println!(
                "  {:<15} | {:<4} | {:<10.4} | {:<12.6} | {:<12.6e} | {:<12.6e} | {:<10.4}",
                tc.name,
                num_dims,
                sa.spectral_gap,
                omega_0,
                omega_std,
                omega_hyb,
                if speedup.is_finite() { speedup } else { 99.0 }
            );

            // Hybrid should never be worse
            assert!(
                omega_hyb <= omega_std + 1e-10,
                "{} D={}: hybrid Ω ({:.2e}) > standard Ω ({:.2e})",
                tc.name,
                num_dims,
                omega_hyb,
                omega_std
            );
        }
    }

    // Summary: Tarski vs linear at D=8 across topologies
    println!("\n  --- Tarski vs Linear comparison at D=8 ---\n");
    let num_dims = 8;
    println!(
        "  {:<15} | {:<12} | {:<12} | {:<12} | {:<12}",
        "Topology", "Ω_linear(30)", "Ω_tarski(fp)", "tarski_steps", "tarski_ratio"
    );
    println!(
        "  {:-<15}-+-{:-<12}-+-{:-<12}-+-{:-<12}-+-{:-<12}",
        "", "", "", "", ""
    );

    for tc in all_topologies() {
        let stalk_dim = 2 * num_dims;
        let sheaf = CellularSheaf::constant(tc.n, stalk_dim, &tc.edges);
        let sa = spectral_analysis(&sheaf);
        let alpha = sa.optimal_alpha;
        let proj = AdmissibleProjection::unit_box(num_dims);
        let zero_perturb = EvidenceState::zeros(tc.n, num_dims);

        let initial = make_contested_state(tc.n, num_dims);
        let omega_0 = compute_disagreement(&initial);

        // Linear: 30 steps
        let mut linear = initial.clone();
        for _ in 1..=steps {
            let result = propagation_step(&sheaf, &linear, &zero_perturb, &proj, alpha);
            linear = result.new_state;
        }
        let omega_linear = compute_disagreement(&linear);

        // Tarski: converge to fixed point
        let (tarski_steps, _final_state, tarski_omegas) =
            tarski_converge(&initial, &tc.edges, 200, 1e-14);
        let omega_tarski = *tarski_omegas.last().unwrap();
        let tarski_ratio = if omega_0 > 1e-15 {
            omega_tarski / omega_0
        } else {
            0.0
        };

        println!(
            "  {:<15} | {:<12.6e} | {:<12.6e} | {:<12} | {:<12.4}",
            tc.name, omega_linear, omega_tarski, tarski_steps, tarski_ratio
        );

        // Both should reduce Ω
        assert!(
            omega_linear < omega_0,
            "{}: linear should reduce Ω",
            tc.name
        );
        assert!(
            omega_tarski <= omega_0 + 1e-10,
            "{}: tarski should not increase Ω",
            tc.name
        );
    }

    println!("\nResult: hybrid pipeline scales across dimensions and topologies ✓");
}
