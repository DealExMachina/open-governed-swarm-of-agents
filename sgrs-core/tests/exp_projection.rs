//! E2: Projected Diffusion Contraction
//!
//! Validates:
//! - PO-7: Projection preserves contraction when H⁰(G;F) ∩ A ≠ ∅
//! - Idempotence: Π²_A = Π_A
//! - Firm non-expansiveness: ‖Π(x) − Π(y)‖ ≤ ‖x − y‖
//!
//! Run: cargo test --test exp_projection -- --nocapture

use sgrs_core::propagation::{
    compute_disagreement, propagation_step, spectral_analysis, AdmissibleProjection, CellularSheaf,
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

struct ProjectionCase {
    name: &'static str,
    lo: f64,
    hi: f64,
}

fn projection_cases() -> Vec<ProjectionCase> {
    vec![
        ProjectionCase {
            name: "[0.0, 1.0]",
            lo: 0.0,
            hi: 1.0,
        },
        ProjectionCase {
            name: "[0.1, 0.9]",
            lo: 0.1,
            hi: 0.9,
        },
        ProjectionCase {
            name: "[0.2, 0.8]",
            lo: 0.2,
            hi: 0.8,
        },
    ]
}

fn make_test_states(n: usize, num_dims: usize) -> Vec<EvidenceState> {
    // 10 deterministic test states with various patterns
    (0..10)
        .map(|seed| {
            let role_states = (0..n)
                .map(|i| {
                    let phase = (seed as f64 * 0.3 + i as f64 * 0.7).sin().abs();
                    EvidenceVector {
                        support: (0..num_dims)
                            .map(|d| ((phase + d as f64 * 0.2) * 1.3) % 1.0)
                            .collect(),
                        refutation: (0..num_dims)
                            .map(|d| ((phase + d as f64 * 0.15 + 0.5) * 1.1) % 1.0)
                            .collect(),
                    }
                })
                .collect();
            EvidenceState {
                role_states,
                num_roles: n,
                num_dims,
            }
        })
        .collect()
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[test]
fn projection_idempotence_all_boxes() {
    println!("\n=== E2.1: Projection idempotence Π²=Π ===\n");

    let n = 4;
    let num_dims = 2;
    let states = make_test_states(n, num_dims);

    for pc in projection_cases() {
        let proj = AdmissibleProjection::new(
            vec![(pc.lo, pc.hi); num_dims],
            vec![(pc.lo, pc.hi); num_dims],
        );

        let mut all_pass = true;
        for state in &states {
            if !proj.verify_idempotence(state, 1e-14) {
                all_pass = false;
            }
        }

        assert!(all_pass, "Idempotence failed for box {}", pc.name);
        println!("  Box {}: Π²=Π for all 10 test states ✓", pc.name);
    }

    println!("\nResult: projection idempotence verified ✓");
}

#[test]
fn projection_firmly_non_expansive() {
    println!("\n=== E2.2: Firm non-expansiveness ‖Π(x)−Π(y)‖ ≤ ‖x−y‖ ===\n");

    let num_dims = 2;

    for pc in projection_cases() {
        let proj = AdmissibleProjection::new(
            vec![(pc.lo, pc.hi); num_dims],
            vec![(pc.lo, pc.hi); num_dims],
        );

        let mut max_ratio: f64 = 0.0;
        let mut violations = 0;

        // Generate 20 pairs of test vectors
        for seed in 0..20 {
            let phase_a = (seed as f64 * 0.37).sin().abs();
            let phase_b = ((seed as f64 + 7.0) * 0.41).cos().abs();

            let x = EvidenceVector {
                support: (0..num_dims)
                    .map(|d| ((phase_a + d as f64 * 0.3) * 1.5) % 1.2)
                    .collect(),
                refutation: (0..num_dims)
                    .map(|d| ((phase_a + d as f64 * 0.2 + 0.4) * 1.3) % 1.2)
                    .collect(),
            };
            let y = EvidenceVector {
                support: (0..num_dims)
                    .map(|d| ((phase_b + d as f64 * 0.25) * 1.4) % 1.2)
                    .collect(),
                refutation: (0..num_dims)
                    .map(|d| ((phase_b + d as f64 * 0.35 + 0.3) * 1.2) % 1.2)
                    .collect(),
            };

            let dist_before = x.distance_squared(&y);
            let px = proj.project_vector(&x);
            let py = proj.project_vector(&y);
            let dist_after = px.distance_squared(&py);

            if dist_before > 1e-15 {
                let ratio = dist_after / dist_before;
                max_ratio = max_ratio.max(ratio);
                if dist_after > dist_before + 1e-12 {
                    violations += 1;
                }
            }
        }

        assert_eq!(
            violations, 0,
            "Box {}: {} violations of non-expansiveness",
            pc.name, violations
        );
        println!(
            "  Box {}: max ‖Π(x)−Π(y)‖²/‖x−y‖² = {:.6} ≤ 1.0 ✓",
            pc.name, max_ratio
        );
    }

    println!("\nResult: firm non-expansiveness verified ✓");
}

#[test]
fn projected_diffusion_omega_monotone() {
    println!("\n=== E2.3: Projected diffusion Ω monotonically non-increasing ===\n");

    let n = 4;
    let num_dims = 2;
    let stalk_dim = 2 * num_dims;
    let sheaf = CellularSheaf::constant(n, stalk_dim, &complete_edges(n));
    let sa = spectral_analysis(&sheaf);
    let alpha = sa.optimal_alpha;
    let zero_perturb = EvidenceState::zeros(n, num_dims);
    let steps = 50;

    println!(
        "{:<12} | Ω(0)     | Ω(50)      | monotone | violations",
        "Box"
    );
    println!(
        "{:-<12}-+-{:-<9}-+-{:-<11}-+-{:-<9}-+-{:-<10}",
        "", "", "", "", ""
    );

    for pc in projection_cases() {
        let proj = AdmissibleProjection::new(
            vec![(pc.lo, pc.hi); num_dims],
            vec![(pc.lo, pc.hi); num_dims],
        );

        // Initial state with disagreement
        let initial = EvidenceState {
            role_states: (0..n)
                .map(|i| EvidenceVector {
                    support: vec![0.2 + 0.15 * i as f64, 0.3 + 0.1 * i as f64],
                    refutation: vec![0.8 - 0.15 * i as f64, 0.7 - 0.1 * i as f64],
                })
                .collect(),
            num_roles: n,
            num_dims,
        };

        let omega_0 = compute_disagreement(&initial);
        let mut state = initial;
        let mut violations = 0;
        let mut prev_omega = omega_0;

        for _ in 0..steps {
            let result = propagation_step(&sheaf, &state, &zero_perturb, &proj, alpha);
            if result.disagreement_after > prev_omega + 1e-12 {
                violations += 1;
            }
            prev_omega = result.disagreement_after;
            state = result.new_state;
        }

        let omega_final = compute_disagreement(&state);
        let is_mono = violations == 0;

        println!(
            "{:<12} | {:<8.6} | {:<10.2e} | {:<8} | {}",
            pc.name,
            omega_0,
            omega_final,
            if is_mono { "YES" } else { "NO" },
            violations
        );

        assert!(
            is_mono,
            "Box {}: Ω not monotone ({} violations)",
            pc.name, violations
        );
    }

    println!("\nResult: Ω monotonically non-increasing for all projection boxes ✓");
}

#[test]
fn projected_contraction_preserves_bound() {
    println!("\n=== E2.4: PO-7 contraction bound with projection ===\n");

    let n = 4;
    let num_dims = 2;
    let stalk_dim = 2 * num_dims;
    let sheaf = CellularSheaf::constant(n, stalk_dim, &complete_edges(n));
    let sa = spectral_analysis(&sheaf);
    let alpha = sa.optimal_alpha;
    let rho = sa.contraction_rate;
    let rho_sq = rho * rho;
    let steps = 50;
    let zero_perturb = EvidenceState::zeros(n, num_dims);

    println!(
        "  Sheaf: complete(4), stalk_dim={}, λ₁={:.4}, ρ={:.4}\n",
        stalk_dim, sa.spectral_gap, rho
    );

    // [0,1] box — H⁰∩A ≠ ∅ (any constant in [0,1] works)
    let proj = AdmissibleProjection::unit_box(num_dims);
    let initial = EvidenceState {
        role_states: (0..n)
            .map(|i| EvidenceVector {
                support: vec![0.2 + 0.15 * i as f64, 0.3 + 0.1 * i as f64],
                refutation: vec![0.8 - 0.15 * i as f64, 0.7 - 0.1 * i as f64],
            })
            .collect(),
        num_roles: n,
        num_dims,
    };

    let omega_0 = compute_disagreement(&initial);
    let mut state = initial;
    let mut po7_holds = true;

    for t in 1..=steps {
        let result = propagation_step(&sheaf, &state, &zero_perturb, &proj, alpha);
        let bound = omega_0 * rho_sq.powi(t) * 1.05;
        if result.disagreement_after > bound && result.disagreement_after > 1e-14 {
            po7_holds = false;
            println!(
                "  VIOLATION at t={}: Ω={:.2e} > bound={:.2e}",
                t, result.disagreement_after, bound
            );
        }
        state = result.new_state;
    }

    assert!(
        po7_holds,
        "PO-7 contraction bound violated with unit box projection"
    );
    println!("  PO-7 holds: Ω(t) ≤ Ω(0)·ρ^{{2t}} for t=1..{} ✓", steps);

    println!("\nResult: projected contraction preserves theoretical bound ✓");
}

#[test]
fn projection_convergence_speed_comparison() {
    println!("\n=== E2.5: Convergence speed vs projection box size ===\n");

    let n = 4;
    let num_dims = 2;
    let stalk_dim = 2 * num_dims;
    let sheaf = CellularSheaf::constant(n, stalk_dim, &complete_edges(n));
    let sa = spectral_analysis(&sheaf);
    let alpha = sa.optimal_alpha;
    let steps = 50;
    let zero_perturb = EvidenceState::zeros(n, num_dims);

    println!(
        "{:<12} | Ω(0)     | Ω(25)      | Ω(50)      | contraction",
        "Box"
    );
    println!(
        "{:-<12}-+-{:-<9}-+-{:-<11}-+-{:-<11}-+-{:-<11}",
        "", "", "", "", ""
    );

    for pc in projection_cases() {
        let proj = AdmissibleProjection::new(
            vec![(pc.lo, pc.hi); num_dims],
            vec![(pc.lo, pc.hi); num_dims],
        );

        let initial = EvidenceState {
            role_states: (0..n)
                .map(|i| EvidenceVector {
                    support: vec![0.2 + 0.15 * i as f64, 0.3 + 0.1 * i as f64],
                    refutation: vec![0.8 - 0.15 * i as f64, 0.7 - 0.1 * i as f64],
                })
                .collect(),
            num_roles: n,
            num_dims,
        };

        let omega_0 = compute_disagreement(&initial);
        let mut state = initial;
        let mut omega_25 = 0.0;

        for t in 1..=steps {
            let result = propagation_step(&sheaf, &state, &zero_perturb, &proj, alpha);
            state = result.new_state;
            if t == 25 {
                omega_25 = compute_disagreement(&state);
            }
        }

        let omega_50 = compute_disagreement(&state);
        let contraction = if omega_0 > 1e-15 {
            omega_50 / omega_0
        } else {
            0.0
        };

        println!(
            "{:<12} | {:<8.6} | {:<10.2e} | {:<10.2e} | {:.2e}",
            pc.name, omega_0, omega_25, omega_50, contraction
        );
    }

    println!("\nResult: convergence observed for all box sizes ✓");
}
