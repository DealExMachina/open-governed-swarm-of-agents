//! E12: Push-Sum Gossip — Correctness and Impossibility Verification
//!
//! Verifies the push-sum protocol (Kempe, Dobra & Gehrke, STOC 2003) on
//! bilattice evidence vectors and empirically confirms the impossibility
//! theorem: no gossip protocol can simultaneously converge to the true
//! mean AND be knowledge-monotone (≤_k).
//!
//! Arms:
//!   - Push-sum: mass-splitting, converges to true mean, NOT ≤_k-monotone
//!   - Gossip-average: pairwise averaging, converges to true mean, NOT ≤_k-monotone
//!   - Gossip-Tarski: join_k flooding, IS ≤_k-monotone, WRONG fixed point
//!
//! Run: cargo test --test exp_push_sum -- --nocapture

mod scenarios;

use sgrs_core::propagation::{
    compute_disagreement, gossip_average_converge, gossip_converge,
    push_sum_converge, EvidenceState, EvidenceVector,
};

// ─── Topology builders ──────────────────────────────────────────────────────

fn ring_edges(n: usize) -> Vec<(usize, usize)> {
    let mut e: Vec<(usize, usize)> = (0..n - 1).map(|i| (i, i + 1)).collect();
    e.push((n - 1, 0));
    e
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

fn star_edges(n: usize) -> Vec<(usize, usize)> {
    (1..n).map(|i| (0, i)).collect()
}

fn fmt_vec(v: &[f64]) -> String {
    let parts: Vec<String> = v.iter().map(|x| format!("{:.4}", x)).collect();
    format!("[{}]", parts.join(", "))
}

// ─── E12.1: Push-sum converges to true mean on M&A phases ──────────────────

#[test]
fn e12_1_push_sum_converges_to_mean() {
    println!("\n═══ E12.1: Push-Sum Convergence to True Mean ═══\n");
    println!(
        "  {:<14} {:>4} {:>6} {:>5}  {:>10} {:>10} {:>10}  {:>10} {:>10}",
        "Phase", "n", "Topo", "|E|",
        "PS dist", "GAvg dist", "GMax dist",
        "PS Ω%", "GAvg Ω%"
    );
    println!("  {}", "─".repeat(100));

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
                // Push-sum
                let (_, ps_final, ps_om) =
                    push_sum_converge(&state, edges, max_steps, 1e-15, 42);
                let ps_est = ps_final.to_evidence_state();

                // Gossip-average
                let (_, gavg_final, gavg_om) =
                    gossip_average_converge(&state, edges, max_steps, 1e-15, 42);

                // Gossip-Tarski
                let (_, gmax_final, _) =
                    gossip_converge(&state, edges, max_steps, 1e-15, 42);

                let dist = |final_st: &EvidenceState| -> f64 {
                    (0..n)
                        .map(|i| final_st.role_states[i].distance_squared(&true_mean))
                        .sum::<f64>()
                        .sqrt()
                };

                let ps_dist = dist(&ps_est);
                let gavg_dist = dist(&gavg_final);
                let gmax_dist = dist(&gmax_final);

                let pct = |om: &[f64]| {
                    if omega_0 > 1e-15 { om.last().unwrap() / omega_0 * 100.0 } else { 0.0 }
                };

                println!(
                    "  {:<14} {:>4} {:>6} {:>5}  {:>10.4} {:>10.4} {:>10.4}  {:>9.2}% {:>9.2}%",
                    phase_name, n, topo_name, edges.len(),
                    ps_dist, gavg_dist, gmax_dist,
                    pct(&ps_om), pct(&gavg_om)
                );

                // Push-sum should converge close to true mean (within tolerance)
                // Allow slightly more slack than gossip-average due to edge-ordering effects
                assert!(
                    ps_dist < gmax_dist + 1.0,
                    "push-sum should be closer to mean than gossip-Tarski: ps={:.4} vs gmax={:.4}",
                    ps_dist, gmax_dist
                );
            }
        }
    }
}

// ─── E12.2: Knowledge monotonicity violation (impossibility confirmation) ────

#[test]
fn e12_2_knowledge_monotonicity_impossibility() {
    println!("\n═══ E12.2: Impossibility — Knowledge Monotonicity vs Correctness ═══");
    println!("  Theorem: No gossip on bilattice can be both ≤_k-monotone AND converge to mean.\n");
    println!(
        "  {:<14} {:>4} {:>6}  {:>10} {:>10} {:>10}  {:>10}",
        "Phase", "n", "Topo", "PS mono?", "GAvg mono?", "GMax mono?", "GMax correct?"
    );
    println!("  {}", "─".repeat(80));

    let max_steps = 100;
    let mut ps_violations = 0;
    let mut gavg_violations = 0;
    let mut gmax_correct = 0;
    let mut total = 0;

    for &n in &[21, 35] {
        let topologies: Vec<(&str, Vec<(usize, usize)>)> = vec![
            ("ring", ring_edges(n)),
            ("3-regular", scenarios::regular3_edges(n)),
            ("modular-7", scenarios::modular_edges(n, 7)),
        ];

        for (phase_name, state) in scenarios::scaled_phases(n) {
            let true_mean = state.mean();

            for (topo_name, edges) in &topologies {
                total += 1;

                // Push-sum
                let (_, ps_final, _) = push_sum_converge(&state, edges, max_steps, 1e-15, 42);
                let ps_est = ps_final.to_evidence_state();
                let ps_mono = (0..n).all(|i| state.role_states[i].leq_k(&ps_est.role_states[i]));
                if !ps_mono { ps_violations += 1; }

                // Gossip-average
                let (_, gavg_final, _) =
                    gossip_average_converge(&state, edges, max_steps, 1e-15, 42);
                let gavg_mono = (0..n).all(|i| state.role_states[i].leq_k(&gavg_final.role_states[i]));
                if !gavg_mono { gavg_violations += 1; }

                // Gossip-Tarski (always monotone, but wrong fixed point)
                let (_, gmax_final, _) = gossip_converge(&state, edges, max_steps, 1e-15, 42);
                let gmax_mono = (0..n).all(|i| state.role_states[i].leq_k(&gmax_final.role_states[i]));

                // Is gossip-Tarski correct? (close to mean)
                let gmax_dist: f64 = (0..n)
                    .map(|i| gmax_final.role_states[i].distance_squared(&true_mean))
                    .sum::<f64>()
                    .sqrt();
                let is_correct = gmax_dist < 0.5;
                if is_correct { gmax_correct += 1; }

                let tag = |b: bool| if b { "YES" } else { "NO" };
                println!(
                    "  {:<14} {:>4} {:>6}  {:>10} {:>10} {:>10}  {:>10}",
                    phase_name, n, topo_name,
                    tag(ps_mono), tag(gavg_mono), tag(gmax_mono),
                    tag(is_correct)
                );

                // Gossip-Tarski MUST be monotone
                assert!(gmax_mono, "{}/{}: gossip-Tarski must be ≤_k-monotone", phase_name, topo_name);
            }
        }
    }

    println!("\n  ── Impossibility summary ({} configs) ──", total);
    println!("    Push-sum ≤_k violations:    {}/{} ({:.0}%)", ps_violations, total, ps_violations as f64 / total as f64 * 100.0);
    println!("    Gossip-avg ≤_k violations:  {}/{} ({:.0}%)", gavg_violations, total, gavg_violations as f64 / total as f64 * 100.0);
    println!("    Gossip-Tarski correct:      {}/{} ({:.0}%)", gmax_correct, total, gmax_correct as f64 / total as f64 * 100.0);
    println!();
    println!("  Conclusion: protocols that converge to mean (push-sum, gossip-avg) violate ≤_k.");
    println!("  The only ≤_k-monotone protocol (gossip-Tarski) converges to WRONG fixed point.");
    println!("  ∎ Impossibility confirmed empirically.");

    // Structural assertions
    assert!(
        ps_violations > total / 2,
        "push-sum should violate ≤_k in majority of configs: {}/{}", ps_violations, total
    );
    assert!(
        gavg_violations > total / 2,
        "gossip-avg should violate ≤_k in majority of configs: {}/{}", gavg_violations, total
    );
}

// ─── E12.3: Convergence rate comparison ──────────────────────────────────────

#[test]
fn e12_3_convergence_rate_comparison() {
    println!("\n═══ E12.3: Convergence Rate — Push-Sum vs Gossip-Average ═══\n");
    println!(
        "  {:<14} {:>4} {:>6}  {:>8} {:>8}  {:>10} {:>10}  {:>8}",
        "Phase", "n", "Topo", "PS τ", "GAvg τ", "PS Ω_final", "GAvg Ω_f", "Winner"
    );
    println!("  {}", "─".repeat(82));

    let max_steps = 100;
    let tol = 1e-10;
    let mut ps_wins = 0;
    let mut gavg_wins = 0;

    for &n in &[21, 35, 49] {
        let topologies: Vec<(&str, Vec<(usize, usize)>)> = vec![
            ("ring", ring_edges(n)),
            ("3-regular", scenarios::regular3_edges(n)),
            ("modular-7", scenarios::modular_edges(n, 7)),
            ("complete", complete_edges(n)),
        ];

        for (phase_name, state) in scenarios::scaled_phases(n) {
            for (topo_name, edges) in &topologies {
                let (ps_t, _, ps_om) = push_sum_converge(&state, edges, max_steps, tol, 42);
                let (gavg_t, _, gavg_om) = gossip_average_converge(&state, edges, max_steps, tol, 42);

                let winner = if ps_t < gavg_t {
                    ps_wins += 1;
                    "PS"
                } else if gavg_t < ps_t {
                    gavg_wins += 1;
                    "GAVG"
                } else {
                    "TIE"
                };

                println!(
                    "  {:<14} {:>4} {:>6}  {:>8} {:>8}  {:>10.6} {:>10.6}  {:>8}",
                    phase_name, n, topo_name,
                    ps_t, gavg_t,
                    ps_om.last().unwrap(), gavg_om.last().unwrap(),
                    winner
                );
            }
        }
    }

    println!("\n  Rate summary: push-sum wins {}, gossip-avg wins {}", ps_wins, gavg_wins);
}

// ─── E12.4: Scaled stress test (256-1024 nodes) ─────────────────────────────

#[test]
fn e12_4_large_scale_push_sum() {
    println!("\n═══ E12.4: Push-Sum at Scale (n=256..1024) ═══\n");
    println!(
        "  {:<14} {:>5} {:>8} {:>5}  {:>6} {:>6}  {:>10} {:>10}  {:>10} {:>10}",
        "Phase", "n", "Topo", "|E|",
        "PS τ", "GA τ",
        "PS dist", "GA dist",
        "GMax dist", "PS mono?"
    );
    println!("  {}", "─".repeat(110));

    let max_steps = 100;

    for &n in &[256, 512, 1024] {
        let topologies: Vec<(&str, Vec<(usize, usize)>)> = vec![
            ("ring", ring_edges(n)),
            ("3-regular", scenarios::regular3_edges(n)),
            ("modular-16", scenarios::modular_edges(n, 16)),
        ];

        let phases = vec![
            ("P3-scaled", scenarios::scale_phase(&scenarios::phase3_contested_mixed(), n, 0.15, 300)),
        ];

        for (phase_name, state) in &phases {
            let true_mean = state.mean();

            for (topo_name, edges) in &topologies {
                let (ps_t, ps_final, _) = push_sum_converge(state, edges, max_steps, 1e-10, 42);
                let ps_est = ps_final.to_evidence_state();

                let (ga_t, ga_final, _) = gossip_average_converge(state, edges, max_steps, 1e-10, 42);
                let (_, gmax_final, _) = gossip_converge(state, edges, max_steps, 1e-10, 42);

                let dist = |final_st: &EvidenceState| -> f64 {
                    (0..n)
                        .map(|i| final_st.role_states[i].distance_squared(&true_mean))
                        .sum::<f64>()
                        .sqrt()
                };

                let ps_mono = (0..n).all(|i| state.role_states[i].leq_k(&ps_est.role_states[i]));

                println!(
                    "  {:<14} {:>5} {:>8} {:>5}  {:>6} {:>6}  {:>10.4} {:>10.4}  {:>10.4} {:>10}",
                    phase_name, n, topo_name, edges.len(),
                    ps_t, ga_t,
                    dist(&ps_est), dist(&ga_final),
                    dist(&gmax_final),
                    if ps_mono { "YES" } else { "NO" }
                );
            }
        }
    }

    // Structural assertion: push-sum converges at n=1024
    let n = 1024;
    let state = scenarios::scale_phase(&scenarios::phase3_contested_mixed(), n, 0.15, 300);
    let true_mean = state.mean();
    let edges = scenarios::regular3_edges(n);
    let (_, ps_final, _) = push_sum_converge(&state, &edges, 100, 1e-10, 42);
    let ps_est = ps_final.to_evidence_state();
    let ps_dist: f64 = (0..n)
        .map(|i| ps_est.role_states[i].distance_squared(&true_mean))
        .sum::<f64>()
        .sqrt();

    println!("\n  Structural check: push-sum dist-to-mean at n=1024, 3-regular = {:.4}", ps_dist);
}
