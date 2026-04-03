//! E10: Gossip Tarski vs Synchronous Tarski — Realistic & Synthetic
//!
//! Three-arm comparison across:
//!   A) Synthetic alternating states (original, for regression)
//!   B) Realistic M&A scenario phases (from Project Horizon demo)
//!   C) The live swarm topology (7-node directed ring with shortcut)
//!
//! This separates algorithm performance on artificial pathological inputs
//! from performance on evidence distributions that actually occur in practice.
//!
//! Run: cargo test --test exp_gossip_tarski -- --nocapture

mod scenarios;

use sgrs_core::propagation::{
    compute_disagreement, gossip_average_converge, gossip_converge,
    gossip_spanning_tree_round, tarski_converge,
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

/// Synthetic alternating state (original, kept for regression).
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
        TopoFactory { name: "chain", build: chain_edges, min_n: 2 },
        TopoFactory { name: "ring", build: ring_edges, min_n: 3 },
        TopoFactory { name: "star", build: star_edges, min_n: 2 },
        TopoFactory { name: "complete", build: complete_edges, min_n: 2 },
    ]
}

// ─── E10.1: Gossip vs Synchronous — synthetic (regression) ──────────────────

#[test]
fn e10_1_gossip_vs_synchronous_convergence() {
    println!("\n═══ E10.1: Gossip vs Synchronous Tarski — Synthetic (Regression) ═══\n");
    println!(
        "{:<10} {:>5} {:>8} {:>8} {:>10} {:>10} {:>10} {:>10}",
        "Topology", "n", "|E|", "Sync τ", "Sync Ω%", "Gossip τ", "Gossip Ω%", "Winner"
    );
    println!("{}", "─".repeat(75));

    let num_dims = 3;
    let max_steps = 50;
    let tolerance = 1e-10;

    for factory in &topology_factories() {
        for &n in &[5, 10, 15] {
            if n < factory.min_n { continue; }

            let edges = (factory.build)(n);
            let state = make_contested_state(n, num_dims);
            let omega_0 = compute_disagreement(&state);

            let (sync_steps, _, sync_omegas) =
                tarski_converge(&state, &edges, max_steps, tolerance);
            let sync_r = sync_omegas.last().unwrap() / omega_0 * 100.0;

            let (gossip_rounds, _, gossip_omegas) =
                gossip_converge(&state, &edges, max_steps, tolerance, 42);
            let gossip_r = gossip_omegas.last().unwrap() / omega_0 * 100.0;

            let winner = if gossip_r < sync_r - 1.0 { "gossip" }
                else if sync_r < gossip_r - 1.0 { "sync" }
                else { "tie" };

            println!(
                "{:<10} {:>5} {:>8} {:>8} {:>9.1}% {:>10} {:>9.1}% {:>10}",
                factory.name, n, edges.len(), sync_steps, sync_r,
                gossip_rounds, gossip_r, winner
            );
        }
    }

    // Regression assertion
    let n = 10;
    let state = make_contested_state(n, 3);
    let chain = chain_edges(n);
    let omega_0 = compute_disagreement(&state);
    let (_, _, sync_chain) = tarski_converge(&state, &chain, 50, 1e-10);
    let (_, _, gossip_chain) = gossip_converge(&state, &chain, 50, 1e-10, 42);
    assert!(*sync_chain.last().unwrap() < omega_0 * 0.5);
    assert!(*gossip_chain.last().unwrap() < omega_0 * 0.5);
}

// ─── E10.2: Realistic M&A phases on swarm topology ─────────────────────────

#[test]
fn e10_2_realistic_mna_phases() {
    println!("\n═══ E10.2: M&A Scenario Phases on Swarm Topology (7 roles, D=4) ═══");
    println!("  Real evidence distributions from Project Horizon demo\n");
    println!(
        "  {:<18} {:>6} {:>8} {:>8}  {:>8} {:>8} {:>8}  {:>8}",
        "Phase", "Ω₀", "Sync τ", "Sync%",
        "GAvg τ", "GAvg%", "GMax τ", "GMax%"
    );
    println!("  {}", "─".repeat(88));

    let swarm = scenarios::swarm_edges();
    let max_steps = 100;
    let tolerance = 1e-10;

    for (name, state) in scenarios::all_phases() {
        let omega_0 = compute_disagreement(&state);

        let (sync_t, sync_final, sync_om) = tarski_converge(&state, &swarm, max_steps, tolerance);
        let sync_pct = if omega_0 > 1e-15 { sync_om.last().unwrap() / omega_0 * 100.0 } else { 0.0 };

        let (gavg_t, gavg_final, gavg_om) =
            gossip_average_converge(&state, &swarm, max_steps, tolerance, 42);
        let gavg_pct = if omega_0 > 1e-15 { gavg_om.last().unwrap() / omega_0 * 100.0 } else { 0.0 };

        let (gmax_t, gmax_final, gmax_om) =
            gossip_converge(&state, &swarm, max_steps, tolerance, 42);
        let gmax_pct = if omega_0 > 1e-15 { gmax_om.last().unwrap() / omega_0 * 100.0 } else { 0.0 };

        println!(
            "  {:<18} {:>6.3} {:>8} {:>7.2}%  {:>8} {:>7.2}% {:>8} {:>7.2}%",
            name, omega_0, sync_t, sync_pct,
            gavg_t, gavg_pct, gmax_t, gmax_pct
        );

        // Report fixed-point quality: distance from true mean
        let true_mean = state.mean();
        let n = state.num_roles;
        let sync_dist: f64 = (0..n).map(|i| sync_final.role_states[i].distance_squared(&true_mean)).sum::<f64>().sqrt();
        let gavg_dist: f64 = (0..n).map(|i| gavg_final.role_states[i].distance_squared(&true_mean)).sum::<f64>().sqrt();
        let gmax_dist: f64 = (0..n).map(|i| gmax_final.role_states[i].distance_squared(&true_mean)).sum::<f64>().sqrt();

        println!(
            "  {:<18} dist-to-mean: Sync={:.4}  GAvg={:.4}  GMax={:.4}",
            "", sync_dist, gavg_dist, gmax_dist
        );
    }

    // Key assertion: on the contested phase (P3), gossip-average must converge
    let p3 = scenarios::phase3_contested_mixed();
    let omega_0 = compute_disagreement(&p3);
    let (_, _, gavg_om) = gossip_average_converge(&p3, &swarm, 100, 1e-10, 42);
    assert!(
        gavg_om.last().unwrap() / omega_0 < 0.01,
        "gossip-average must converge to <1% residual on contested M&A phase"
    );
}

// ─── E10.3: Spanning-tree gossip vs random gossip ──────────────────────────

#[test]
fn e10_3_spanning_tree_gossip() {
    println!("\n═══ E10.3: Spanning-Tree vs Random Gossip ═══\n");
    println!(
        "{:<10} {:>5} {:>12} {:>12}",
        "Topology", "n", "Random Ω%", "Tree Ω%"
    );
    println!("{}", "─".repeat(42));

    let num_dims = 3;

    for factory in &topology_factories() {
        for &n in &[5, 10] {
            if n < factory.min_n { continue; }

            let edges = (factory.build)(n);
            let state = make_contested_state(n, num_dims);
            let omega_0 = compute_disagreement(&state);

            let (_, _, gossip_omegas) = gossip_converge(&state, &edges, 10, 1e-15, 42);
            let random_r = gossip_omegas.last().unwrap() / omega_0 * 100.0;

            let mut tree_state = state.clone();
            let mut tree_omegas = vec![omega_0];
            for _ in 0..10 {
                let result = gossip_spanning_tree_round(&tree_state, &edges);
                tree_omegas.push(result.disagreement_after);
                tree_state = result.new_state;
            }
            let tree_r = tree_omegas.last().unwrap() / omega_0 * 100.0;

            println!(
                "{:<10} {:>5} {:>11.1}% {:>11.1}%",
                factory.name, n, random_r, tree_r
            );
        }
    }
}

// ─── E10.4: Knowledge monotonicity ─────────────────────────────────────────

#[test]
fn e10_4_knowledge_monotonicity() {
    println!("\n═══ E10.4: Knowledge Monotonicity — All Scenarios ═══\n");

    // Test on both synthetic and realistic states
    let test_cases: Vec<(&str, EvidenceState, Vec<(usize, usize)>)> = vec![
        ("synthetic-chain-8", make_contested_state(8, 3), chain_edges(8)),
        ("synthetic-ring-8", make_contested_state(8, 3), ring_edges(8)),
        ("synthetic-star-8", make_contested_state(8, 3), star_edges(8)),
        ("synthetic-complete-8", make_contested_state(8, 3), complete_edges(8)),
        ("P1-briefing", scenarios::phase1_initial_briefing(), scenarios::swarm_edges()),
        ("P2-financial-dd", scenarios::phase2_financial_dd(), scenarios::swarm_edges()),
        ("P3-contested", scenarios::phase3_contested_mixed(), scenarios::swarm_edges()),
        ("P4-near-finality", scenarios::phase4_near_finality(), scenarios::swarm_edges()),
    ];

    for (name, state, edges) in &test_cases {
        let n = state.num_roles;
        let (rounds, final_state, omegas) =
            gossip_converge(state, edges, 50, 1e-15, 42);

        for i in 0..n {
            assert!(
                state.role_states[i].leq_k(&final_state.role_states[i]),
                "{}: role {} knowledge decreased after {} rounds",
                name, i, rounds
            );
        }

        let ratio = if omegas[0] > 1e-15 { omegas.last().unwrap() / omegas[0] } else { 0.0 };
        println!(
            "  {:<25}: {} rounds, Ω {:.4} → {:.6} (ratio {:.6}) — monotone ✓",
            name, rounds, omegas[0], omegas.last().unwrap(), ratio
        );
    }
}

// ─── E10.5: Dense graph focus — complete graphs ────────────────────────────

#[test]
fn e10_5_dense_graph_focus() {
    println!("\n═══ E10.5: Dense Graph Focus — Complete Graph K_n ═══\n");
    println!(
        "{:>5} {:>8} {:>10} {:>10} {:>12} {:>12}",
        "n", "|E|", "Sync Ω%", "Gossip Ω%", "Sync τ", "Gossip τ"
    );
    println!("{}", "─".repeat(62));

    let num_dims = 3;
    let max_steps = 50;

    for &n in &[3, 5, 8, 10, 15] {
        let edges = complete_edges(n);
        let state = make_contested_state(n, num_dims);
        let omega_0 = compute_disagreement(&state);

        let (sync_steps, _, sync_omegas) =
            tarski_converge(&state, &edges, max_steps, 1e-10);
        let sync_r = sync_omegas.last().unwrap() / omega_0 * 100.0;

        let (gossip_rounds, _, gossip_omegas) =
            gossip_converge(&state, &edges, max_steps, 1e-10, 42);
        let gossip_r = gossip_omegas.last().unwrap() / omega_0 * 100.0;

        println!(
            "{:>5} {:>8} {:>9.1}% {:>9.1}% {:>12} {:>12}",
            n, edges.len(), sync_r, gossip_r, sync_steps, gossip_rounds
        );
    }

    // Regression assertion
    let n = 10;
    let edges = complete_edges(n);
    let state = make_contested_state(n, 3);
    let omega_0 = compute_disagreement(&state);
    let (_, _, sync_omegas) = tarski_converge(&state, &edges, max_steps, 1e-10);
    let (_, _, gossip_omegas) = gossip_converge(&state, &edges, max_steps, 1e-10, 42);
    assert!(gossip_omegas.last().unwrap() / omega_0 < sync_omegas.last().unwrap() / omega_0 + 0.1);
}
