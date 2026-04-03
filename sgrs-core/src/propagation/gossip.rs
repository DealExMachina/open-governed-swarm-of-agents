//! Gossip Tarski: asynchronous bilateral meet-based propagation.
//!
//! Instead of synchronous all-node updates (standard Tarski), Gossip Tarski
//! processes one randomly-chosen edge (i,j) at a time:
//!
//!   For edge (i,j):
//!     x_i ← join_k(x_i, x_j)   // absorb j's knowledge
//!     x_j ← join_k(x_j, x_i)   // absorb i's knowledge (original)
//!
//! This bilateral update is still monotone in ≤_k (same join/meet structure),
//! so Tarski's fixed-point theorem guarantees convergence. The key question is
//! whether gossip achieves better communication-cost/disagreement tradeoffs on
//! dense graphs where synchronous Tarski suffers from the "everything-agrees-
//! with-everything" problem (E9 finding: 97% residual on complete graphs).
//!
//! Gossip processes O(|E|) edge-updates per "round" (one pass through all edges
//! in random order), avoiding the global synchronization barrier.
//!
//! Reference: Riess (CDC 2022) proposes asynchronous Tarski for distributed
//! consensus in lattice-valued sheaves.

use super::disagreement::compute_disagreement;
use super::evidence_state::EvidenceState;
use rand::rngs::StdRng;
use rand::seq::SliceRandom;
use rand::SeedableRng;

/// Result of one gossip round (one pass through all edges in random order).
#[derive(Debug, Clone)]
pub struct GossipRoundResult {
    pub new_state: EvidenceState,
    pub disagreement_before: f64,
    pub disagreement_after: f64,
    pub contraction_ratio: f64,
    pub edges_processed: usize,
    pub any_changed: bool,
}

/// One gossip round: process all edges in random order, doing bilateral updates.
///
/// Each edge (i,j) triggers:
///   x_i ← join_k(x_i, x_j)   // absorb j's knowledge
///   x_j ← join_k(x_j, x_i)   // absorb i's original knowledge
///
/// Unlike synchronous Tarski, updates are applied immediately (in place),
/// so earlier edge updates can benefit later ones within the same round.
pub fn gossip_round(
    state: &EvidenceState,
    edges: &[(usize, usize)],
    rng: &mut StdRng,
) -> GossipRoundResult {
    let omega_before = compute_disagreement(state);
    let mut current = state.clone();
    let mut any_changed = false;

    // Shuffle edges for random processing order
    let mut shuffled: Vec<(usize, usize)> = edges.to_vec();
    shuffled.shuffle(rng);

    for &(i, j) in &shuffled {
        // Bilateral join_k exchange: both nodes absorb each other's knowledge.
        // Using original values so update order within the pair doesn't matter.
        let new_i = current.role_states[i].join_k(&current.role_states[j]);
        let new_j = current.role_states[j].join_k(&current.role_states[i]);

        if new_i.distance_squared(&current.role_states[i]) > 1e-20
            || new_j.distance_squared(&current.role_states[j]) > 1e-20
        {
            any_changed = true;
        }

        current.role_states[i] = new_i;
        current.role_states[j] = new_j;
    }

    let omega_after = compute_disagreement(&current);
    let contraction_ratio = if omega_before > 1e-15 {
        omega_after / omega_before
    } else {
        0.0
    };

    GossipRoundResult {
        new_state: current,
        disagreement_before: omega_before,
        disagreement_after: omega_after,
        contraction_ratio,
        edges_processed: shuffled.len(),
        any_changed,
    }
}

/// Run gossip Tarski until convergence or max_rounds.
/// Returns (rounds, final_state, disagreement_trace).
pub fn gossip_converge(
    state: &EvidenceState,
    edges: &[(usize, usize)],
    max_rounds: usize,
    tolerance: f64,
    seed: u64,
) -> (usize, EvidenceState, Vec<f64>) {
    let mut rng = StdRng::seed_from_u64(seed);
    let mut current = state.clone();
    let mut omegas = vec![compute_disagreement(&current)];

    for round in 0..max_rounds {
        let result = gossip_round(&current, edges, &mut rng);
        omegas.push(result.disagreement_after);

        if !result.any_changed || result.disagreement_after < tolerance {
            return (round + 1, result.new_state, omegas);
        }

        current = result.new_state;
    }

    (max_rounds, current, omegas)
}

/// Single-edge gossip step: process exactly one edge (i,j).
/// Useful for fine-grained analysis and event-driven architectures.
pub fn gossip_single_edge(
    state: &mut EvidenceState,
    i: usize,
    j: usize,
) -> bool {
    let new_i = state.role_states[i].join_k(&state.role_states[j]);
    let new_j = state.role_states[j].join_k(&state.role_states[i]);

    let changed = new_i.distance_squared(&state.role_states[i]) > 1e-20
        || new_j.distance_squared(&state.role_states[j]) > 1e-20;

    state.role_states[i] = new_i;
    state.role_states[j] = new_j;

    changed
}

/// Spanning-tree gossip: process edges in spanning-tree order
/// (breadth-first from vertex 0). This gives a deterministic sweep
/// that propagates information from root to leaves and back.
pub fn gossip_spanning_tree_round(
    state: &EvidenceState,
    edges: &[(usize, usize)],
) -> GossipRoundResult {
    let omega_before = compute_disagreement(state);
    let n = state.num_roles;

    // Build adjacency list and BFS tree
    let mut adj: Vec<Vec<(usize, usize)>> = vec![vec![]; n]; // (neighbor, edge_idx)
    for (idx, &(i, j)) in edges.iter().enumerate() {
        adj[i].push((j, idx));
        adj[j].push((i, idx));
    }

    // BFS to find spanning tree edges
    let mut visited = vec![false; n];
    let mut tree_edges = Vec::new();
    let mut queue = std::collections::VecDeque::new();

    visited[0] = true;
    queue.push_back(0);

    while let Some(u) = queue.pop_front() {
        for &(v, _) in &adj[u] {
            if !visited[v] {
                visited[v] = true;
                tree_edges.push((u, v));
                queue.push_back(v);
            }
        }
    }

    let mut current = state.clone();
    let mut any_changed = false;

    // Forward pass: root to leaves
    for &(i, j) in &tree_edges {
        let consensus = current.role_states[i].meet_k(&current.role_states[j]);
        let new_i = current.role_states[i].join_k(&consensus);
        let new_j = current.role_states[j].join_k(&consensus);

        if new_i.distance_squared(&current.role_states[i]) > 1e-20
            || new_j.distance_squared(&current.role_states[j]) > 1e-20
        {
            any_changed = true;
        }

        current.role_states[i] = new_i;
        current.role_states[j] = new_j;
    }

    // Backward pass: leaves to root
    for &(i, j) in tree_edges.iter().rev() {
        let consensus = current.role_states[i].meet_k(&current.role_states[j]);
        let new_i = current.role_states[i].join_k(&consensus);
        let new_j = current.role_states[j].join_k(&consensus);

        if new_i.distance_squared(&current.role_states[i]) > 1e-20
            || new_j.distance_squared(&current.role_states[j]) > 1e-20
        {
            any_changed = true;
        }

        current.role_states[i] = new_i;
        current.role_states[j] = new_j;
    }

    let omega_after = compute_disagreement(&current);
    let contraction_ratio = if omega_before > 1e-15 {
        omega_after / omega_before
    } else {
        0.0
    };

    GossipRoundResult {
        new_state: current,
        disagreement_before: omega_before,
        disagreement_after: omega_after,
        contraction_ratio,
        edges_processed: tree_edges.len() * 2,
        any_changed,
    }
}

// ── Gossip-Average: pairwise averaging baseline (Boyd et al. 2006) ─────────
//
// Standard gossip averaging protocol. Each edge (i,j) triggers:
//   mid = (x_i + x_j) / 2
//   x_i ← mid
//   x_j ← mid
//
// Converges to the global mean. NOT knowledge-monotone (averaging can
// decrease individual components). This is the fair baseline for isolating
// the effect of join_k vs averaging under identical communication patterns.

/// One gossip-average round: process all edges in random order, doing bilateral averaging.
pub fn gossip_average_round(
    state: &EvidenceState,
    edges: &[(usize, usize)],
    rng: &mut StdRng,
) -> GossipRoundResult {
    let omega_before = compute_disagreement(state);
    let mut current = state.clone();
    let mut any_changed = false;

    let mut shuffled: Vec<(usize, usize)> = edges.to_vec();
    shuffled.shuffle(rng);

    for &(i, j) in &shuffled {
        let d = current.num_dims;
        let mut mid_support = vec![0.0; d];
        let mut mid_refutation = vec![0.0; d];

        for dim in 0..d {
            mid_support[dim] =
                (current.role_states[i].support[dim] + current.role_states[j].support[dim]) / 2.0;
            mid_refutation[dim] = (current.role_states[i].refutation[dim]
                + current.role_states[j].refutation[dim])
                / 2.0;
        }

        let mid = super::evidence_state::EvidenceVector {
            support: mid_support,
            refutation: mid_refutation,
        };

        if mid.distance_squared(&current.role_states[i]) > 1e-20
            || mid.distance_squared(&current.role_states[j]) > 1e-20
        {
            any_changed = true;
        }

        current.role_states[i] = mid.clone();
        current.role_states[j] = mid;
    }

    let omega_after = compute_disagreement(&current);
    let contraction_ratio = if omega_before > 1e-15 {
        omega_after / omega_before
    } else {
        0.0
    };

    GossipRoundResult {
        new_state: current,
        disagreement_before: omega_before,
        disagreement_after: omega_after,
        contraction_ratio,
        edges_processed: shuffled.len(),
        any_changed,
    }
}

/// Run gossip-average until convergence or max_rounds.
/// Returns (rounds, final_state, disagreement_trace).
pub fn gossip_average_converge(
    state: &EvidenceState,
    edges: &[(usize, usize)],
    max_rounds: usize,
    tolerance: f64,
    seed: u64,
) -> (usize, EvidenceState, Vec<f64>) {
    let mut rng = StdRng::seed_from_u64(seed);
    let mut current = state.clone();
    let mut omegas = vec![compute_disagreement(&current)];

    for round in 0..max_rounds {
        let result = gossip_average_round(&current, edges, &mut rng);
        omegas.push(result.disagreement_after);

        if !result.any_changed || result.disagreement_after < tolerance {
            return (round + 1, result.new_state, omegas);
        }

        current = result.new_state;
    }

    (max_rounds, current, omegas)
}

// ── Push-Sum: mass-splitting gossip (Kempe, Dobra & Gehrke, STOC 2003) ─────
//
// Each node i maintains a triple (s_i, r_i, w_i) where s_i and r_i are
// the support and refutation "mass" and w_i is a scalar weight.
// Initially s_i = support_i, r_i = refutation_i, w_i = 1.
//
// On each gossip exchange along edge (i,j):
//   i sends half of (s_i, r_i, w_i) to j and keeps half
//   j sends half of (s_j, r_j, w_j) to i and keeps half
//
// The estimate at node i is (s_i/w_i, r_i/w_i), which provably converges
// to the true global mean (1/n) Σ (support_k, refutation_k).
//
// Convergence rate: O(n² log(n/ε)) on expander graphs.
//
// NOT knowledge-monotone: if s_i(0) > mean(s), convergence requires
// s_i(t) < s_i(0), violating x_final ≥_k x_initial.

/// State for push-sum protocol: per-node mass triples.
#[derive(Debug, Clone)]
pub struct PushSumState {
    /// Support mass per node per dimension.
    pub support_mass: Vec<Vec<f64>>,
    /// Refutation mass per node per dimension.
    pub refutation_mass: Vec<Vec<f64>>,
    /// Weight per node (scalar, shared across dimensions).
    pub weights: Vec<f64>,
    pub num_roles: usize,
    pub num_dims: usize,
}

impl PushSumState {
    /// Initialize from an EvidenceState: mass = evidence values, weight = 1.
    pub fn from_evidence(state: &EvidenceState) -> Self {
        PushSumState {
            support_mass: state.role_states.iter().map(|v| v.support.clone()).collect(),
            refutation_mass: state.role_states.iter().map(|v| v.refutation.clone()).collect(),
            weights: vec![1.0; state.num_roles],
            num_roles: state.num_roles,
            num_dims: state.num_dims,
        }
    }

    /// Current estimate at node i: (s_i/w_i, r_i/w_i).
    pub fn estimate(&self, i: usize) -> super::evidence_state::EvidenceVector {
        let w = self.weights[i];
        super::evidence_state::EvidenceVector {
            support: self.support_mass[i].iter().map(|s| s / w).collect(),
            refutation: self.refutation_mass[i].iter().map(|r| r / w).collect(),
        }
    }

    /// Convert all estimates to an EvidenceState.
    pub fn to_evidence_state(&self) -> EvidenceState {
        let role_states = (0..self.num_roles).map(|i| self.estimate(i)).collect();
        EvidenceState {
            role_states,
            num_roles: self.num_roles,
            num_dims: self.num_dims,
        }
    }
}

/// One push-sum round: process all edges in random order.
///
/// Each edge (i,j): both nodes send half their mass to each other.
/// After the exchange:
///   s_i' = s_i/2 + s_j/2,  w_i' = w_i/2 + w_j/2
///   s_j' = s_j/2 + s_i/2,  w_j' = w_j/2 + w_i/2
pub fn push_sum_round(
    ps: &PushSumState,
    edges: &[(usize, usize)],
    rng: &mut StdRng,
) -> PushSumState {
    let mut current = ps.clone();
    let mut shuffled: Vec<(usize, usize)> = edges.to_vec();
    shuffled.shuffle(rng);

    for &(i, j) in &shuffled {
        let d = current.num_dims;

        // Each node sends half to the other and keeps half
        let half_wi = current.weights[i] / 2.0;
        let half_wj = current.weights[j] / 2.0;

        let mut half_si = vec![0.0; d];
        let mut half_ri = vec![0.0; d];
        let mut half_sj = vec![0.0; d];
        let mut half_rj = vec![0.0; d];

        for dim in 0..d {
            half_si[dim] = current.support_mass[i][dim] / 2.0;
            half_ri[dim] = current.refutation_mass[i][dim] / 2.0;
            half_sj[dim] = current.support_mass[j][dim] / 2.0;
            half_rj[dim] = current.refutation_mass[j][dim] / 2.0;
        }

        // i keeps half + receives half from j
        current.weights[i] = half_wi + half_wj;
        current.weights[j] = half_wj + half_wi;

        for dim in 0..d {
            current.support_mass[i][dim] = half_si[dim] + half_sj[dim];
            current.refutation_mass[i][dim] = half_ri[dim] + half_rj[dim];
            current.support_mass[j][dim] = half_sj[dim] + half_si[dim];
            current.refutation_mass[j][dim] = half_rj[dim] + half_ri[dim];
        }
    }

    current
}

/// Run push-sum until estimates stabilize or max_rounds.
/// Returns (rounds, final PushSumState, disagreement trace of estimates).
pub fn push_sum_converge(
    state: &EvidenceState,
    edges: &[(usize, usize)],
    max_rounds: usize,
    tolerance: f64,
    seed: u64,
) -> (usize, PushSumState, Vec<f64>) {
    let mut rng = StdRng::seed_from_u64(seed);
    let mut ps = PushSumState::from_evidence(state);
    let mut omegas = vec![compute_disagreement(state)];

    for round in 0..max_rounds {
        ps = push_sum_round(&ps, edges, &mut rng);
        let est = ps.to_evidence_state();
        let omega = compute_disagreement(&est);
        omegas.push(omega);

        if omega < tolerance {
            return (round + 1, ps, omegas);
        }
    }

    (max_rounds, ps, omegas)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::propagation::evidence_state::EvidenceVector;

    fn make_simple_state(n: usize, d: usize) -> EvidenceState {
        let roles = (0..n)
            .map(|i| EvidenceVector {
                support: (0..d).map(|dim| (i as f64 * 0.2 + dim as f64 * 0.1).min(1.0)).collect(),
                refutation: (0..d).map(|dim| ((n - i) as f64 * 0.15 + dim as f64 * 0.05).min(1.0)).collect(),
            })
            .collect();
        EvidenceState { role_states: roles, num_roles: n, num_dims: d }
    }

    #[test]
    fn gossip_converges_on_chain() {
        let state = make_simple_state(5, 2);
        let edges: Vec<(usize, usize)> = (0..4).map(|i| (i, i + 1)).collect();
        let (rounds, _final_state, omegas) = gossip_converge(&state, &edges, 100, 1e-10, 42);
        assert!(rounds <= 100, "should converge in ≤100 rounds");
        assert!(*omegas.last().unwrap() < omegas[0], "disagreement should decrease");
    }

    #[test]
    fn gossip_monotone_knowledge() {
        let state = make_simple_state(3, 2);
        let edges = vec![(0, 1), (1, 2)];
        let mut rng = StdRng::seed_from_u64(42);

        let result = gossip_round(&state, &edges, &mut rng);

        // Every role's knowledge should be ≥ initial (join_k with consensus)
        for i in 0..3 {
            assert!(
                state.role_states[i].leq_k(&result.new_state.role_states[i]),
                "role {} knowledge should not decrease", i
            );
        }
    }

    #[test]
    fn spanning_tree_converges() {
        let state = make_simple_state(5, 2);
        let edges: Vec<(usize, usize)> = vec![(0, 1), (1, 2), (2, 3), (3, 4)];
        let result = gossip_spanning_tree_round(&state, &edges);
        assert!(result.disagreement_after <= result.disagreement_before + 1e-10);
    }

    #[test]
    fn single_edge_bilateral() {
        let mut state = make_simple_state(2, 2);
        let original = state.clone();
        let changed = gossip_single_edge(&mut state, 0, 1);

        if changed {
            // Both roles should have gained knowledge
            assert!(original.role_states[0].leq_k(&state.role_states[0]));
            assert!(original.role_states[1].leq_k(&state.role_states[1]));
        }
    }
}
