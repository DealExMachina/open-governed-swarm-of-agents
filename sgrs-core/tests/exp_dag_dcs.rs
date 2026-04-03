//! E5: Causal DAG DCS Order Independence
//!
//! Validates:
//! - Proposition 1: DCS policy-independence — insertion order doesn't affect DAG
//! - Content hash determinism across contexts
//! - O(n) insertion complexity
//!
//! Run: cargo test --test exp_dag_dcs -- --nocapture

use sgrs_core::causal::{
    CausalDag, Contribution, ContributionId, ContributionKind, ContributionMetadata,
    ContributionPayload, compute_content_hash,
};
use std::collections::HashSet;

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn make_metadata() -> ContributionMetadata {
    ContributionMetadata {
        role_id: "test-role".to_string(),
        authority_tier: 1,
        governance_mode: "YOLO".to_string(),
        valid_from: Some(0),
        valid_to: None,
        transaction_time: 0,
    }
}

fn kind_for_index(i: usize) -> ContributionKind {
    match i % 6 {
        0 => ContributionKind::Claim,
        1 => ContributionKind::Evidence,
        2 => ContributionKind::Goal,
        3 => ContributionKind::Assessment,
        4 => ContributionKind::Contradiction,
        _ => ContributionKind::Resolution,
    }
}

/// Generate a deterministic DAG structure from a seed.
/// Returns contributions in a valid topological order.
fn generate_dag(seed: u64, size: usize) -> Vec<Contribution> {
    let num_roots = std::cmp::max(1, size / 5);
    let mut contributions: Vec<Contribution> = Vec::with_capacity(size);

    for i in 0..size {
        let payload_content = serde_json::json!({
            "seed": seed,
            "index": i,
            "data": format!("node-{}-{}", seed, i),
        });
        let payload = ContributionPayload { content: payload_content };
        let kind = kind_for_index(i);

        let parents: Vec<ContributionId> = if i < num_roots {
            vec![]
        } else {
            // Deterministic parent selection: pick 1-3 parents from earlier contributions
            let mut parents = Vec::new();
            // Always include at least one parent
            let parent_idx = ((seed.wrapping_mul(31) + i as u64 * 7) % i as u64) as usize;
            parents.push(contributions[parent_idx].rid.clone());
            // Sometimes add a second parent
            if i > 2 && (seed + i as u64) % 3 == 0 {
                let p2 = ((seed.wrapping_mul(17) + i as u64 * 13) % i as u64) as usize;
                if p2 != parent_idx {
                    parents.push(contributions[p2].rid.clone());
                }
            }
            parents
        };

        let rid = compute_content_hash(&parents, &payload, &kind).unwrap();
        contributions.push(Contribution {
            rid,
            parents,
            payload,
            kind,
            metadata: make_metadata(),
        });
    }

    contributions
}

/// Shuffle contributions into a valid insertion order (parents before children)
/// using Kahn's-like algorithm with deterministic tie-breaking from seed.
fn shuffle_topological(contributions: &[Contribution], seed: u64) -> Vec<Contribution> {
    let ids: HashSet<ContributionId> = contributions.iter().map(|c| c.rid.clone()).collect();
    let n = contributions.len();

    // Build in-degree map
    let mut in_degree: Vec<usize> = vec![0; n];
    let mut index_map: std::collections::HashMap<ContributionId, usize> = std::collections::HashMap::new();
    for (i, c) in contributions.iter().enumerate() {
        index_map.insert(c.rid.clone(), i);
    }

    for (i, c) in contributions.iter().enumerate() {
        for p in &c.parents {
            if ids.contains(p) {
                in_degree[i] += 1;
            }
        }
    }

    // Collect sources (in-degree 0)
    let mut sources: Vec<usize> = (0..n).filter(|&i| in_degree[i] == 0).collect();

    let mut result = Vec::with_capacity(n);
    let mut step: u64 = 0;

    while !sources.is_empty() {
        // Deterministic shuffle based on seed and step
        sources.sort_by(|&a, &b| {
            let ha = seed.wrapping_mul(a as u64 + 1).wrapping_add(step.wrapping_mul(37));
            let hb = seed.wrapping_mul(b as u64 + 1).wrapping_add(step.wrapping_mul(37));
            ha.cmp(&hb)
        });

        let chosen = sources.remove(0);
        result.push(contributions[chosen].clone());
        step += 1;

        // Update in-degrees for children of chosen
        let chosen_id = &contributions[chosen].rid;
        for (i, c) in contributions.iter().enumerate() {
            if c.parents.contains(chosen_id) {
                in_degree[i] -= 1;
                if in_degree[i] == 0 {
                    sources.push(i);
                }
            }
        }
    }

    result
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[test]
fn dcs_random_dag_order_independence() {
    println!("\n=== E5.1: DCS order independence — 100 random DAGs × 5 orderings ===\n");

    let num_dags = 100;
    let num_orderings = 5;
    let mut all_pass = true;

    println!(
        "{:<6} | {:<6} | {:<6} | {:<8} | {:<8} | identical",
        "DAG", "nodes", "edges", "frontier", "orderings"
    );
    println!(
        "{:-<6}-+-{:-<6}-+-{:-<6}-+-{:-<8}-+-{:-<8}-+-{:-<9}",
        "", "", "", "", "", ""
    );

    for dag_idx in 0..num_dags {
        let seed = (dag_idx as u64) * 1000 + 42;
        let size = 10 + (seed % 41) as usize; // 10-50 nodes
        let contributions = generate_dag(seed, size);

        // Insert in the first ordering to get reference results
        let mut ref_dag = CausalDag::new();
        for c in &contributions {
            ref_dag.insert(c.clone()).unwrap();
        }
        let ref_node_ids: HashSet<_> = ref_dag.node_ids().into_iter().collect();
        let ref_edges: HashSet<_> = ref_dag.edges().into_iter().collect();
        let ref_frontier: HashSet<_> = ref_dag.frontier().into_iter().collect();

        let mut identical = true;

        for order_seed in 1..num_orderings {
            let shuffled = shuffle_topological(&contributions, seed + order_seed as u64 * 7919);
            let mut dag = CausalDag::new();
            for c in &shuffled {
                dag.insert(c.clone()).unwrap();
            }

            let node_ids: HashSet<_> = dag.node_ids().into_iter().collect();
            let edges: HashSet<_> = dag.edges().into_iter().collect();
            let frontier: HashSet<_> = dag.frontier().into_iter().collect();

            if node_ids != ref_node_ids || edges != ref_edges || frontier != ref_frontier {
                identical = false;
                all_pass = false;
            }
        }

        if dag_idx < 5 || dag_idx == num_dags - 1 || !identical {
            println!(
                "{:<6} | {:<6} | {:<6} | {:<8} | {:<8} | {}",
                dag_idx, size, ref_edges.len(), ref_frontier.len(), num_orderings,
                if identical { "YES" } else { "NO" }
            );
        }
    }

    if all_pass {
        println!("  ... ({} more DAGs, all identical)", num_dags - 6);
    }

    assert!(all_pass, "DCS order independence violated for some DAGs");

    println!("\nResult: all 100 DAGs identical across 5 insertion orderings ✓");
}

#[test]
fn dcs_content_hash_deterministic() {
    println!("\n=== E5.2: Content hash determinism ===\n");

    let num_dags = 100;
    let mut mismatches = 0;

    for dag_idx in 0..num_dags {
        let seed = (dag_idx as u64) * 1000 + 42;
        let size = 10 + (seed % 41) as usize;
        let contributions = generate_dag(seed, size);

        // Recompute every hash from scratch
        for c in &contributions {
            let recomputed = compute_content_hash(&c.parents, &c.payload, &c.kind).unwrap();
            if recomputed != c.rid {
                mismatches += 1;
            }
        }
    }

    assert_eq!(mismatches, 0, "found {} hash mismatches", mismatches);
    println!("  Verified {} DAGs: all content hashes deterministic ✓", num_dags);
    println!("\nResult: SHA-256/CBOR hashing is a pure function ✓");
}

#[test]
fn dcs_insertion_time_linear() {
    println!("\n=== E5.3: Insertion time scaling ===\n");

    let sizes = [10, 20, 50, 100, 200, 500];

    println!(
        "{:<6} | {:<10} | {:<12}",
        "n", "time (μs)", "time/n (μs)"
    );
    println!("{:-<6}-+-{:-<10}-+-{:-<12}", "", "", "");

    let mut time_per_n = Vec::new();

    for &size in &sizes {
        let contributions = generate_dag(12345, size);
        let start = std::time::Instant::now();

        let mut dag = CausalDag::new();
        for c in contributions {
            dag.insert(c).unwrap();
        }

        let elapsed = start.elapsed();
        let micros = elapsed.as_micros() as f64;
        let per_n = micros / size as f64;
        time_per_n.push(per_n);

        println!("{:<6} | {:<10.0} | {:<12.2}", size, micros, per_n);
    }

    // Check roughly linear: time/n for n=500 should be within 20x of time/n for n=10
    // (allowing for cache effects and constant factors)
    let ratio = time_per_n.last().unwrap() / time_per_n.first().unwrap();
    println!("\n  Scaling ratio (n=500 vs n=10): {:.1}x", ratio);
    assert!(
        ratio < 20.0,
        "insertion appears super-linear: ratio = {:.1}x (expected < 20x)",
        ratio
    );

    println!("\nResult: insertion time is approximately O(n) ✓");
}

#[test]
fn dcs_parent_order_in_hash() {
    println!("\n=== E5.4: Parent order invariance in hash ===\n");

    // Create two root contributions first
    let payload_a = ContributionPayload { content: serde_json::json!({"data": "root-A"}) };
    let payload_b = ContributionPayload { content: serde_json::json!({"data": "root-B"}) };
    let kind = ContributionKind::Claim;

    let rid_a = compute_content_hash(&[], &payload_a, &kind).unwrap();
    let rid_b = compute_content_hash(&[], &payload_b, &kind).unwrap();

    // Compute hash with parents in order [A, B]
    let child_payload = ContributionPayload { content: serde_json::json!({"data": "child"}) };
    let hash_ab = compute_content_hash(
        &[rid_a.clone(), rid_b.clone()],
        &child_payload,
        &ContributionKind::Assessment,
    ).unwrap();

    // Compute hash with parents in order [B, A]
    let hash_ba = compute_content_hash(
        &[rid_b.clone(), rid_a.clone()],
        &child_payload,
        &ContributionKind::Assessment,
    ).unwrap();

    println!("  hash([A,B]) = {}", hash_ab.to_hex());
    println!("  hash([B,A]) = {}", hash_ba.to_hex());
    println!("  equal: {}", hash_ab == hash_ba);

    assert_eq!(hash_ab, hash_ba, "parent order should not affect hash (parents are sorted)");

    println!("\nResult: parent order invariance verified ✓");
}

#[test]
fn dcs_frontier_stability() {
    println!("\n=== E5.5: Frontier stability across insertion orderings ===\n");

    let num_tests = 50;
    let num_orderings = 5;
    let mut all_pass = true;

    for test_idx in 0..num_tests {
        let seed = test_idx as u64 * 997 + 7;
        let size = 15 + (seed % 36) as usize;
        let contributions = generate_dag(seed, size);

        // Reference frontier
        let mut ref_dag = CausalDag::new();
        for c in &contributions {
            ref_dag.insert(c.clone()).unwrap();
        }
        let ref_frontier: HashSet<_> = ref_dag.frontier().into_iter().collect();

        for order_seed in 1..num_orderings {
            let shuffled = shuffle_topological(&contributions, seed + order_seed as u64 * 3571);
            let mut dag = CausalDag::new();
            for c in &shuffled {
                dag.insert(c.clone()).unwrap();
            }
            let frontier: HashSet<_> = dag.frontier().into_iter().collect();

            if frontier != ref_frontier {
                all_pass = false;
                println!("  FAIL: DAG {} ordering {} has different frontier", test_idx, order_seed);
            }
        }
    }

    assert!(all_pass, "frontier stability violated");
    println!("  {} DAGs × {} orderings: all frontiers identical ✓", num_tests, num_orderings);
    println!("\nResult: frontier is insertion-order invariant ✓");
}
