use super::lattice::concept_lattice_size;

/// Simple finality proxy on concept space:
/// final when lattice size stays below threshold and does not overflow.
pub fn check_finality_on_concepts(
    rows: &[u32],
    attrs: usize,
    lattice_threshold: usize,
    max_concepts: usize,
) -> (bool, usize, bool) {
    let (count, overflow) = concept_lattice_size(rows, attrs, max_concepts);
    let is_final = !overflow && count <= lattice_threshold;
    (is_final, count, overflow)
}
