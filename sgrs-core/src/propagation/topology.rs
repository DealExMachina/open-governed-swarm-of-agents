/// Topology builders for the role graph.
///
/// Each builder returns an edge list `Vec<(usize, usize)>` suitable for
/// `CellularSheaf::constant(num_roles, stalk_dim, &edges)`.
///
/// Topology properties relevant to sheaf propagation:
///   - Complete(n): λ₁ = n, O(n²) edges — fastest mixing, highest cost
///   - Star(n):     λ₁ = 1, O(n) edges — hub bottleneck, slowest mixing
///   - Ring(n):     λ₁ = 2 − 2cos(2π/n), O(n) edges — balanced
///   - Chain(n):    λ₁ = 2 − 2cos(π/n), O(n) edges — slowest, linear diameter
///   - Expander(n,d): λ₁ ≈ d − 2√(d−1), O(nd) edges — near-optimal mixing/cost

use rand::rngs::StdRng;
use rand::seq::SliceRandom;
use rand::SeedableRng;

/// Build a complete graph on n vertices: every pair connected.
/// Edges: n(n−1)/2. Spectral gap: λ₁ = n (for constant sheaf).
pub fn complete(n: usize) -> Vec<(usize, usize)> {
    let mut edges = Vec::with_capacity(n * (n - 1) / 2);
    for i in 0..n {
        for j in (i + 1)..n {
            edges.push((i, j));
        }
    }
    edges
}

/// Build a star graph with vertex 0 as hub.
/// Edges: n−1. Spectral gap: λ₁ = 1 (for constant sheaf).
pub fn star(n: usize) -> Vec<(usize, usize)> {
    assert!(n >= 2, "Star graph requires at least 2 vertices");
    (1..n).map(|i| (0, i)).collect()
}

/// Build a ring (cycle) graph.
/// Edges: n. Spectral gap: λ₁ = 2 − 2cos(2π/n) (for constant sheaf).
pub fn ring(n: usize) -> Vec<(usize, usize)> {
    assert!(n >= 3, "Ring graph requires at least 3 vertices");
    let mut edges: Vec<(usize, usize)> = (0..n - 1).map(|i| (i, i + 1)).collect();
    edges.push((n - 1, 0));
    edges
}

/// Build a chain (path) graph: 0−1−2−...−(n−1).
/// Edges: n−1. Spectral gap: λ₁ = 2 − 2cos(π/n) (for constant sheaf).
pub fn chain(n: usize) -> Vec<(usize, usize)> {
    assert!(n >= 2, "Chain graph requires at least 2 vertices");
    (0..n - 1).map(|i| (i, i + 1)).collect()
}

/// Build a random d-regular graph using a configuration-model approach.
///
/// Each vertex gets exactly `degree` stubs; stubs are paired uniformly
/// at random (with rejection of self-loops and multi-edges). Falls back
/// to retries if the pairing fails.
///
/// For d-regular graphs the Alon-Boppana bound gives:
///   λ₁ ≥ d − 2√(d−1)  (asymptotically tight for Ramanujan graphs)
///
/// Returns `None` if construction fails after `max_retries` attempts
/// (e.g. odd n with odd degree).
pub fn random_regular(n: usize, degree: usize, seed: u64) -> Option<Vec<(usize, usize)>> {
    if n * degree % 2 != 0 {
        return None; // n*d must be even
    }
    if degree >= n - 1 {
        return Some(complete(n)); // complete graph (or nearly)
    }
    if degree == 0 {
        return Some(Vec::new());
    }

    let max_retries = 100;
    let mut rng = StdRng::seed_from_u64(seed);

    for _ in 0..max_retries {
        // Build stubs: vertex i has stubs [i, i, ..., i] (degree times)
        let mut stubs: Vec<usize> = Vec::with_capacity(n * degree);
        for v in 0..n {
            for _ in 0..degree {
                stubs.push(v);
            }
        }
        stubs.shuffle(&mut rng);

        // Pair stubs
        let mut edges = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut ok = true;

        for pair in stubs.chunks_exact(2) {
            let (u, v) = (pair[0], pair[1]);
            if u == v {
                ok = false;
                break;
            }
            let key = if u < v { (u, v) } else { (v, u) };
            if !seen.insert(key) {
                ok = false;
                break;
            }
            edges.push(key);
        }

        if ok && edges.len() == n * degree / 2 {
            return Some(edges);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn complete_edge_count() {
        for n in 2..=10 {
            let edges = complete(n);
            assert_eq!(edges.len(), n * (n - 1) / 2);
        }
    }

    #[test]
    fn star_edge_count() {
        for n in 2..=10 {
            let edges = star(n);
            assert_eq!(edges.len(), n - 1);
            // All edges touch vertex 0
            for (a, _b) in &edges {
                assert_eq!(*a, 0);
            }
        }
    }

    #[test]
    fn ring_edge_count() {
        for n in 3..=10 {
            let edges = ring(n);
            assert_eq!(edges.len(), n);
        }
    }

    #[test]
    fn chain_edge_count() {
        for n in 2..=10 {
            let edges = chain(n);
            assert_eq!(edges.len(), n - 1);
        }
    }

    #[test]
    fn ring_closes_cycle() {
        let edges = ring(5);
        assert!(edges.contains(&(4, 0)));
    }

    #[test]
    fn random_regular_basic() {
        let edges = random_regular(10, 3, 42).expect("should build 3-regular graph");
        assert_eq!(edges.len(), 10 * 3 / 2);

        // Verify degree of each vertex
        let mut degree = vec![0usize; 10];
        for (u, v) in &edges {
            degree[*u] += 1;
            degree[*v] += 1;
        }
        for d in &degree {
            assert_eq!(*d, 3);
        }
    }

    #[test]
    fn random_regular_odd_rejects() {
        // Odd n * odd degree = odd total stubs → impossible
        assert!(random_regular(5, 3, 42).is_none());
    }

    #[test]
    fn random_regular_full_degree_gives_complete() {
        // degree = n-1 = 4 for n=5 → complete graph K_5
        let edges = random_regular(5, 4, 42).expect("should give complete graph");
        assert_eq!(edges.len(), 10); // C(5,2) = 10
    }

    /// Verify spectral properties: star has λ₁ = 1, complete has λ₁ = n.
    #[test]
    fn spectral_gap_star_vs_complete() {
        use crate::propagation::sheaf::CellularSheaf;
        use crate::propagation::laplacian::spectral_analysis;

        let n = 5;
        let dim = 2;

        let star_sheaf = CellularSheaf::constant(n, dim, &star(n));
        let complete_sheaf = CellularSheaf::constant(n, dim, &complete(n));

        let star_spec = spectral_analysis(&star_sheaf);
        let complete_spec = spectral_analysis(&complete_sheaf);

        // Star: λ₁ = 1 (each stalk dim contributes 1)
        assert!((star_spec.spectral_gap - 1.0).abs() < 0.01,
            "star λ₁ should be 1.0, got {}", star_spec.spectral_gap);

        // Complete: λ₁ = n (each stalk dim contributes n)
        assert!((complete_spec.spectral_gap - n as f64).abs() < 0.01,
            "complete λ₁ should be {}, got {}", n, complete_spec.spectral_gap);

        // Star mixes slower: mixing_time(star) > mixing_time(complete)
        assert!(star_spec.mixing_time_estimate > complete_spec.mixing_time_estimate);
    }

    /// Verify ring spectral gap matches known formula.
    #[test]
    fn spectral_gap_ring() {
        use crate::propagation::sheaf::CellularSheaf;
        use crate::propagation::laplacian::spectral_analysis;

        let n = 8;
        let dim = 2;
        let sheaf = CellularSheaf::constant(n, dim, &ring(n));
        let spec = spectral_analysis(&sheaf);

        let expected = 2.0 - 2.0 * (2.0 * std::f64::consts::PI / n as f64).cos();
        assert!((spec.spectral_gap - expected).abs() < 0.01,
            "ring(8) λ₁ should be {:.4}, got {:.4}", expected, spec.spectral_gap);
    }
}
