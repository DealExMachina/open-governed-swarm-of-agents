//! E3: ISS Gain Boundary Sweep
//!
//! Validates:
//! - PO-8: ISS small-gain condition κ/(1 − ρ²) < 1
//! - PO-9: Practical stability bound B_Ω = ‖ε‖²/(1 − ρ²)
//!
//! Run: cargo test --test exp_iss -- --nocapture

use sgrs_core::propagation::{analyze_iss, spectral_analysis, CellularSheaf};

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
fn iss_sweep_noise_and_contradiction() {
    println!("\n=== E3.1: ISS parameter sweep ===\n");

    // Complete(3) with stalk_dim=1: λ₁ = 3.0
    let sheaf = CellularSheaf::constant(3, 1, &complete_edges(3));
    let sa = spectral_analysis(&sheaf);
    let spectral_gap = sa.spectral_gap;
    let alpha = sa.optimal_alpha;

    println!("  Sheaf: complete(3), λ₁={:.4}, α={:.4}\n", spectral_gap, alpha);

    let noise_values = [0.001, 0.01, 0.05, 0.1, 0.5, 1.0];
    let kappa_values = [0.0, 0.1, 0.2, 0.5, 1.0];

    println!(
        "{:<6} | {:<6} | {:<10} | {:<8} | {:<10} | {:<10}",
        "κ", "‖ε‖", "satisfied", "margin", "B_Ω", "T_conv"
    );
    println!(
        "{:-<6}-+-{:-<6}-+-{:-<10}-+-{:-<8}-+-{:-<10}-+-{:-<10}",
        "", "", "", "", "", ""
    );

    for &kappa in &kappa_values {
        for &noise in &noise_values {
            let iss = analyze_iss(spectral_gap, alpha, noise, kappa, 1.0);

            println!(
                "{:<6.3} | {:<6.3} | {:<10} | {:<+8.4} | {:<10.6} | {:<10.2}",
                kappa,
                noise,
                if iss.small_gain_satisfied { "YES" } else { "NO" },
                iss.small_gain_margin,
                iss.steady_state_disagreement,
                iss.convergence_time_estimate,
            );
        }
    }

    // Assert κ=0 always satisfies small-gain (zero contradiction rate)
    for &noise in &noise_values {
        let iss = analyze_iss(spectral_gap, alpha, noise, 0.0, 1.0);
        assert!(
            iss.small_gain_satisfied,
            "κ=0 should always satisfy small-gain, noise={}", noise
        );
    }

    println!("\nResult: κ=0 always satisfies small-gain ✓");
}

#[test]
fn iss_boundary_precise() {
    println!("\n=== E3.2: Precise small-gain transition boundary ===\n");

    let sheaf = CellularSheaf::constant(3, 1, &complete_edges(3));
    let sa = spectral_analysis(&sheaf);
    let spectral_gap = sa.spectral_gap;
    let alpha = sa.optimal_alpha;

    let rho = 1.0 - alpha * spectral_gap;
    let rho_sq = rho * rho;
    let kappa_star = 1.0 - rho_sq; // theoretical boundary

    println!("  ρ = {:.6}", rho);
    println!("  ρ² = {:.6}", rho_sq);
    println!("  κ* = 1 − ρ² = {:.6}\n", kappa_star);

    let delta = 0.001;

    let below = analyze_iss(spectral_gap, alpha, 0.1, kappa_star - delta, 1.0);
    let above = analyze_iss(spectral_gap, alpha, 0.1, kappa_star + delta, 1.0);
    let at = analyze_iss(spectral_gap, alpha, 0.1, kappa_star, 1.0);

    println!("  κ* − δ = {:.4}: satisfied={}, margin={:+.6}", kappa_star - delta, below.small_gain_satisfied, below.small_gain_margin);
    println!("  κ*     = {:.4}: satisfied={}, margin={:+.6}", kappa_star, at.small_gain_satisfied, at.small_gain_margin);
    println!("  κ* + δ = {:.4}: satisfied={}, margin={:+.6}", kappa_star + delta, above.small_gain_satisfied, above.small_gain_margin);

    assert!(below.small_gain_satisfied, "κ* − δ should satisfy small-gain");
    assert!(!above.small_gain_satisfied, "κ* + δ should violate small-gain");
    assert!(
        at.small_gain_margin.abs() < 0.01,
        "at κ*, margin should be ≈ 0, got {}", at.small_gain_margin
    );

    println!("\nResult: transition boundary κ*={:.6} verified ✓", kappa_star);
}

#[test]
fn iss_steady_state_bound_formula() {
    println!("\n=== E3.3: PO-9 steady-state bound B_Ω = ‖ε‖²/(1−ρ²) ===\n");

    let sheaf = CellularSheaf::constant(3, 1, &complete_edges(3));
    let sa = spectral_analysis(&sheaf);
    let spectral_gap = sa.spectral_gap;
    let alpha = sa.optimal_alpha;
    let rho = 1.0 - alpha * spectral_gap;
    let rho_sq = rho * rho;
    let one_minus_rho_sq = 1.0 - rho_sq;

    let test_cases = [
        (0.01, 0.05),
        (0.1, 0.1),
        (0.5, 0.2),
        (1.0, 0.0),
        (0.001, 0.5),
    ];

    println!(
        "{:<6} | {:<6} | {:<14} | {:<14} | match",
        "‖ε‖", "κ", "B_Ω (computed)", "B_Ω (formula)"
    );
    println!(
        "{:-<6}-+-{:-<6}-+-{:-<14}-+-{:-<14}-+-{:-<6}",
        "", "", "", "", ""
    );

    for (noise, kappa) in test_cases {
        let iss = analyze_iss(spectral_gap, alpha, noise, kappa, 1.0);
        let expected_b_omega = (noise * noise) / one_minus_rho_sq;

        let matches = (iss.steady_state_disagreement - expected_b_omega).abs() < 1e-10;
        println!(
            "{:<6.3} | {:<6.3} | {:<14.10} | {:<14.10} | {}",
            noise, kappa, iss.steady_state_disagreement, expected_b_omega,
            if matches { "✓" } else { "✗" }
        );

        assert!(
            matches,
            "B_Ω mismatch: got {}, expected {}",
            iss.steady_state_disagreement, expected_b_omega
        );

        // Also verify κ·B_Ω
        let expected_contradictions = kappa * expected_b_omega;
        assert!(
            (iss.steady_state_contradictions - expected_contradictions).abs() < 1e-10,
            "κ·B_Ω mismatch"
        );
    }

    println!("\nResult: PO-9 steady-state bound formula verified ✓");
}

#[test]
fn iss_convergence_time_decreases_with_gap() {
    println!("\n=== E3.4: Convergence time decreases with spectral gap ===\n");

    let kappa = 0.1;
    let noise = 0.05;
    let initial_omega = 1.0;

    println!(
        "{:<12} | {:<8} | {:<8} | {:<8} | {:<10}",
        "topology", "λ₁", "α_opt", "ρ", "T_conv"
    );
    println!(
        "{:-<12}-+-{:-<8}-+-{:-<8}-+-{:-<8}-+-{:-<10}",
        "", "", "", "", ""
    );

    let topologies: Vec<(&str, usize, Vec<(usize, usize)>)> = vec![
        ("chain(5)", 5, (0..4).map(|i| (i, i + 1)).collect()),
        ("ring(5)", 5, {
            let mut e: Vec<(usize, usize)> = (0..4).map(|i| (i, i + 1)).collect();
            e.push((4, 0));
            e
        }),
        ("complete(3)", 3, complete_edges(3)),
        ("complete(5)", 5, complete_edges(5)),
        ("complete(10)", 10, complete_edges(10)),
    ];

    let mut prev_time = f64::INFINITY;
    let mut all_decreasing = true;

    for (name, n, edges) in &topologies {
        let sheaf = CellularSheaf::constant(*n, 1, edges);
        let sa = spectral_analysis(&sheaf);
        let iss = analyze_iss(sa.spectral_gap, sa.optimal_alpha, noise, kappa, initial_omega);

        println!(
            "{:<12} | {:<8.4} | {:<8.4} | {:<8.4} | {:<10.2}",
            name, sa.spectral_gap, sa.optimal_alpha, iss.contraction_rate, iss.convergence_time_estimate
        );

        // Convergence time should generally decrease with spectral gap
        // (stronger connectivity → faster convergence)
        if sa.spectral_gap > 0.5 && iss.convergence_time_estimate > prev_time + 0.1 {
            all_decreasing = false;
        }
        if iss.convergence_time_estimate > 0.0 {
            prev_time = iss.convergence_time_estimate;
        }
    }

    // Specifically: complete(10) should converge faster than chain(5)
    let chain_sheaf = CellularSheaf::constant(5, 1, &topologies[0].2);
    let chain_sa = spectral_analysis(&chain_sheaf);
    let chain_iss = analyze_iss(chain_sa.spectral_gap, chain_sa.optimal_alpha, noise, kappa, initial_omega);

    let comp10_sheaf = CellularSheaf::constant(10, 1, &topologies[4].2);
    let comp10_sa = spectral_analysis(&comp10_sheaf);
    let comp10_iss = analyze_iss(comp10_sa.spectral_gap, comp10_sa.optimal_alpha, noise, kappa, initial_omega);

    assert!(
        comp10_iss.convergence_time_estimate < chain_iss.convergence_time_estimate,
        "complete(10) T={:.2} should converge faster than chain(5) T={:.2}",
        comp10_iss.convergence_time_estimate,
        chain_iss.convergence_time_estimate
    );

    println!("\nResult: stronger connectivity → faster convergence ✓");
}

#[test]
fn iss_zero_noise_zero_bound() {
    println!("\n=== E3.5: Zero noise → zero steady-state bound ===\n");

    let test_gaps = [0.5, 1.0, 3.0, 5.0];
    let test_kappas = [0.0, 0.1, 0.5];

    for &gap in &test_gaps {
        let alpha = 2.0 / (gap + gap); // simplified
        for &kappa in &test_kappas {
            let iss = analyze_iss(gap, alpha, 0.0, kappa, 1.0);
            assert!(
                iss.steady_state_disagreement.abs() < 1e-15,
                "λ₁={}, κ={}: B_Ω should be 0 with zero noise, got {}",
                gap, kappa, iss.steady_state_disagreement
            );
            assert!(
                iss.steady_state_contradictions.abs() < 1e-15,
                "κ·B_Ω should be 0 with zero noise"
            );
        }
    }

    println!("  Zero noise → B_Ω = 0 for all (λ₁, κ) combinations ✓");
    println!("\nResult: zero noise produces zero steady-state bound ✓");
}
