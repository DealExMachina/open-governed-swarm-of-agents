//! E13: Heterogeneous Sheaf — Spectral Characterization
//!
//! Validates that non-identity (projection) restriction maps produce a
//! genuinely different sheaf Laplacian compared to the constant sheaf,
//! while preserving all required mathematical properties:
//!   - E13a: Spectral gap comparison (connected, rho < 1)
//!   - E13b: Fixed-point quality (role expertise preserved)
//!   - E13c: ISS margin under projection sheaf
//!
//! Run: cargo test --test exp_heterogeneous_sheaf -- --nocapture

use sgrs_core::propagation::{
    analyze_iss, compute_disagreement, propagation_step, spectral_analysis, AdmissibleProjection,
    CellularSheaf, EvidenceState, EvidenceVector,
};

// ─── 7-role configuration from propagation.yaml ─────────────────────────────

const NUM_ROLES: usize = 7;
const NUM_DIMS: usize = 4;

fn role_observations() -> Vec<Vec<usize>> {
    vec![
        vec![0],          // facts: claim_confidence
        vec![1],          // drift: contradiction_resolution
        vec![1, 2],       // resolver: contradiction_resolution, goal_completion
        vec![2],          // planner: goal_completion
        vec![3],          // status: risk_score_inverse
        vec![0, 1, 2, 3], // governance: all
        vec![0, 1, 2, 3], // tuner: all
    ]
}

const ROLE_NAMES: [&str; 7] = [
    "facts",
    "drift",
    "resolver",
    "planner",
    "status",
    "governance",
    "tuner",
];

// ─── Topology builders ──────────────────────────────────────────────────────

fn complete_edges(n: usize) -> Vec<(usize, usize)> {
    let mut e = Vec::new();
    for i in 0..n {
        for j in (i + 1)..n {
            e.push((i, j));
        }
    }
    e
}

fn star_edges(n: usize) -> Vec<(usize, usize)> {
    (1..n).map(|i| (0, i)).collect()
}

fn ring_edges(n: usize) -> Vec<(usize, usize)> {
    let mut e: Vec<(usize, usize)> = (0..n - 1).map(|i| (i, i + 1)).collect();
    e.push((n - 1, 0));
    e
}

fn chain_edges(n: usize) -> Vec<(usize, usize)> {
    (0..n - 1).map(|i| (i, i + 1)).collect()
}

fn random_regular_edges(n: usize, degree: usize, seed: u64) -> Vec<(usize, usize)> {
    sgrs_core::propagation::topology::random_regular(n, degree, seed)
        .unwrap_or_else(|| complete_edges(n))
}

struct TopologyCase {
    name: &'static str,
    edges: Vec<(usize, usize)>,
}

fn all_topologies() -> Vec<TopologyCase> {
    vec![
        TopologyCase {
            name: "complete",
            edges: complete_edges(NUM_ROLES),
        },
        TopologyCase {
            name: "star",
            edges: star_edges(NUM_ROLES),
        },
        TopologyCase {
            name: "ring",
            edges: ring_edges(NUM_ROLES),
        },
        TopologyCase {
            name: "chain",
            edges: chain_edges(NUM_ROLES),
        },
        TopologyCase {
            name: "random_regular(3)",
            edges: random_regular_edges(NUM_ROLES, 3, 42),
        },
    ]
}

fn make_disagreement_state() -> EvidenceState {
    let role_states = (0..NUM_ROLES)
        .map(|i| {
            let base = (i as f64 + 1.0) / NUM_ROLES as f64;
            EvidenceVector {
                support: (0..NUM_DIMS)
                    .map(|d| (base + d as f64 * 0.1).min(1.0))
                    .collect(),
                refutation: (0..NUM_DIMS)
                    .map(|d| (1.0 - base + d as f64 * 0.05).min(1.0))
                    .collect(),
            }
        })
        .collect();
    EvidenceState {
        role_states,
        num_roles: NUM_ROLES,
        num_dims: NUM_DIMS,
    }
}

// ─── E13a: Spectral gap comparison ──────────────────────────────────────────

#[test]
fn e13a_spectral_gap_comparison() {
    println!("\n=== E13a: Spectral gap comparison — constant vs projection sheaf ===\n");
    println!(
        "{:<20} | {:>8} {:>8} {:>8} {:>8} {:>10} | {:>8} {:>8} {:>8} {:>8} {:>10}",
        "Topology",
        "λ₁(c)",
        "λmax(c)",
        "α(c)",
        "ρ(c)",
        "mix(c)",
        "λ₁(p)",
        "λmax(p)",
        "α(p)",
        "ρ(p)",
        "mix(p)"
    );
    println!("{}", "-".repeat(130));

    let obs = role_observations();
    let stalk_dim = 2 * NUM_DIMS;

    for tc in all_topologies() {
        let sheaf_const = CellularSheaf::constant(NUM_ROLES, stalk_dim, &tc.edges);
        let sa_const = spectral_analysis(&sheaf_const);

        let sheaf_proj =
            CellularSheaf::from_role_observations(NUM_ROLES, NUM_DIMS, &obs, &tc.edges);
        let sa_proj = spectral_analysis(&sheaf_proj);

        println!(
            "{:<20} | {:>8.4} {:>8.4} {:>8.4} {:>8.4} {:>10.2} | {:>8.4} {:>8.4} {:>8.4} {:>8.4} {:>10.2}",
            tc.name,
            sa_const.spectral_gap, sa_const.lambda_max, sa_const.optimal_alpha, sa_const.contraction_rate, sa_const.mixing_time_estimate,
            sa_proj.spectral_gap, sa_proj.lambda_max, sa_proj.optimal_alpha, sa_proj.contraction_rate, sa_proj.mixing_time_estimate,
        );

        // Projection sheaf should be connected on complete and random_regular
        if tc.name == "complete" || tc.name.starts_with("random") {
            assert!(
                sa_proj.is_connected,
                "{}: projection sheaf should be connected (λ₁ = {})",
                tc.name, sa_proj.spectral_gap
            );
        }

        // Contraction rate must be < 1 when connected
        if sa_proj.is_connected {
            assert!(
                sa_proj.contraction_rate < 1.0,
                "{}: ρ = {} should be < 1",
                tc.name,
                sa_proj.contraction_rate
            );
        }

        // The Laplacians should actually differ (non-trivial sheaf)
        let l_const = sheaf_const.laplacian();
        let l_proj = sheaf_proj.laplacian();
        let diff_norm = (&l_const - &l_proj).norm();
        println!(
            "  ‖L_const - L_proj‖ = {:.6}  (sheaf is {})",
            diff_norm,
            if diff_norm > 1e-10 {
                "non-trivial"
            } else {
                "degenerate"
            }
        );
        assert!(
            diff_norm > 1e-10,
            "{}: projection sheaf Laplacian should differ from constant",
            tc.name
        );
    }

    println!("\nResult: projection sheaf produces distinct, connected Laplacians ✓");
}

// ─── E13b: Fixed-point quality ──────────────────────────────────────────────

#[test]
fn e13b_fixed_point_quality() {
    println!("\n=== E13b: Fixed-point quality — role expertise preserved ===\n");

    let obs = role_observations();
    let stalk_dim = 2 * NUM_DIMS;
    let edges = complete_edges(NUM_ROLES);
    let steps = 50;

    let sheaf_const = CellularSheaf::constant(NUM_ROLES, stalk_dim, &edges);
    let sa_const = spectral_analysis(&sheaf_const);

    let sheaf_proj = CellularSheaf::from_role_observations(NUM_ROLES, NUM_DIMS, &obs, &edges);
    let sa_proj = spectral_analysis(&sheaf_proj);

    let initial = make_disagreement_state();
    let perturbation = EvidenceState::zeros(NUM_ROLES, NUM_DIMS);
    let projection = AdmissibleProjection::unit_box(NUM_DIMS);

    let mut state_const = initial.clone();
    let mut state_proj = initial.clone();

    for _ in 0..steps {
        let r = propagation_step(
            &sheaf_const,
            &state_const,
            &perturbation,
            &projection,
            sa_const.optimal_alpha,
        );
        state_const = r.new_state;

        let r = propagation_step(
            &sheaf_proj,
            &state_proj,
            &perturbation,
            &projection,
            sa_proj.optimal_alpha,
        );
        state_proj = r.new_state;
    }

    println!("After {} steps:\n", steps);
    println!(
        "{:<12} | {:>6} | {:>22} | {:>22}",
        "Role", "Dim", "Constant Sheaf (s,r)", "Projection Sheaf (s,r)"
    );
    println!("{}", "-".repeat(75));

    let dim_names = ["claim_conf", "contra_res", "goal_comp", "risk_inv"];

    for role_idx in 0..NUM_ROLES {
        for (dim_idx, dim_name) in dim_names.iter().enumerate() {
            let cs = &state_const.role_states[role_idx];
            let ps = &state_proj.role_states[role_idx];
            let is_primary = obs[role_idx].contains(&dim_idx);
            println!(
                "{:<12} | {:>6}{} | ({:>8.4}, {:>8.4})   | ({:>8.4}, {:>8.4})",
                if dim_idx == 0 {
                    ROLE_NAMES[role_idx]
                } else {
                    ""
                },
                dim_name,
                if is_primary { "*" } else { " " },
                cs.support[dim_idx],
                cs.refutation[dim_idx],
                ps.support[dim_idx],
                ps.refutation[dim_idx],
            );
        }
    }

    // Key assertion: under projection sheaf, facts-agent's primary dim (claim_confidence=0)
    // should show different behavior from non-primary dims compared to constant sheaf.
    // Specifically, the per-role per-dim disagreement should be lower on primary dims.
    let mean_proj = state_proj.mean();
    let facts_primary_dim = 0; // claim_confidence
    let facts_nonpromary_dim = 3; // risk_score_inverse (not observed by facts)

    let facts_state = &state_proj.role_states[0];
    let primary_disagree =
        (facts_state.support[facts_primary_dim] - mean_proj.support[facts_primary_dim]).powi(2)
            + (facts_state.refutation[facts_primary_dim] - mean_proj.refutation[facts_primary_dim])
                .powi(2);
    let nonpromary_disagree = (facts_state.support[facts_nonpromary_dim]
        - mean_proj.support[facts_nonpromary_dim])
        .powi(2)
        + (facts_state.refutation[facts_nonpromary_dim]
            - mean_proj.refutation[facts_nonpromary_dim])
            .powi(2);

    println!(
        "\nFacts-agent disagreement: primary(dim0) = {:.6}, non-primary(dim3) = {:.6}",
        primary_disagree, nonpromary_disagree
    );

    // Under constant sheaf, all dims converge uniformly.
    // Under projection sheaf, facts (observes only dim 0) is partially decoupled from dim 3,
    // so its dim 3 values may diverge more from the mean.
    let mean_const = state_const.mean();
    let facts_const = &state_const.role_states[0];
    let const_primary = (facts_const.support[facts_primary_dim]
        - mean_const.support[facts_primary_dim])
        .powi(2)
        + (facts_const.refutation[facts_primary_dim] - mean_const.refutation[facts_primary_dim])
            .powi(2);
    let const_nonpromary = (facts_const.support[facts_nonpromary_dim]
        - mean_const.support[facts_nonpromary_dim])
        .powi(2)
        + (facts_const.refutation[facts_nonpromary_dim]
            - mean_const.refutation[facts_nonpromary_dim])
            .powi(2);

    println!(
        "Constant sheaf: primary(dim0) = {:.6}, non-primary(dim3) = {:.6}",
        const_primary, const_nonpromary
    );

    let omega_const = compute_disagreement(&state_const);
    let omega_proj = compute_disagreement(&state_proj);
    println!(
        "\nTotal disagreement: constant = {:.2e}, projection = {:.2e}",
        omega_const, omega_proj
    );

    // Constant sheaf should converge fully (all roles agree)
    assert!(
        omega_const < 0.01,
        "Constant sheaf should converge after {} steps, Ω = {}",
        steps,
        omega_const
    );

    // Projection sheaf: total Ω may stay high because non-shared dims are decoupled.
    // The key structural property is that primary-dim disagreement is low while
    // non-primary-dim disagreement remains (role expertise preserved).
    assert!(
        primary_disagree < nonpromary_disagree || primary_disagree < 0.05,
        "Facts-agent should have lower disagreement on primary dim ({})\n\
         than non-primary dim ({}) under projection sheaf",
        primary_disagree,
        nonpromary_disagree
    );

    println!("\nResult: fixed-point analysis complete — role expertise preserved ✓");
}

// ─── E13c: ISS margin under projection sheaf ────────────────────────────────

#[test]
fn e13c_iss_margin_comparison() {
    println!("\n=== E13c: ISS margin — constant vs projection sheaf ===\n");

    let obs = role_observations();
    let stalk_dim = 2 * NUM_DIMS;
    let kappa = 0.3; // production config max_contradiction_rate

    println!(
        "{:<20} | {:>8} {:>8} {:>10} {:>8} | {:>8} {:>8} {:>10} {:>8}",
        "Topology", "λ₁(c)", "ρ(c)", "margin(c)", "ISS(c)", "λ₁(p)", "ρ(p)", "margin(p)", "ISS(p)"
    );
    println!("{}", "-".repeat(110));

    for tc in all_topologies() {
        let sheaf_const = CellularSheaf::constant(NUM_ROLES, stalk_dim, &tc.edges);
        let sa_const = spectral_analysis(&sheaf_const);
        let iss_const = analyze_iss(
            sa_const.spectral_gap,
            sa_const.optimal_alpha,
            0.15,
            kappa,
            1.0,
        );

        let sheaf_proj =
            CellularSheaf::from_role_observations(NUM_ROLES, NUM_DIMS, &obs, &tc.edges);
        let sa_proj = spectral_analysis(&sheaf_proj);
        let iss_proj = if sa_proj.is_connected {
            analyze_iss(
                sa_proj.spectral_gap,
                sa_proj.optimal_alpha,
                0.15,
                kappa,
                1.0,
            )
        } else {
            analyze_iss(0.0, 0.0, 0.15, kappa, 1.0)
        };

        println!(
            "{:<20} | {:>8.4} {:>8.4} {:>+10.4} {:>8} | {:>8.4} {:>8.4} {:>+10.4} {:>8}",
            tc.name,
            sa_const.spectral_gap,
            iss_const.contraction_rate,
            iss_const.small_gain_margin,
            if iss_const.small_gain_satisfied {
                "YES"
            } else {
                "NO"
            },
            sa_proj.spectral_gap,
            iss_proj.contraction_rate,
            iss_proj.small_gain_margin,
            if iss_proj.small_gain_satisfied {
                "YES"
            } else {
                "NO"
            },
        );

        // For complete topology, ISS should be satisfied for both
        if tc.name == "complete" {
            assert!(
                iss_proj.small_gain_satisfied,
                "Projection sheaf on complete graph should satisfy ISS (margin = {})",
                iss_proj.small_gain_margin
            );
        }
    }

    println!("\nResult: ISS margin analysis complete ✓");
}

// ─── Contraction proptest ───────────────────────────────────────────────────

mod proptests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        /// Projection sheaf Laplacian is always PSD regardless of observation masks.
        #[test]
        fn prop_projection_sheaf_psd(
            n in 3..6usize,
        ) {
            let num_dims = 3;
            let edges: Vec<(usize, usize)> = (0..n-1).map(|i| (i, i+1)).collect();

            // Each role observes at least 1 dim, last role observes all (hub)
            let mut observed: Vec<Vec<usize>> = (0..n-1).map(|i| vec![i % num_dims]).collect();
            observed.push((0..num_dims).collect());

            let sheaf = CellularSheaf::from_role_observations(n, num_dims, &observed, &edges);
            let l_f = sheaf.laplacian();
            let sym = (&l_f + l_f.transpose()) * 0.5;
            let eigen = sym.symmetric_eigen();

            for ev in eigen.eigenvalues.iter() {
                prop_assert!(
                    *ev >= -1e-8,
                    "Eigenvalue {} should be >= 0 (PSD)", ev
                );
            }
        }

        /// Diffusion with projection sheaf contracts (or maintains) disagreement.
        #[test]
        fn prop_projection_sheaf_contraction(
            n in 3..6usize,
        ) {
            let num_dims = 3;
            let edges: Vec<(usize, usize)> = {
                let mut e: Vec<(usize, usize)> = (0..n-1).map(|i| (i, i+1)).collect();
                e.push((n-1, 0)); // ring for connectivity
                e
            };

            // Last role observes all (hub), others observe subsets
            let mut observed: Vec<Vec<usize>> = (0..n-1).map(|i| vec![i % num_dims]).collect();
            observed.push((0..num_dims).collect());

            let sheaf = CellularSheaf::from_role_observations(n, num_dims, &observed, &edges);
            let sa = spectral_analysis(&sheaf);

            if !sa.is_connected || sa.optimal_alpha <= 0.0 {
                return Ok(());
            }

            let state = EvidenceState {
                role_states: (0..n).map(|i| EvidenceVector {
                    support: (0..num_dims).map(|d| (i + d) as f64 / (n + num_dims) as f64).collect(),
                    refutation: (0..num_dims).map(|d| 1.0 - (i + d) as f64 / (n + num_dims) as f64).collect(),
                }).collect(),
                num_roles: n,
                num_dims,
            };

            let omega_before = compute_disagreement(&state);
            if omega_before < 1e-12 {
                return Ok(());
            }

            let perturbation = EvidenceState::zeros(n, num_dims);
            let projection = AdmissibleProjection::unit_box(num_dims);
            let result = propagation_step(&sheaf, &state, &perturbation, &projection, sa.optimal_alpha);

            prop_assert!(
                result.disagreement_after <= omega_before + 1e-8,
                "Disagreement should not increase: {} > {}",
                result.disagreement_after, omega_before
            );
        }
    }
}
