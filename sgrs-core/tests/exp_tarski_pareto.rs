//! E9: Tarski vs Linear Pareto Cost — Scaling with n
//!
//! Sweeps n = 3..20 across 4 topologies (chain, ring, star, complete) and compares:
//! - Linear diffusion: Ω after 100 steps, steps to Ω < 1% of initial
//! - Tarski Laplacian: steps to fixed point, residual Ω/Ω₀
//! - Pareto cost: |E| × τ (total communication to convergence)
//! - Normalized cost: |E| × τ / (1 − Ω_final/Ω₀) (cost per unit of Ω reduction)
//!
//! Run: cargo test --test exp_tarski_pareto -- --nocapture

use sgrs_core::propagation::{
    compute_disagreement, propagation_step, spectral_analysis, tarski_converge,
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

/// Deterministic contested initial state: alternating support/refute roles.
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

struct TopoFactory {
    name: &'static str,
    build: fn(usize) -> Vec<(usize, usize)>,
    min_n: usize,
}

fn topology_factories() -> Vec<TopoFactory> {
    vec![
        TopoFactory {
            name: "chain",
            build: chain_edges,
            min_n: 2,
        },
        TopoFactory {
            name: "ring",
            build: ring_edges,
            min_n: 3,
        },
        TopoFactory {
            name: "star",
            build: star_edges,
            min_n: 2,
        },
        TopoFactory {
            name: "complete",
            build: complete_edges,
            min_n: 2,
        },
    ]
}

/// Run linear diffusion until Ω < threshold or max_steps.
/// Returns (steps_to_threshold, final_omega).
fn linear_converge(
    sheaf: &CellularSheaf,
    initial: &EvidenceState,
    proj: &AdmissibleProjection,
    alpha: f64,
    max_steps: usize,
    threshold_ratio: f64,
) -> (usize, f64) {
    let omega_0 = compute_disagreement(initial);
    let target = omega_0 * threshold_ratio;
    let zero_perturb = EvidenceState::zeros(initial.num_roles, initial.num_dims);

    let mut state = initial.clone();
    for step in 1..=max_steps {
        let result = propagation_step(sheaf, &state, &zero_perturb, proj, alpha);
        if result.disagreement_after < target {
            return (step, result.disagreement_after);
        }
        state = result.new_state;
    }
    let omega_final = compute_disagreement(&state);
    (max_steps, omega_final)
}

// ─── E9.1: Linear vs Tarski — n sweep ──────────────────────────────────────

#[test]
fn linear_vs_tarski_n_sweep() {
    println!("\n=== E9.1: Linear vs Tarski — n = 3..20, D = 4 ===\n");

    let num_dims = 4;
    let max_steps_linear = 500;
    let max_steps_tarski = 500;
    let convergence_threshold = 0.01; // Ω < 1% of initial

    for factory in topology_factories() {
        println!("  --- {} ---", factory.name);
        println!(
            "  {:<4} | {:<5} | {:<8} | {:<10} | {:<10} | {:<10} | {:<10} | {:<10} | {:<10} | {:<8}",
            "n",
            "|E|",
            "λ₁",
            "τ_lin",
            "Ω_lin/Ω₀",
            "τ_tar",
            "Ω_tar/Ω₀",
            "cost_lin",
            "cost_tar",
            "winner"
        );
        println!(
            "  {:-<4}-+-{:-<5}-+-{:-<8}-+-{:-<10}-+-{:-<10}-+-{:-<10}-+-{:-<10}-+-{:-<10}-+-{:-<10}-+-{:-<8}",
            "", "", "", "", "", "", "", "", "", ""
        );

        for n in 3..=20 {
            if n < factory.min_n {
                continue;
            }

            let edges = (factory.build)(n);
            let num_edges = edges.len();
            let stalk_dim = 2 * num_dims;
            let sheaf = CellularSheaf::constant(n, stalk_dim, &edges);
            let sa = spectral_analysis(&sheaf);
            let alpha = sa.optimal_alpha;
            let proj = AdmissibleProjection::unit_box(num_dims);

            let initial = make_contested_state(n, num_dims);
            let omega_0 = compute_disagreement(&initial);

            // Linear: steps to Ω < 1%
            let (tau_lin, omega_lin) = linear_converge(
                &sheaf,
                &initial,
                &proj,
                alpha,
                max_steps_linear,
                convergence_threshold,
            );
            let ratio_lin = omega_lin / omega_0;

            // Tarski: converge to fixed point
            let (tau_tar, _final_state, tarski_omegas) =
                tarski_converge(&initial, &edges, max_steps_tarski, 1e-14);
            let omega_tar = *tarski_omegas.last().unwrap();
            let ratio_tar = omega_tar / omega_0;

            // Pareto cost: |E| × τ (raw communication cost)
            let cost_lin = num_edges as f64 * tau_lin as f64;
            let cost_tar = num_edges as f64 * tau_tar as f64;

            // Normalized cost: |E| × τ / (1 - Ω_final/Ω₀)
            // Accounts for quality of convergence
            let norm_cost_lin = if ratio_lin < 1.0 - 1e-10 {
                cost_lin / (1.0 - ratio_lin)
            } else {
                f64::INFINITY
            };
            let norm_cost_tar = if ratio_tar < 1.0 - 1e-10 {
                cost_tar / (1.0 - ratio_tar)
            } else {
                f64::INFINITY
            };

            let winner = if norm_cost_tar < norm_cost_lin {
                "TARSKI"
            } else {
                "LINEAR"
            };

            println!(
                "  {:<4} | {:<5} | {:<8.4} | {:<10} | {:<10.4e} | {:<10} | {:<10.4e} | {:<10.1} | {:<10.1} | {:<8}",
                n, num_edges, sa.spectral_gap,
                tau_lin, ratio_lin,
                tau_tar, ratio_tar,
                norm_cost_lin, norm_cost_tar,
                winner
            );

            // Both must reduce Ω (basic sanity)
            assert!(
                omega_lin <= omega_0 + 1e-10,
                "{} n={}: linear should not increase Ω",
                factory.name,
                n
            );
            assert!(
                omega_tar <= omega_0 + 1e-10,
                "{} n={}: tarski should not increase Ω",
                factory.name,
                n
            );
        }
        println!();
    }

    println!("Result: linear vs tarski n-sweep complete ✓");
}

// ─── E9.2: Crossover analysis — where does Tarski beat linear? ──────────────

#[test]
fn tarski_crossover_analysis() {
    println!("\n=== E9.2: Tarski advantage analysis — normalized cost ratio ===\n");

    let num_dims = 4;
    let max_steps = 500;
    let convergence_threshold = 0.01;

    println!(
        "  {:<12} | {:<4} | {:<10} | {:<10} | {:<10} | {:<12}",
        "Topology", "n", "norm_lin", "norm_tar", "ratio T/L", "advantage"
    );
    println!(
        "  {:-<12}-+-{:-<4}-+-{:-<10}-+-{:-<10}-+-{:-<10}-+-{:-<12}",
        "", "", "", "", "", ""
    );

    let mut tarski_wins = 0;
    let mut linear_wins = 0;
    let mut total = 0;

    for factory in topology_factories() {
        for n in 3..=20 {
            if n < factory.min_n {
                continue;
            }

            let edges = (factory.build)(n);
            let num_edges = edges.len();
            let stalk_dim = 2 * num_dims;
            let sheaf = CellularSheaf::constant(n, stalk_dim, &edges);
            let sa = spectral_analysis(&sheaf);
            let alpha = sa.optimal_alpha;
            let proj = AdmissibleProjection::unit_box(num_dims);

            let initial = make_contested_state(n, num_dims);
            let omega_0 = compute_disagreement(&initial);

            let (tau_lin, omega_lin) = linear_converge(
                &sheaf,
                &initial,
                &proj,
                alpha,
                max_steps,
                convergence_threshold,
            );
            let ratio_lin = omega_lin / omega_0;

            let (tau_tar, _fs, tarski_omegas) = tarski_converge(&initial, &edges, max_steps, 1e-14);
            let omega_tar = *tarski_omegas.last().unwrap();
            let ratio_tar = omega_tar / omega_0;

            let cost_lin = num_edges as f64 * tau_lin as f64;
            let cost_tar = num_edges as f64 * tau_tar as f64;

            let norm_lin = if ratio_lin < 1.0 - 1e-10 {
                cost_lin / (1.0 - ratio_lin)
            } else {
                f64::INFINITY
            };
            let norm_tar = if ratio_tar < 1.0 - 1e-10 {
                cost_tar / (1.0 - ratio_tar)
            } else {
                f64::INFINITY
            };

            let ratio = norm_tar / norm_lin;
            let advantage = if ratio < 0.9 {
                "TARSKI >10%"
            } else if ratio < 1.0 {
                "tarski"
            } else if ratio > 1.1 {
                "LINEAR >10%"
            } else {
                "~equal"
            };

            total += 1;
            if norm_tar < norm_lin {
                tarski_wins += 1;
            } else {
                linear_wins += 1;
            }

            println!(
                "  {:<12} | {:<4} | {:<10.1} | {:<10.1} | {:<10.4} | {:<12}",
                factory.name, n, norm_lin, norm_tar, ratio, advantage
            );
        }
    }

    println!(
        "\n  Summary: Tarski wins {}/{} configs, Linear wins {}/{}",
        tarski_wins, total, linear_wins, total
    );
    println!("  (normalized cost = |E| × τ / (1 − Ω_final/Ω₀))");

    println!("\nResult: crossover analysis complete ✓");
}

// ─── E9.3: Scaling exponents — log-log regression ───────────────────────────

#[test]
fn scaling_exponents() {
    println!("\n=== E9.3: Scaling exponents — how cost grows with n ===\n");

    let num_dims = 4;
    let max_steps = 500;
    let convergence_threshold = 0.01;

    for factory in topology_factories() {
        let mut log_n_vals: Vec<f64> = Vec::new();
        let mut log_cost_lin: Vec<f64> = Vec::new();
        let mut log_cost_tar: Vec<f64> = Vec::new();

        for n in 3..=20 {
            if n < factory.min_n {
                continue;
            }

            let edges = (factory.build)(n);
            let num_edges = edges.len();
            let stalk_dim = 2 * num_dims;
            let sheaf = CellularSheaf::constant(n, stalk_dim, &edges);
            let sa = spectral_analysis(&sheaf);
            let alpha = sa.optimal_alpha;
            let proj = AdmissibleProjection::unit_box(num_dims);

            let initial = make_contested_state(n, num_dims);
            let omega_0 = compute_disagreement(&initial);

            let (tau_lin, omega_lin) = linear_converge(
                &sheaf,
                &initial,
                &proj,
                alpha,
                max_steps,
                convergence_threshold,
            );
            let ratio_lin = omega_lin / omega_0;

            let (tau_tar, _fs, tarski_omegas) = tarski_converge(&initial, &edges, max_steps, 1e-14);
            let omega_tar = *tarski_omegas.last().unwrap();
            let ratio_tar = omega_tar / omega_0;

            let cost_lin = num_edges as f64 * tau_lin as f64;
            let cost_tar = num_edges as f64 * tau_tar as f64;

            let norm_lin = if ratio_lin < 1.0 - 1e-10 {
                cost_lin / (1.0 - ratio_lin)
            } else {
                cost_lin * 100.0 // penalize non-convergence
            };
            let norm_tar = if ratio_tar < 1.0 - 1e-10 {
                cost_tar / (1.0 - ratio_tar)
            } else {
                cost_tar * 100.0
            };

            log_n_vals.push((n as f64).ln());
            log_cost_lin.push(norm_lin.ln());
            log_cost_tar.push(norm_tar.ln());
        }

        // Simple linear regression: log(cost) = β × log(n) + c  →  cost ∝ n^β
        let beta_lin = log_log_slope(&log_n_vals, &log_cost_lin);
        let beta_tar = log_log_slope(&log_n_vals, &log_cost_tar);

        println!(
            "  {:<12}: linear β = {:<6.2} (cost ∝ n^{:.2}), tarski β = {:<6.2} (cost ∝ n^{:.2})",
            factory.name, beta_lin, beta_lin, beta_tar, beta_tar
        );
    }

    println!("\n  β interpretation: 1 = linear, 2 = quadratic, 3 = cubic");
    println!("  Lower β = better scaling with n");

    println!("\nResult: scaling exponents computed ✓");
}

/// OLS slope for log-log regression.
fn log_log_slope(x: &[f64], y: &[f64]) -> f64 {
    let n = x.len() as f64;
    let sum_x: f64 = x.iter().sum();
    let sum_y: f64 = y.iter().sum();
    let sum_xy: f64 = x.iter().zip(y.iter()).map(|(a, b)| a * b).sum();
    let sum_xx: f64 = x.iter().map(|a| a * a).sum();

    (n * sum_xy - sum_x * sum_y) / (n * sum_xx - sum_x * sum_x)
}
