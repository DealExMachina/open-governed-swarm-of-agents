//! Property-based tests for bilattice algebra on EvidenceVector.
//!
//! Verifies lattice axioms for both orderings (≤_k and ≤_t), interlacing
//! (distributivity of ≤_k operations over ≤_t operations), De Morgan
//! identities under negation, and key monotonicity properties.
//!
//! Run: cargo test --test prop_bilattice -- --nocapture

use proptest::prelude::*;
use sgrs_core::propagation::EvidenceVector;

// ── Strategies ─────────────────────────────────────────────────────────────

const DIMS: usize = 4;

fn arb_evidence() -> impl Strategy<Value = EvidenceVector> {
    (
        proptest::collection::vec(0.0..=1.0_f64, DIMS),
        proptest::collection::vec(0.0..=1.0_f64, DIMS),
    )
        .prop_map(|(s, r)| EvidenceVector {
            support: s,
            refutation: r,
        })
}

// ── Helper: approximate equality for f64 vectors ───────────────────────────

fn ev_approx_eq(a: &EvidenceVector, b: &EvidenceVector) -> bool {
    let eps = 1e-10;
    a.support
        .iter()
        .zip(b.support.iter())
        .all(|(x, y)| (x - y).abs() < eps)
        && a.refutation
            .iter()
            .zip(b.refutation.iter())
            .all(|(x, y)| (x - y).abs() < eps)
}

// ═══════════════════════════════════════════════════════════════════════════
// Knowledge lattice (≤_k, join_k, meet_k) axioms
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    // ── Reflexivity ────────────────────────────────────────────────────
    #[test]
    fn k_reflexive(a in arb_evidence()) {
        prop_assert!(a.leq_k(&a));
    }

    #[test]
    fn t_reflexive(a in arb_evidence()) {
        prop_assert!(a.leq_t(&a));
    }

    // ── Antisymmetry (approximate) ────────────────────────────────────
    #[test]
    fn k_antisymmetric(a in arb_evidence(), b in arb_evidence()) {
        if a.leq_k(&b) && b.leq_k(&a) {
            prop_assert!(ev_approx_eq(&a, &b));
        }
    }

    #[test]
    fn t_antisymmetric(a in arb_evidence(), b in arb_evidence()) {
        if a.leq_t(&b) && b.leq_t(&a) {
            prop_assert!(ev_approx_eq(&a, &b));
        }
    }

    // ── Transitivity ──────────────────────────────────────────────────
    #[test]
    fn k_transitive(a in arb_evidence(), b in arb_evidence(), c in arb_evidence()) {
        if a.leq_k(&b) && b.leq_k(&c) {
            prop_assert!(a.leq_k(&c));
        }
    }

    #[test]
    fn t_transitive(a in arb_evidence(), b in arb_evidence(), c in arb_evidence()) {
        if a.leq_t(&b) && b.leq_t(&c) {
            prop_assert!(a.leq_t(&c));
        }
    }

    // ── Join is upper bound ───────────────────────────────────────────
    #[test]
    fn k_join_upper_bound(a in arb_evidence(), b in arb_evidence()) {
        let j = a.join_k(&b);
        prop_assert!(a.leq_k(&j));
        prop_assert!(b.leq_k(&j));
    }

    #[test]
    fn t_join_upper_bound(a in arb_evidence(), b in arb_evidence()) {
        let j = a.join_t(&b);
        prop_assert!(a.leq_t(&j));
        prop_assert!(b.leq_t(&j));
    }

    // ── Meet is lower bound ──────────────────────────────────────────
    #[test]
    fn k_meet_lower_bound(a in arb_evidence(), b in arb_evidence()) {
        let m = a.meet_k(&b);
        prop_assert!(m.leq_k(&a));
        prop_assert!(m.leq_k(&b));
    }

    #[test]
    fn t_meet_lower_bound(a in arb_evidence(), b in arb_evidence()) {
        let m = a.meet_t(&b);
        prop_assert!(m.leq_t(&a));
        prop_assert!(m.leq_t(&b));
    }

    // ── Commutativity ────────────────────────────────────────────────
    #[test]
    fn k_join_commutative(a in arb_evidence(), b in arb_evidence()) {
        prop_assert!(ev_approx_eq(&a.join_k(&b), &b.join_k(&a)));
    }

    #[test]
    fn k_meet_commutative(a in arb_evidence(), b in arb_evidence()) {
        prop_assert!(ev_approx_eq(&a.meet_k(&b), &b.meet_k(&a)));
    }

    #[test]
    fn t_join_commutative(a in arb_evidence(), b in arb_evidence()) {
        prop_assert!(ev_approx_eq(&a.join_t(&b), &b.join_t(&a)));
    }

    #[test]
    fn t_meet_commutative(a in arb_evidence(), b in arb_evidence()) {
        prop_assert!(ev_approx_eq(&a.meet_t(&b), &b.meet_t(&a)));
    }

    // ── Associativity ────────────────────────────────────────────────
    #[test]
    fn k_join_associative(a in arb_evidence(), b in arb_evidence(), c in arb_evidence()) {
        let lhs = a.join_k(&b).join_k(&c);
        let rhs = a.join_k(&b.join_k(&c));
        prop_assert!(ev_approx_eq(&lhs, &rhs));
    }

    #[test]
    fn k_meet_associative(a in arb_evidence(), b in arb_evidence(), c in arb_evidence()) {
        let lhs = a.meet_k(&b).meet_k(&c);
        let rhs = a.meet_k(&b.meet_k(&c));
        prop_assert!(ev_approx_eq(&lhs, &rhs));
    }

    #[test]
    fn t_join_associative(a in arb_evidence(), b in arb_evidence(), c in arb_evidence()) {
        let lhs = a.join_t(&b).join_t(&c);
        let rhs = a.join_t(&b.join_t(&c));
        prop_assert!(ev_approx_eq(&lhs, &rhs));
    }

    #[test]
    fn t_meet_associative(a in arb_evidence(), b in arb_evidence(), c in arb_evidence()) {
        let lhs = a.meet_t(&b).meet_t(&c);
        let rhs = a.meet_t(&b.meet_t(&c));
        prop_assert!(ev_approx_eq(&lhs, &rhs));
    }

    // ── Idempotence ──────────────────────────────────────────────────
    #[test]
    fn k_join_idempotent(a in arb_evidence()) {
        prop_assert!(ev_approx_eq(&a.join_k(&a), &a));
    }

    #[test]
    fn k_meet_idempotent(a in arb_evidence()) {
        prop_assert!(ev_approx_eq(&a.meet_k(&a), &a));
    }

    #[test]
    fn t_join_idempotent(a in arb_evidence()) {
        prop_assert!(ev_approx_eq(&a.join_t(&a), &a));
    }

    #[test]
    fn t_meet_idempotent(a in arb_evidence()) {
        prop_assert!(ev_approx_eq(&a.meet_t(&a), &a));
    }

    // ── Absorption ────────────────────────────────────────────────────
    // a join (a meet b) = a   and   a meet (a join b) = a
    #[test]
    fn k_absorption_join_meet(a in arb_evidence(), b in arb_evidence()) {
        prop_assert!(ev_approx_eq(&a.join_k(&a.meet_k(&b)), &a));
    }

    #[test]
    fn k_absorption_meet_join(a in arb_evidence(), b in arb_evidence()) {
        prop_assert!(ev_approx_eq(&a.meet_k(&a.join_k(&b)), &a));
    }

    #[test]
    fn t_absorption_join_meet(a in arb_evidence(), b in arb_evidence()) {
        prop_assert!(ev_approx_eq(&a.join_t(&a.meet_t(&b)), &a));
    }

    #[test]
    fn t_absorption_meet_join(a in arb_evidence(), b in arb_evidence()) {
        prop_assert!(ev_approx_eq(&a.meet_t(&a.join_t(&b)), &a));
    }

    // ═════════════════════════════════════════════════════════════════
    // Negation properties
    // ═════════════════════════════════════════════════════════════════

    // ── Involution: neg(neg(a)) = a ─────────────────────────────────
    #[test]
    fn neg_involution(a in arb_evidence()) {
        prop_assert!(ev_approx_eq(&a.neg().neg(), &a));
    }

    // ── De Morgan for knowledge ordering ────────────────────────────
    // neg(join_k(a,b)) = join_k(neg(a), neg(b))    (knowledge join is self-dual under neg)
    #[test]
    fn neg_demorgan_join_k(a in arb_evidence(), b in arb_evidence()) {
        let lhs = a.join_k(&b).neg();
        let rhs = a.neg().join_k(&b.neg());
        prop_assert!(ev_approx_eq(&lhs, &rhs));
    }

    #[test]
    fn neg_demorgan_meet_k(a in arb_evidence(), b in arb_evidence()) {
        let lhs = a.meet_k(&b).neg();
        let rhs = a.neg().meet_k(&b.neg());
        prop_assert!(ev_approx_eq(&lhs, &rhs));
    }

    // ── De Morgan for truth ordering ────────────────────────────────
    // neg(join_t(a,b)) = meet_t(neg(a), neg(b))    (truth join/meet swap under neg)
    #[test]
    fn neg_demorgan_join_t(a in arb_evidence(), b in arb_evidence()) {
        let lhs = a.join_t(&b).neg();
        let rhs = a.neg().meet_t(&b.neg());
        prop_assert!(ev_approx_eq(&lhs, &rhs));
    }

    #[test]
    fn neg_demorgan_meet_t(a in arb_evidence(), b in arb_evidence()) {
        let lhs = a.meet_t(&b).neg();
        let rhs = a.neg().join_t(&b.neg());
        prop_assert!(ev_approx_eq(&lhs, &rhs));
    }

    // ── Negation reverses truth ordering ────────────────────────────
    #[test]
    fn neg_reverses_leq_t(a in arb_evidence(), b in arb_evidence()) {
        if a.leq_t(&b) {
            prop_assert!(b.neg().leq_t(&a.neg()));
        }
    }

    // ── Negation preserves knowledge ordering ───────────────────────
    #[test]
    fn neg_preserves_leq_k(a in arb_evidence(), b in arb_evidence()) {
        if a.leq_k(&b) {
            prop_assert!(a.neg().leq_k(&b.neg()));
        }
    }

    // ═════════════════════════════════════════════════════════════════
    // Interlacing: distributivity of ≤_k operations over ≤_t operations
    // ═════════════════════════════════════════════════════════════════

    // join_k distributes over join_t: join_k(a, join_t(b,c)) = join_t(join_k(a,b), join_k(a,c))
    #[test]
    fn interlacing_join_k_over_join_t(a in arb_evidence(), b in arb_evidence(), c in arb_evidence()) {
        let lhs = a.join_k(&b.join_t(&c));
        let rhs = a.join_k(&b).join_t(&a.join_k(&c));
        prop_assert!(ev_approx_eq(&lhs, &rhs));
    }

    // join_k distributes over meet_t: join_k(a, meet_t(b,c)) = meet_t(join_k(a,b), join_k(a,c))
    #[test]
    fn interlacing_join_k_over_meet_t(a in arb_evidence(), b in arb_evidence(), c in arb_evidence()) {
        let lhs = a.join_k(&b.meet_t(&c));
        let rhs = a.join_k(&b).meet_t(&a.join_k(&c));
        prop_assert!(ev_approx_eq(&lhs, &rhs));
    }

    // meet_k distributes over join_t: meet_k(a, join_t(b,c)) = join_t(meet_k(a,b), meet_k(a,c))
    #[test]
    fn interlacing_meet_k_over_join_t(a in arb_evidence(), b in arb_evidence(), c in arb_evidence()) {
        let lhs = a.meet_k(&b.join_t(&c));
        let rhs = a.meet_k(&b).join_t(&a.meet_k(&c));
        prop_assert!(ev_approx_eq(&lhs, &rhs));
    }

    // meet_k distributes over meet_t: meet_k(a, meet_t(b,c)) = meet_t(meet_k(a,b), meet_k(a,c))
    #[test]
    fn interlacing_meet_k_over_meet_t(a in arb_evidence(), b in arb_evidence(), c in arb_evidence()) {
        let lhs = a.meet_k(&b.meet_t(&c));
        let rhs = a.meet_k(&b).meet_t(&a.meet_k(&c));
        prop_assert!(ev_approx_eq(&lhs, &rhs));
    }

    // ═════════════════════════════════════════════════════════════════
    // Key monotonicity property for Phase 3
    // ═════════════════════════════════════════════════════════════════

    // meet_t is monotone in knowledge ordering:
    // if a ≤_k b, then meet_t(a, c) ≤_k meet_t(b, c)
    #[test]
    fn meet_t_monotone_in_k(a in arb_evidence(), b in arb_evidence(), c in arb_evidence()) {
        if a.leq_k(&b) {
            prop_assert!(a.meet_t(&c).leq_k(&b.meet_t(&c)));
        }
    }

    // ═════════════════════════════════════════════════════════════════
    // Conflation: second involution of the Arieli-Avron bilattice
    // conf(s,r) = (1-r, 1-s)
    // ═════════════════════════════════════════════════════════════════

    // conf is an involution: conf(conf(a)) = a.
    #[test]
    fn conf_involution(a in arb_evidence()) {
        prop_assert!(ev_approx_eq(&a.conf().conf(), &a));
    }

    // neg and conf commute: neg ∘ conf = conf ∘ neg (Klein-4 group).
    #[test]
    fn neg_conf_commute(a in arb_evidence()) {
        prop_assert!(ev_approx_eq(&a.neg().conf(), &a.conf().neg()));
    }

    // conf reverses the knowledge ordering: a ≤_k b ⇒ conf(b) ≤_k conf(a).
    #[test]
    fn conf_reverses_leq_k(a in arb_evidence(), b in arb_evidence()) {
        if a.leq_k(&b) {
            prop_assert!(b.conf().leq_k(&a.conf()));
        }
    }

    // conf preserves the truth ordering: a ≤_t b ⇒ conf(a) ≤_t conf(b).
    #[test]
    fn conf_preserves_leq_t(a in arb_evidence(), b in arb_evidence()) {
        if a.leq_t(&b) {
            prop_assert!(a.conf().leq_t(&b.conf()));
        }
    }

    // De Morgan for the knowledge lattice:
    //   conf(join_k(a, b)) = meet_k(conf(a), conf(b))
    #[test]
    fn conf_de_morgan_join_k(a in arb_evidence(), b in arb_evidence()) {
        let lhs = a.join_k(&b).conf();
        let rhs = a.conf().meet_k(&b.conf());
        prop_assert!(ev_approx_eq(&lhs, &rhs));
    }

    // De Morgan for the knowledge lattice:
    //   conf(meet_k(a, b)) = join_k(conf(a), conf(b))
    #[test]
    fn conf_de_morgan_meet_k(a in arb_evidence(), b in arb_evidence()) {
        let lhs = a.meet_k(&b).conf();
        let rhs = a.conf().join_k(&b.conf());
        prop_assert!(ev_approx_eq(&lhs, &rhs));
    }

    // conf distributes over join_t (truth-order self-duality):
    //   conf(join_t(a, b)) = join_t(conf(a), conf(b))
    #[test]
    fn conf_distributes_join_t(a in arb_evidence(), b in arb_evidence()) {
        let lhs = a.join_t(&b).conf();
        let rhs = a.conf().join_t(&b.conf());
        prop_assert!(ev_approx_eq(&lhs, &rhs));
    }

    // conf distributes over meet_t (truth-order self-duality):
    //   conf(meet_t(a, b)) = meet_t(conf(a), conf(b))
    #[test]
    fn conf_distributes_meet_t(a in arb_evidence(), b in arb_evidence()) {
        let lhs = a.meet_t(&b).conf();
        let rhs = a.conf().meet_t(&b.conf());
        prop_assert!(ev_approx_eq(&lhs, &rhs));
    }
}
