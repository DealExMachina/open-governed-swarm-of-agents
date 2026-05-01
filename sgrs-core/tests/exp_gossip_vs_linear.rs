//! E11: Fair 3-Way Comparison — Linear vs Gossip-Average vs Gossip-Tarski
//!
//! Factorial design isolating two independent axes:
//!   1. Communication pattern: synchronous vs gossip (bilateral)
//!   2. Operator: averaging vs join_k (component-wise MAX)
//!
//! Tests on:
//!   A) Synthetic alternating states (regression baseline)
//!   B) Scaled M&A scenario phases (20-50 nodes, realistic evidence)
//!   C) Multiple topology families (ring, 3-regular, modular, complete)
//!
//! Run: `cargo test --test exp_gossip_vs_linear -- --nocapture`
//! Slow stress (E11.5 n≤1024): `cargo test -p sgrs-core --test exp_gossip_vs_linear e11_5_large_scale -- --ignored --nocapture`

#![allow(clippy::type_complexity)]

mod scenarios;

use sgrs_core::propagation::laplacian::spectral_analysis;
use sgrs_core::propagation::sheaf::CellularSheaf;
use sgrs_core::propagation::{
    compute_disagreement, gossip_average_converge, gossip_converge, EvidenceState, EvidenceVector,
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

fn linear_diffusion_run(
    state: &EvidenceState,
    edges: &[(usize, usize)],
    max_steps: usize,
) -> (EvidenceState, Vec<f64>) {
    use nalgebra::DMatrix;
    let n = state.num_roles;
    let d = state.num_dims;
    let stalk_dim = 2 * d;
    let sheaf = CellularSheaf::constant(n, stalk_dim, edges);
    let l_f = sheaf.laplacian();
    let dim = l_f.nrows();
    let spec = spectral_analysis(&sheaf);
    let alpha = if spec.lambda_max > 0.0 {
        2.0 / (spec.spectral_gap + spec.lambda_max)
    } else {
        0.0
    };
    let identity = DMatrix::identity(dim, dim);
    let diffusion_op = &identity - alpha * &l_f;
    let mut x = nalgebra::DVector::from_vec(state.to_flat());
    let mut omegas = vec![compute_disagreement(state)];
    for _ in 0..max_steps {
        x = &diffusion_op * &x;
        for val in x.iter_mut() {
            *val = val.clamp(0.0, 1.0);
        }
        omegas.push(compute_disagreement(&EvidenceState::from_flat(
            x.as_slice(),
            n,
            d,
        )));
    }
    let final_state = EvidenceState::from_flat(x.as_slice(), n, d);
    (final_state, omegas)
}

fn fmt_vec(v: &[f64]) -> String {
    let parts: Vec<String> = v.iter().map(|x| format!("{:.3}", x)).collect();
    format!("[{}]", parts.join(", "))
}

// ─── E11.1: Synthetic regression (original, kept for baseline) ───────────────

#[test]
fn e11_1_synthetic_regression() {
    println!("\n═══ E11.1: Synthetic 3-Way — Regression Baseline ═══\n");
    println!(
        "{:<10} {:>4} {:>5} {:>6}  {:>10} {:>10} {:>10}",
        "Topology", "n", "|E|", "Steps", "Linear Ω%", "Gos-Avg Ω%", "Gos-Max Ω%"
    );
    println!("{}", "─".repeat(72));

    let topologies: Vec<(&str, fn(usize) -> Vec<(usize, usize)>)> = vec![
        ("chain", chain_edges),
        ("ring", ring_edges),
        ("star", star_edges),
        ("complete", complete_edges),
    ];

    for &(name, build) in &topologies {
        for &n in &[5, 10, 15] {
            if name == "ring" && n < 3 {
                continue;
            }
            let edges = build(n);
            let state = make_contested_state(n, 3);
            let omega_0 = compute_disagreement(&state);

            for &steps in &[5, 20] {
                let (_, lin_om) = linear_diffusion_run(&state, &edges, steps);
                let (_, _, gavg_om) = gossip_average_converge(&state, &edges, steps, 1e-15, 42);
                let (_, _, gmax_om) = gossip_converge(&state, &edges, steps, 1e-15, 42);

                let pct = |om: &[f64]| {
                    if omega_0 > 1e-15 {
                        om.last().unwrap() / omega_0 * 100.0
                    } else {
                        0.0
                    }
                };
                println!(
                    "{:<10} {:>4} {:>5} {:>6}  {:>9.2}% {:>10.2}% {:>10.2}%",
                    name,
                    n,
                    edges.len(),
                    steps,
                    pct(&lin_om),
                    pct(&gavg_om),
                    pct(&gmax_om)
                );
            }
        }
    }
}

// ─── E11.2: Scaled M&A phases on realistic topologies ──────────────────────

#[test]
fn e11_2_scaled_mna_phases() {
    println!("\n═══ E11.2: Scaled M&A Phases — Realistic Node Counts ═══");
    println!("  Scales 7-role base phases to 21/35/49 nodes with jittered evidence\n");
    println!(
        "  {:<14} {:>4} {:>6} {:>5}  {:>8} {:>8} {:>8}  {:>10} {:>10}",
        "Phase", "n", "Topo", "|E|", "Lin%", "GAvg%", "GMax%", "GAvg dist", "GMax dist"
    );
    println!("  {}", "─".repeat(95));

    let max_steps = 100;

    for &n in &[21, 35, 49] {
        let topologies: Vec<(&str, Vec<(usize, usize)>)> = vec![
            ("ring", ring_edges(n)),
            ("3-regular", scenarios::regular3_edges(n)),
            ("modular-7", scenarios::modular_edges(n, 7)),
            ("star", star_edges(n)),
        ];

        for (phase_name, state) in scenarios::scaled_phases(n) {
            let omega_0 = compute_disagreement(&state);
            let true_mean = state.mean();

            for (topo_name, edges) in &topologies {
                let (_, lin_om) = linear_diffusion_run(&state, edges, max_steps);
                let (_, gavg_final, gavg_om) =
                    gossip_average_converge(&state, edges, max_steps, 1e-15, 42);
                let (_, gmax_final, gmax_om) = gossip_converge(&state, edges, max_steps, 1e-15, 42);

                let pct = |om: &[f64]| {
                    if omega_0 > 1e-15 {
                        om.last().unwrap() / omega_0 * 100.0
                    } else {
                        0.0
                    }
                };

                let gavg_dist: f64 = (0..n)
                    .map(|i| gavg_final.role_states[i].distance_squared(&true_mean))
                    .sum::<f64>()
                    .sqrt();
                let gmax_dist: f64 = (0..n)
                    .map(|i| gmax_final.role_states[i].distance_squared(&true_mean))
                    .sum::<f64>()
                    .sqrt();

                println!(
                    "  {:<14} {:>4} {:>6} {:>5}  {:>7.2}% {:>7.2}% {:>7.2}%  {:>10.4} {:>10.4}",
                    phase_name,
                    n,
                    topo_name,
                    edges.len(),
                    pct(&lin_om),
                    pct(&gavg_om),
                    pct(&gmax_om),
                    gavg_dist,
                    gmax_dist
                );
            }
        }
    }
}

// ─── E11.3: Attribution analysis at scale ───────────────────────────────────

#[test]
fn e11_3_attribution_at_scale() {
    println!("\n═══ E11.3: Attribution at Scale — Gossip Comm vs join_k Operator ═══\n");
    println!(
        "  {:<14} {:>4} {:>6}  {:>8} {:>8} {:>8}  {:>10} {:>10} {:>10}",
        "Phase", "n", "Topo", "Lin%", "GAvg%", "GMax%", "Gossip Δ", "join_k Δ", "Winner"
    );
    println!("  {}", "─".repeat(100));

    let max_steps = 50;
    let mut gossip_wins = 0;
    let mut joink_wins = 0;
    let mut both_wins = 0;
    let mut ties = 0;
    let mut total = 0;

    for &n in &[21, 35, 49] {
        let topologies: Vec<(&str, Vec<(usize, usize)>)> = vec![
            ("ring", ring_edges(n)),
            ("3-regular", scenarios::regular3_edges(n)),
            ("modular-7", scenarios::modular_edges(n, 7)),
            ("star", star_edges(n)),
        ];

        for (phase_name, state) in scenarios::scaled_phases(n) {
            let omega_0 = compute_disagreement(&state);

            for (topo_name, edges) in &topologies {
                total += 1;
                let (_, lin_om) = linear_diffusion_run(&state, edges, max_steps);
                let (_, _, gavg_om) = gossip_average_converge(&state, edges, max_steps, 1e-15, 42);
                let (_, _, gmax_om) = gossip_converge(&state, edges, max_steps, 1e-15, 42);

                let lin_pct = lin_om.last().unwrap() / omega_0 * 100.0;
                let gavg_pct = gavg_om.last().unwrap() / omega_0 * 100.0;
                let gmax_pct = gmax_om.last().unwrap() / omega_0 * 100.0;

                let gossip_delta = lin_pct - gavg_pct;
                let joink_delta = gavg_pct - gmax_pct;

                let winner = if gossip_delta > 1.0 && joink_delta > 1.0 {
                    both_wins += 1;
                    "BOTH"
                } else if gossip_delta > 1.0 {
                    gossip_wins += 1;
                    "GOSSIP"
                } else if joink_delta > 1.0 {
                    joink_wins += 1;
                    "JOIN_K"
                } else {
                    ties += 1;
                    "TIE"
                };

                println!(
                    "  {:<14} {:>4} {:>6}  {:>7.2}% {:>7.2}% {:>7.2}%  {:>+9.2}% {:>+9.2}% {:>10}",
                    phase_name,
                    n,
                    topo_name,
                    lin_pct,
                    gavg_pct,
                    gmax_pct,
                    gossip_delta,
                    joink_delta,
                    winner
                );
            }
        }
    }

    println!("\n  Attribution summary ({} configs):", total);
    println!("    Gossip comm wins:   {}", gossip_wins);
    println!("    join_k op wins:     {}", joink_wins);
    println!("    Both win:           {}", both_wins);
    println!("    Tie:                {}", ties);
}

// ─── E11.4: Knowledge monotonicity at scale ────────────────────────────────

#[test]
fn e11_4_knowledge_monotonicity_scaled() {
    println!("\n═══ E11.4: Knowledge Monotonicity — Scaled M&A (n=35) ═══\n");
    println!(
        "  {:<14} {:>6}  {:>10} {:>10} {:>10}",
        "Phase", "Topo", "Linear", "Gos-Avg", "Gos-Max"
    );
    println!("  {}", "─".repeat(58));

    let n = 35;
    let max_steps = 50;

    let topologies: Vec<(&str, Vec<(usize, usize)>)> = vec![
        ("ring", ring_edges(n)),
        ("3-reg", scenarios::regular3_edges(n)),
        ("mod-7", scenarios::modular_edges(n, 7)),
        ("star", star_edges(n)),
    ];

    for (phase_name, state) in scenarios::scaled_phases(n) {
        for (topo_name, edges) in &topologies {
            let (lin_final, _) = linear_diffusion_run(&state, edges, max_steps);
            let lin_mono = (0..n).all(|i| state.role_states[i].leq_k(&lin_final.role_states[i]));

            let (_, gavg_final, _) = gossip_average_converge(&state, edges, max_steps, 1e-15, 42);
            let gavg_mono = (0..n).all(|i| state.role_states[i].leq_k(&gavg_final.role_states[i]));

            let (_, gmax_final, _) = gossip_converge(&state, edges, max_steps, 1e-15, 42);
            let gmax_mono = (0..n).all(|i| state.role_states[i].leq_k(&gmax_final.role_states[i]));

            let tag = |b: bool| if b { "MONO" } else { "NOT MONO" };
            println!(
                "  {:<14} {:>6}  {:>10} {:>10} {:>10}",
                phase_name,
                topo_name,
                tag(lin_mono),
                tag(gavg_mono),
                tag(gmax_mono)
            );

            assert!(
                gmax_mono,
                "{}/{}: gossip-Tarski must be knowledge-monotone",
                phase_name, topo_name
            );
        }
    }
}

// ─── E11.5a: Quick large-n smoke (default `cargo test`) ─────────────────────
//
// Keeps a bounded convergence check without the multi-minute n=1024 grid.

#[test]
fn e11_5_large_scale_quick() {
    let max_steps = 80;
    let n = 128;
    let state = scenarios::scale_phase(&scenarios::phase3_contested_mixed(), n, 0.15, 300);
    let omega_0 = compute_disagreement(&state);
    assert!(omega_0 > 1e-15, "need non-trivial disagreement");
    let edges = scenarios::regular3_edges(n);
    let (_, _, gavg_om) = gossip_average_converge(&state, &edges, max_steps, 1e-10, 42);
    let residual = gavg_om.last().unwrap() / omega_0;
    assert!(
        residual < 0.08,
        "gossip-average should reach <8% residual at n=128 on 3-regular, got {:.2}%",
        residual * 100.0
    );
}

// ─── E11.5: Large-scale stress test (n=256, 512, 1024) ──────────────────────
//
// Tests gossip-average vs gossip-tarski at production scale.
// Linear diffusion is skipped for n≥256 (matrix is 4096×4096 = 134MB+ RAM).
// Uses only sparse topologies (ring, 3-regular, modular).
//
// Ignored by default: routinely exceeds 10+ minutes on CI laptops.

#[test]
#[ignore = "stress (n up to 1024); cargo test -p sgrs-core --test exp_gossip_vs_linear e11_5_large_scale -- --ignored --nocapture"]
fn e11_5_large_scale() {
    println!("\n═══ E11.5: Large-Scale Stress Test (n=256..1024, 100 epochs) ═══\n");
    println!(
        "  {:<14} {:>5} {:>8} {:>5}  {:>8} {:>8} {:>8}  {:>8} {:>8}  {:>10} {:>10}",
        "Phase",
        "n",
        "Topo",
        "|E|",
        "GAvg τ",
        "GAvg%",
        "GMax τ",
        "GMax%",
        "Lin%",
        "GAvg dist",
        "GMax dist"
    );
    println!("  {}", "─".repeat(115));

    let max_steps = 100;

    for &n in &[256, 512, 1024] {
        let topologies: Vec<(&str, Vec<(usize, usize)>)> = vec![
            ("ring", ring_edges(n)),
            ("3-regular", scenarios::regular3_edges(n)),
            ("modular-16", scenarios::modular_edges(n, 16)),
        ];

        // Use P3-contested (most interesting) and P2-financial (high disagreement)
        let phases = vec![
            (
                "P2-scaled",
                scenarios::scale_phase(&scenarios::phase2_financial_dd(), n, 0.12, 200),
            ),
            (
                "P3-scaled",
                scenarios::scale_phase(&scenarios::phase3_contested_mixed(), n, 0.15, 300),
            ),
        ];

        for (phase_name, state) in &phases {
            let omega_0 = compute_disagreement(state);
            let true_mean = state.mean();

            for (topo_name, edges) in &topologies {
                // Gossip-Average
                let t0 = std::time::Instant::now();
                let (gavg_t, gavg_final, gavg_om) =
                    gossip_average_converge(state, edges, max_steps, 1e-10, 42);
                let gavg_ms = t0.elapsed().as_millis();

                // Gossip-Tarski
                let t0 = std::time::Instant::now();
                let (gmax_t, gmax_final, gmax_om) =
                    gossip_converge(state, edges, max_steps, 1e-10, 42);
                let gmax_ms = t0.elapsed().as_millis();

                let gavg_pct = if omega_0 > 1e-15 {
                    gavg_om.last().unwrap() / omega_0 * 100.0
                } else {
                    0.0
                };
                let gmax_pct = if omega_0 > 1e-15 {
                    gmax_om.last().unwrap() / omega_0 * 100.0
                } else {
                    0.0
                };

                let gavg_dist: f64 = (0..n)
                    .map(|i| gavg_final.role_states[i].distance_squared(&true_mean))
                    .sum::<f64>()
                    .sqrt();
                let gmax_dist: f64 = (0..n)
                    .map(|i| gmax_final.role_states[i].distance_squared(&true_mean))
                    .sum::<f64>()
                    .sqrt();

                // Linear only for ring at n=256 (feasible)
                let lin_str = if n <= 256 && *topo_name == "ring" {
                    let (_, lin_om) = linear_diffusion_run(state, edges, max_steps);
                    let lin_pct = if omega_0 > 1e-15 {
                        lin_om.last().unwrap() / omega_0 * 100.0
                    } else {
                        0.0
                    };
                    format!("{:>7.2}%", lin_pct)
                } else {
                    "    —   ".to_string()
                };

                println!(
                    "  {:<14} {:>5} {:>8} {:>5}  {:>4}/{:>3}ms {:>7.2}% {:>4}/{:>3}ms {:>7.2}% {}  {:>10.4} {:>10.4}",
                    phase_name, n, topo_name, edges.len(),
                    gavg_t, gavg_ms, gavg_pct,
                    gmax_t, gmax_ms, gmax_pct,
                    lin_str,
                    gavg_dist, gmax_dist
                );
            }
        }
    }

    // Structural assertion: gossip-average must converge at 1024 nodes
    let n = 1024;
    let state = scenarios::scale_phase(&scenarios::phase3_contested_mixed(), n, 0.15, 300);
    let omega_0 = compute_disagreement(&state);
    let edges = scenarios::regular3_edges(n);
    let (_, _, gavg_om) = gossip_average_converge(&state, &edges, 100, 1e-10, 42);
    let residual = gavg_om.last().unwrap() / omega_0;
    assert!(
        residual < 0.05,
        "gossip-average must converge to <5% residual at n=1024 on 3-regular, got {:.2}%",
        residual * 100.0
    );
}

// ─── E11.6: Fixed-point quality on contested phase ──────────────────────────

#[test]
fn e11_6_fixed_point_quality_scaled() {
    println!("\n═══ E11.5: Fixed-Point Quality — Contested Phase at Scale ═══\n");

    let max_steps = 100;

    for &n in &[21, 35, 49] {
        let state = scenarios::scale_phase(&scenarios::phase3_contested_mixed(), n, 0.15, 300);
        let true_mean = state.mean();
        let omega_0 = compute_disagreement(&state);

        let topologies: Vec<(&str, Vec<(usize, usize)>)> = vec![
            ("ring", ring_edges(n)),
            ("3-regular", scenarios::regular3_edges(n)),
            ("modular-7", scenarios::modular_edges(n, 7)),
        ];

        println!("  n={}, D=4, Ω₀={:.4}", n, omega_0);
        println!("  True mean S={}", fmt_vec(&true_mean.support));
        println!("  True mean R={}", fmt_vec(&true_mean.refutation));
        println!(
            "  {:>10} {:>5}  {:>8} {:>8} {:>8}  {:>10} {:>10}  {:>6} {:>6}",
            "Topo", "|E|", "Lin%", "GAvg%", "GMax%", "GAvg dist", "GMax dist", "GAvg C", "GMax C"
        );
        println!("  {}", "─".repeat(85));

        for (topo_name, edges) in &topologies {
            let (_lin_final, lin_om) = linear_diffusion_run(&state, edges, max_steps);
            let (_, gavg_final, gavg_om) =
                gossip_average_converge(&state, edges, max_steps, 1e-15, 42);
            let (_, gmax_final, gmax_om) = gossip_converge(&state, edges, max_steps, 1e-15, 42);

            let pct = |om: &[f64]| {
                if omega_0 > 1e-15 {
                    om.last().unwrap() / omega_0 * 100.0
                } else {
                    0.0
                }
            };
            let dist = |final_st: &EvidenceState| -> f64 {
                (0..n)
                    .map(|i| final_st.role_states[i].distance_squared(&true_mean))
                    .sum::<f64>()
                    .sqrt()
            };
            let contradictions = |final_st: &EvidenceState| -> usize {
                (0..n)
                    .map(|i| final_st.role_states[i].contradiction_dimensions(0.4).len())
                    .sum()
            };

            println!(
                "  {:>10} {:>5}  {:>7.2}% {:>7.2}% {:>7.2}%  {:>10.4} {:>10.4}  {:>6} {:>6}",
                topo_name,
                edges.len(),
                pct(&lin_om),
                pct(&gavg_om),
                pct(&gmax_om),
                dist(&gavg_final),
                dist(&gmax_final),
                contradictions(&gavg_final),
                contradictions(&gmax_final)
            );
        }
        println!();
    }
}
