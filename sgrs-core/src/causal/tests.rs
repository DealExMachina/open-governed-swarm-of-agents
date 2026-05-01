use std::collections::HashSet;

use super::contribution::*;
use super::dag::CausalDag;
use super::validation::*;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

fn make_metadata() -> ContributionMetadata {
    ContributionMetadata {
        role_id: "facts".to_string(),
        authority_tier: 1,
        governance_mode: "MASTER".to_string(),
        valid_from: None,
        valid_to: None,
        transaction_time: 1700000000000,
    }
}

fn make_payload(s: &str) -> ContributionPayload {
    ContributionPayload {
        content: serde_json::json!({ "text": s }),
    }
}

/// Build a contribution with the correct content hash.
fn make_contribution(
    parents: Vec<ContributionId>,
    payload: ContributionPayload,
    kind: ContributionKind,
) -> Contribution {
    let rid = compute_content_hash(&parents, &payload, &kind).unwrap();
    Contribution {
        rid,
        parents,
        payload,
        kind,
        metadata: make_metadata(),
    }
}

/// Build a root contribution (no parents).
fn make_root(text: &str, kind: ContributionKind) -> Contribution {
    make_contribution(vec![], make_payload(text), kind)
}

// ===========================================================================
// Content hashing tests
// ===========================================================================

#[test]
fn hash_determinism() {
    let parents = vec![];
    let payload = make_payload("hello world");
    let kind = ContributionKind::Claim;

    let h1 = compute_content_hash(&parents, &payload, &kind).unwrap();
    let h2 = compute_content_hash(&parents, &payload, &kind).unwrap();
    assert_eq!(h1, h2, "Same input must produce same hash");
}

#[test]
fn hash_sensitivity_payload() {
    let parents = vec![];
    let kind = ContributionKind::Claim;

    let h1 = compute_content_hash(&parents, &make_payload("alpha"), &kind).unwrap();
    let h2 = compute_content_hash(&parents, &make_payload("beta"), &kind).unwrap();
    assert_ne!(h1, h2, "Different payloads must produce different hashes");
}

#[test]
fn hash_sensitivity_kind() {
    let parents = vec![];
    let payload = make_payload("same content");

    let h1 = compute_content_hash(&parents, &payload, &ContributionKind::Claim).unwrap();
    let h2 = compute_content_hash(&parents, &payload, &ContributionKind::Evidence).unwrap();
    assert_ne!(h1, h2, "Different kinds must produce different hashes");
}

#[test]
fn hash_sensitivity_parents() {
    let payload = make_payload("same content");
    let kind = ContributionKind::Claim;

    let parent_a = ContributionId([1u8; 32]);
    let parent_b = ContributionId([2u8; 32]);

    let h1 = compute_content_hash(std::slice::from_ref(&parent_a), &payload, &kind).unwrap();
    let h2 = compute_content_hash(&[parent_b], &payload, &kind).unwrap();
    assert_ne!(h1, h2, "Different parents must produce different hashes");

    let h3 = compute_content_hash(&[parent_a], &payload, &kind).unwrap();
    assert_eq!(h1, h3, "Same parent must produce same hash");
}

#[test]
fn hash_parent_order_invariant() {
    let payload = make_payload("test");
    let kind = ContributionKind::Claim;

    let parent_a = ContributionId([1u8; 32]);
    let parent_b = ContributionId([2u8; 32]);

    let h1 = compute_content_hash(&[parent_a.clone(), parent_b.clone()], &payload, &kind).unwrap();
    let h2 = compute_content_hash(&[parent_b, parent_a], &payload, &kind).unwrap();
    assert_eq!(
        h1, h2,
        "Parent order must not affect hash (parents are sorted)"
    );
}

#[test]
fn hash_payload_key_order_invariant() {
    let parents = vec![];
    let kind = ContributionKind::Claim;
    let payload_a = ContributionPayload {
        content: serde_json::json!({
            "z": 1,
            "a": { "y": 2, "b": 3 },
            "list": [{"k2": true, "k1": false}]
        }),
    };
    let payload_b = ContributionPayload {
        content: serde_json::json!({
            "list": [{"k1": false, "k2": true}],
            "a": { "b": 3, "y": 2 },
            "z": 1
        }),
    };

    let h1 = compute_content_hash(&parents, &payload_a, &kind).unwrap();
    let h2 = compute_content_hash(&parents, &payload_b, &kind).unwrap();
    assert_eq!(h1, h2, "Payload key order must not affect hash");
}

#[test]
fn hash_empty_parents() {
    let payload = make_payload("root node");
    let kind = ContributionKind::Goal;

    let h = compute_content_hash(&[], &payload, &kind);
    assert!(h.is_ok(), "Empty parents should produce valid hash");
    assert_ne!(h.unwrap().0, [0u8; 32], "Hash should not be all zeros");
}

#[test]
fn hash_large_payload() {
    let big_content = serde_json::json!({
        "text": "x".repeat(10_000),
        "nested": {
            "array": (0..100).collect::<Vec<i32>>(),
            "deep": { "value": true }
        }
    });
    let payload = ContributionPayload {
        content: big_content,
    };
    let kind = ContributionKind::Evidence;

    let h = compute_content_hash(&[], &payload, &kind);
    assert!(h.is_ok(), "Large payload should produce valid hash");
}

// ===========================================================================
// ContributionId hex encoding tests
// ===========================================================================

#[test]
fn hex_roundtrip() {
    let original = ContributionId([
        0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67,
        0x89, 0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0x01, 0x23, 0x45,
        0x67, 0x89,
    ]);
    let hex = original.to_hex();
    let decoded = ContributionId::from_hex(&hex).unwrap();
    assert_eq!(original, decoded, "Hex roundtrip must be identity");
}

#[test]
fn invalid_hex_rejected_short() {
    let result = ContributionId::from_hex("abcd");
    assert!(result.is_err(), "Short hex should be rejected");
}

#[test]
fn invalid_hex_rejected_bad_chars() {
    let result = ContributionId::from_hex(
        "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
    );
    assert!(result.is_err(), "Non-hex characters should be rejected");
}

// ===========================================================================
// ContributionKind tests
// ===========================================================================

#[test]
fn kind_roundtrip() {
    for kind in [
        ContributionKind::Claim,
        ContributionKind::Contradiction,
        ContributionKind::Resolution,
        ContributionKind::Assessment,
        ContributionKind::Goal,
        ContributionKind::Evidence,
    ] {
        let s = kind.as_str();
        let parsed = ContributionKind::from_str(s).unwrap();
        assert_eq!(kind, parsed, "Kind roundtrip failed for {}", s);
    }
}

#[test]
fn kind_unknown_rejected() {
    let result = ContributionKind::from_str("bogus");
    assert!(result.is_err());
}

// ===========================================================================
// Content hash validation tests
// ===========================================================================

#[test]
fn validate_correct_hash() {
    let c = make_root("valid contribution", ContributionKind::Claim);
    assert!(
        validate_content_hash(&c).is_ok(),
        "Correctly hashed contribution should validate"
    );
}

#[test]
fn validate_wrong_hash() {
    let mut c = make_root("valid contribution", ContributionKind::Claim);
    c.rid = ContributionId([0xffu8; 32]); // tamper with rid
    let result = validate_content_hash(&c);
    assert!(result.is_err(), "Tampered rid should fail validation");
    match result.unwrap_err() {
        crate::error::KernelError::HashMismatch { .. } => {}
        e => panic!("Expected HashMismatch, got {:?}", e),
    }
}

// ===========================================================================
// DAG insertion tests
// ===========================================================================

#[test]
fn insert_root() {
    let mut dag = CausalDag::new();
    let c = make_root("root claim", ContributionKind::Claim);
    assert!(dag.insert(c).is_ok());
    assert_eq!(dag.len(), 1);
}

#[test]
fn insert_with_valid_parent() {
    let mut dag = CausalDag::new();
    let root = make_root("root", ContributionKind::Claim);
    let root_id = root.rid.clone();
    dag.insert(root).unwrap();

    let child = make_contribution(
        vec![root_id],
        make_payload("child"),
        ContributionKind::Evidence,
    );
    assert!(dag.insert(child).is_ok());
    assert_eq!(dag.len(), 2);
}

#[test]
fn insert_missing_parent() {
    let mut dag = CausalDag::new();
    let fake_parent = ContributionId([0xaau8; 32]);
    let child = make_contribution(
        vec![fake_parent],
        make_payload("orphan"),
        ContributionKind::Claim,
    );
    let result = dag.insert(child);
    assert!(result.is_err());
    match result.unwrap_err() {
        crate::error::KernelError::MissingParent { .. } => {}
        e => panic!("Expected MissingParent, got {:?}", e),
    }
}

#[test]
fn insert_duplicate_idempotent() {
    let mut dag = CausalDag::new();
    let c = make_root("root", ContributionKind::Claim);
    let c_clone = c.clone();
    dag.insert(c).unwrap();
    assert_eq!(dag.len(), 1);

    // Re-insert same contribution
    dag.insert(c_clone).unwrap();
    assert_eq!(dag.len(), 1, "Duplicate insert should be no-op");
}

#[test]
fn insert_hash_mismatch() {
    let mut dag = CausalDag::new();
    let mut c = make_root("some content", ContributionKind::Claim);
    c.rid = ContributionId([0x00u8; 32]); // wrong hash
    let result = dag.insert(c);
    assert!(result.is_err());
    match result.unwrap_err() {
        crate::error::KernelError::HashMismatch { .. } => {}
        e => panic!("Expected HashMismatch, got {:?}", e),
    }
}

#[test]
fn insert_self_parent_rejected() {
    // Construct a contribution that lists its own rid as a parent.
    // Since rid depends on parents, we have to build it manually with a fake rid.
    let payload = make_payload("self-referential");
    let kind = ContributionKind::Claim;
    // First compute what the hash would be with some arbitrary parent
    let fake_parent = ContributionId([0xffu8; 32]);
    let rid = compute_content_hash(std::slice::from_ref(&fake_parent), &payload, &kind).unwrap();

    // Now try to insert it into an empty DAG (parent won't exist → MissingParent)
    let mut dag = CausalDag::new();
    let c = Contribution {
        rid: rid.clone(),
        parents: vec![rid.clone()], // self-reference
        payload,
        kind,
        metadata: make_metadata(),
    };
    // This will fail either with HashMismatch (rid != hash of [rid, ...]) or MissingParent
    assert!(dag.insert(c).is_err());
}

#[test]
fn insert_diamond_dag() {
    let mut dag = CausalDag::new();

    //     A
    //    / \
    //   B   C
    //    \ /
    //     D

    let a = make_root("A", ContributionKind::Claim);
    let a_id = a.rid.clone();
    dag.insert(a).unwrap();

    let b = make_contribution(
        vec![a_id.clone()],
        make_payload("B"),
        ContributionKind::Evidence,
    );
    let b_id = b.rid.clone();
    dag.insert(b).unwrap();

    let c = make_contribution(
        vec![a_id.clone()],
        make_payload("C"),
        ContributionKind::Evidence,
    );
    let c_id = c.rid.clone();
    dag.insert(c).unwrap();

    let d = make_contribution(
        vec![b_id, c_id],
        make_payload("D"),
        ContributionKind::Resolution,
    );
    dag.insert(d).unwrap();

    assert_eq!(dag.len(), 4);
}

#[test]
fn insert_chain() {
    let mut dag = CausalDag::new();

    let a = make_root("A", ContributionKind::Claim);
    let a_id = a.rid.clone();
    dag.insert(a).unwrap();

    let b = make_contribution(vec![a_id], make_payload("B"), ContributionKind::Evidence);
    let b_id = b.rid.clone();
    dag.insert(b).unwrap();

    let c = make_contribution(
        vec![b_id],
        make_payload("C"),
        ContributionKind::Contradiction,
    );
    let c_id = c.rid.clone();
    dag.insert(c).unwrap();

    let d = make_contribution(vec![c_id], make_payload("D"), ContributionKind::Resolution);
    dag.insert(d).unwrap();

    assert_eq!(dag.len(), 4);
}

// ===========================================================================
// DAG traversal tests
// ===========================================================================

fn build_diamond_dag() -> (
    CausalDag,
    ContributionId,
    ContributionId,
    ContributionId,
    ContributionId,
) {
    let mut dag = CausalDag::new();

    let a = make_root("A", ContributionKind::Claim);
    let a_id = a.rid.clone();
    dag.insert(a).unwrap();

    let b = make_contribution(
        vec![a_id.clone()],
        make_payload("B"),
        ContributionKind::Evidence,
    );
    let b_id = b.rid.clone();
    dag.insert(b).unwrap();

    let c = make_contribution(
        vec![a_id.clone()],
        make_payload("C"),
        ContributionKind::Evidence,
    );
    let c_id = c.rid.clone();
    dag.insert(c).unwrap();

    let d = make_contribution(
        vec![b_id.clone(), c_id.clone()],
        make_payload("D"),
        ContributionKind::Resolution,
    );
    let d_id = d.rid.clone();
    dag.insert(d).unwrap();

    (dag, a_id, b_id, c_id, d_id)
}

fn build_chain_dag() -> (CausalDag, Vec<ContributionId>) {
    let mut dag = CausalDag::new();
    let mut ids = Vec::new();

    let a = make_root("chain-A", ContributionKind::Claim);
    ids.push(a.rid.clone());
    dag.insert(a).unwrap();

    for i in 1..4 {
        let c = make_contribution(
            vec![ids[i - 1].clone()],
            make_payload(&format!("chain-{}", i)),
            ContributionKind::Evidence,
        );
        ids.push(c.rid.clone());
        dag.insert(c).unwrap();
    }

    (dag, ids)
}

#[test]
fn topological_order_empty() {
    let dag = CausalDag::new();
    assert!(dag.topological_order().is_empty());
}

#[test]
fn topological_order_single() {
    let mut dag = CausalDag::new();
    let c = make_root("only", ContributionKind::Claim);
    dag.insert(c).unwrap();
    let order = dag.topological_order();
    assert_eq!(order.len(), 1);
}

#[test]
fn topological_order_respects_parents() {
    let (dag, a_id, b_id, c_id, d_id) = build_diamond_dag();
    let order = dag.topological_order();
    assert_eq!(order.len(), 4);

    let positions: std::collections::HashMap<&ContributionId, usize> =
        order.iter().enumerate().map(|(i, c)| (&c.rid, i)).collect();

    // A must come before B and C
    assert!(positions[&a_id] < positions[&b_id]);
    assert!(positions[&a_id] < positions[&c_id]);
    // B and C must come before D
    assert!(positions[&b_id] < positions[&d_id]);
    assert!(positions[&c_id] < positions[&d_id]);
}

#[test]
fn topological_order_chain() {
    let (dag, ids) = build_chain_dag();
    let order = dag.topological_order();
    assert_eq!(order.len(), 4);
    for i in 0..4 {
        assert_eq!(order[i].rid, ids[i], "Chain should be in insertion order");
    }
}

#[test]
fn ancestors_root() {
    let (dag, a_id, _, _, _) = build_diamond_dag();
    let anc = dag.ancestors(&a_id).unwrap();
    assert!(anc.is_empty(), "Root should have no ancestors");
}

#[test]
fn ancestors_chain() {
    let (dag, ids) = build_chain_dag();
    // D (ids[3]) should have ancestors {A, B, C} = {ids[0], ids[1], ids[2]}
    let anc = dag.ancestors(&ids[3]).unwrap();
    assert_eq!(anc.len(), 3);
    assert!(anc.contains(&ids[0]));
    assert!(anc.contains(&ids[1]));
    assert!(anc.contains(&ids[2]));
}

#[test]
fn ancestors_diamond() {
    let (dag, a_id, b_id, c_id, d_id) = build_diamond_dag();
    let anc = dag.ancestors(&d_id).unwrap();
    assert_eq!(anc.len(), 3, "D should have 3 ancestors: A, B, C");
    assert!(anc.contains(&a_id));
    assert!(anc.contains(&b_id));
    assert!(anc.contains(&c_id));
}

#[test]
fn ancestors_missing_id() {
    let dag = CausalDag::new();
    let fake = ContributionId([0xffu8; 32]);
    assert!(dag.ancestors(&fake).is_err());
}

#[test]
fn causal_cone_includes_self() {
    let (dag, _, _, _, d_id) = build_diamond_dag();
    let cone = dag.causal_cone(&d_id).unwrap();
    assert!(
        cone.iter().any(|c| c.rid == d_id),
        "Causal cone must include self"
    );
}

#[test]
fn causal_cone_topological() {
    let (dag, a_id, b_id, c_id, d_id) = build_diamond_dag();
    let cone = dag.causal_cone(&d_id).unwrap();
    assert_eq!(cone.len(), 4, "Full diamond cone should have 4 nodes");

    let positions: std::collections::HashMap<&ContributionId, usize> =
        cone.iter().enumerate().map(|(i, c)| (&c.rid, i)).collect();

    assert!(positions[&a_id] < positions[&b_id]);
    assert!(positions[&a_id] < positions[&c_id]);
    assert!(positions[&b_id] < positions[&d_id]);
    assert!(positions[&c_id] < positions[&d_id]);
}

#[test]
fn causal_cone_root() {
    let (dag, a_id, _, _, _) = build_diamond_dag();
    let cone = dag.causal_cone(&a_id).unwrap();
    assert_eq!(cone.len(), 1, "Root cone should contain only itself");
    assert_eq!(cone[0].rid, a_id);
}

#[test]
fn frontier_all_roots() {
    let mut dag = CausalDag::new();
    let a = make_root("root1", ContributionKind::Claim);
    let b = make_root("root2", ContributionKind::Goal);
    let a_id = a.rid.clone();
    let b_id = b.rid.clone();
    dag.insert(a).unwrap();
    dag.insert(b).unwrap();

    let frontier = dag.frontier();
    assert_eq!(frontier.len(), 2, "Both roots should be frontier");
    let frontier_set: HashSet<&ContributionId> = frontier.into_iter().collect();
    assert!(frontier_set.contains(&a_id));
    assert!(frontier_set.contains(&b_id));
}

#[test]
fn frontier_chain() {
    let (dag, ids) = build_chain_dag();
    let frontier = dag.frontier();
    assert_eq!(frontier.len(), 1);
    assert_eq!(frontier[0], &ids[3], "Only the tip should be frontier");
}

#[test]
fn frontier_diamond() {
    let (dag, _, _, _, d_id) = build_diamond_dag();
    let frontier = dag.frontier();
    assert_eq!(frontier.len(), 1);
    assert_eq!(frontier[0], &d_id);
}

#[test]
fn by_kind_filters() {
    let mut dag = CausalDag::new();
    dag.insert(make_root("claim1", ContributionKind::Claim))
        .unwrap();
    dag.insert(make_root("claim2", ContributionKind::Claim))
        .unwrap();
    dag.insert(make_root("goal1", ContributionKind::Goal))
        .unwrap();
    dag.insert(make_root("evidence1", ContributionKind::Evidence))
        .unwrap();

    assert_eq!(dag.by_kind(&ContributionKind::Claim).len(), 2);
    assert_eq!(dag.by_kind(&ContributionKind::Goal).len(), 1);
    assert_eq!(dag.by_kind(&ContributionKind::Evidence).len(), 1);
    assert_eq!(dag.by_kind(&ContributionKind::Resolution).len(), 0);
}

// ===========================================================================
// DCS policy-independence test
// ===========================================================================

#[test]
fn insertion_order_independence() {
    // Build a set of contributions with known dependencies:
    // A (root), B→A, C→A, D→{B,C}
    // Insert in two different valid orderings and verify identical DAGs.

    let a = make_root("dcs-A", ContributionKind::Claim);
    let a_id = a.rid.clone();

    let b = make_contribution(
        vec![a_id.clone()],
        make_payload("dcs-B"),
        ContributionKind::Evidence,
    );
    let b_id = b.rid.clone();

    let c = make_contribution(
        vec![a_id.clone()],
        make_payload("dcs-C"),
        ContributionKind::Evidence,
    );
    let c_id = c.rid.clone();

    let d = make_contribution(
        vec![b_id.clone(), c_id.clone()],
        make_payload("dcs-D"),
        ContributionKind::Resolution,
    );

    // Ordering 1: A, B, C, D
    let mut dag1 = CausalDag::new();
    dag1.insert(a.clone()).unwrap();
    dag1.insert(b.clone()).unwrap();
    dag1.insert(c.clone()).unwrap();
    dag1.insert(d.clone()).unwrap();

    // Ordering 2: A, C, B, D
    let mut dag2 = CausalDag::new();
    dag2.insert(a.clone()).unwrap();
    dag2.insert(c.clone()).unwrap();
    dag2.insert(b.clone()).unwrap();
    dag2.insert(d.clone()).unwrap();

    // Verify identical structure
    assert_eq!(dag1.node_ids(), dag2.node_ids(), "Same node sets");

    let mut edges1 = dag1.edges();
    let mut edges2 = dag2.edges();
    edges1.sort_by(|a, b| a.0 .0.cmp(&b.0 .0).then(a.1 .0.cmp(&b.1 .0)));
    edges2.sort_by(|a, b| a.0 .0.cmp(&b.0 .0).then(a.1 .0.cmp(&b.1 .0)));
    assert_eq!(edges1, edges2, "Same edge sets");
}

// ===========================================================================
// Property-based tests (proptest)
// ===========================================================================

mod proptests {
    use super::*;
    use proptest::collection;
    use proptest::prelude::*;

    fn arb_kind() -> impl Strategy<Value = ContributionKind> {
        prop_oneof![
            Just(ContributionKind::Claim),
            Just(ContributionKind::Contradiction),
            Just(ContributionKind::Resolution),
            Just(ContributionKind::Assessment),
            Just(ContributionKind::Goal),
            Just(ContributionKind::Evidence),
        ]
    }

    proptest! {
        /// Hashing is a pure function: same input → same output, always.
        #[test]
        fn prop_hash_determinism(
            text in ".*",
            kind in arb_kind(),
        ) {
            let payload = ContributionPayload {
                content: serde_json::json!({ "text": text }),
            };
            let h1 = compute_content_hash(&[], &payload, &kind).unwrap();
            let h2 = compute_content_hash(&[], &payload, &kind).unwrap();
            prop_assert_eq!(h1, h2);
        }

        /// For any sequence of N root contributions, the DAG remains acyclic
        /// and topological_order succeeds.
        #[test]
        fn prop_dag_acyclic(
            texts in collection::vec("\\PC{1,50}", 1..20),
        ) {
            let mut dag = CausalDag::new();
            for text in &texts {
                let c = make_root(text, ContributionKind::Claim);
                dag.insert(c).unwrap();
            }
            let order = dag.topological_order();
            prop_assert_eq!(order.len(), dag.len());
        }

        /// In any topological order, every parent appears before its child.
        #[test]
        fn prop_topological_valid(
            n in 2..10usize,
        ) {
            let mut dag = CausalDag::new();
            let mut ids: Vec<ContributionId> = Vec::new();

            let root = make_root(&format!("chain-root-{}", n), ContributionKind::Claim);
            ids.push(root.rid.clone());
            dag.insert(root).unwrap();

            for i in 1..n {
                let c = make_contribution(
                    vec![ids[i - 1].clone()],
                    make_payload(&format!("chain-{}-{}", n, i)),
                    ContributionKind::Evidence,
                );
                ids.push(c.rid.clone());
                dag.insert(c).unwrap();
            }

            let order = dag.topological_order();
            let positions: std::collections::HashMap<&ContributionId, usize> = order
                .iter()
                .enumerate()
                .map(|(i, c)| (&c.rid, i))
                .collect();

            for contribution in order.iter() {
                for parent_id in &contribution.parents {
                    if positions.contains_key(parent_id) {
                        prop_assert!(positions[parent_id] < positions[&contribution.rid]);
                    }
                }
            }
        }

        /// Ancestors of any node are a strict subset of all nodes.
        #[test]
        fn prop_ancestors_subset(
            n in 1..8usize,
        ) {
            let mut dag = CausalDag::new();
            let mut ids: Vec<ContributionId> = Vec::new();

            let root = make_root(&format!("sub-root-{}", n), ContributionKind::Claim);
            ids.push(root.rid.clone());
            dag.insert(root).unwrap();

            for i in 1..n {
                let c = make_contribution(
                    vec![ids[i - 1].clone()],
                    make_payload(&format!("sub-{}-{}", n, i)),
                    ContributionKind::Evidence,
                );
                ids.push(c.rid.clone());
                dag.insert(c).unwrap();
            }

            for id in &ids {
                let anc = dag.ancestors(id).unwrap();
                prop_assert!(!anc.contains(id));
                let all_ids = dag.node_ids();
                for a in &anc {
                    prop_assert!(all_ids.contains(a));
                }
            }
        }

        /// Every frontier node has no children.
        #[test]
        fn prop_frontier_no_children(
            texts in collection::vec("\\PC{1,30}", 1..10),
        ) {
            let mut dag = CausalDag::new();
            let mut ids: Vec<ContributionId> = Vec::new();

            let root = make_root(&texts[0], ContributionKind::Claim);
            ids.push(root.rid.clone());
            dag.insert(root).unwrap();

            for (i, text) in texts.iter().enumerate().skip(1) {
                let c = make_contribution(
                    vec![ids[i - 1].clone()],
                    make_payload(text),
                    ContributionKind::Evidence,
                );
                ids.push(c.rid.clone());
                dag.insert(c).unwrap();
            }

            let frontier = dag.frontier();
            let all_edges = dag.edges();
            for tip in &frontier {
                for (parent, _) in &all_edges {
                    prop_assert_ne!(parent, *tip, "Frontier node should not be a parent");
                }
            }
        }

        /// DCS order independence: same contribution set in different valid
        /// orderings produces identical DAGs (same nodes, same edges).
        #[test]
        fn prop_dcs_order_independence(
            seed in any::<u64>(),
        ) {
            let root = make_root(&format!("dcs-prop-root-{}", seed), ContributionKind::Claim);
            let root_id = root.rid.clone();

            let child1 = make_contribution(
                vec![root_id.clone()],
                make_payload(&format!("dcs-prop-c1-{}", seed)),
                ContributionKind::Evidence,
            );

            let child2 = make_contribution(
                vec![root_id.clone()],
                make_payload(&format!("dcs-prop-c2-{}", seed)),
                ContributionKind::Goal,
            );

            // Order 1: root, child1, child2
            let mut dag1 = CausalDag::new();
            dag1.insert(root.clone()).unwrap();
            dag1.insert(child1.clone()).unwrap();
            dag1.insert(child2.clone()).unwrap();

            // Order 2: root, child2, child1
            let mut dag2 = CausalDag::new();
            dag2.insert(root.clone()).unwrap();
            dag2.insert(child2.clone()).unwrap();
            dag2.insert(child1.clone()).unwrap();

            prop_assert_eq!(dag1.node_ids(), dag2.node_ids());

            let mut e1 = dag1.edges();
            let mut e2 = dag2.edges();
            e1.sort_by(|a, b| a.0 .0.cmp(&b.0 .0).then(a.1 .0.cmp(&b.1 .0)));
            e2.sort_by(|a, b| a.0 .0.cmp(&b.0 .0).then(a.1 .0.cmp(&b.1 .0)));
            prop_assert_eq!(e1, e2);
        }
    }
}
