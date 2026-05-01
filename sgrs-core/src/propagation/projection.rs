use super::evidence_state::{EvidenceState, EvidenceVector};

/// Newtype wrapper certifying that an `EvidenceState` has been projected
/// onto the admissible set A. Constructable only via `AdmissibleProjection::project_certified`.
///
/// This enforces the closure lemma at the type level: any function requiring
/// `Projected<EvidenceState>` can only receive values that have passed through Π_A.
/// The compiler statically prevents unprojected evidence from entering downstream
/// operations (join, finality evaluation, etc.).
#[derive(Debug, Clone)]
pub struct Projected<T>(T);

impl<T> Projected<T> {
    /// Unwrap the projected value. Use sparingly — prefer passing `Projected<T>`
    /// through the pipeline to maintain the static guarantee.
    pub fn into_inner(self) -> T {
        self.0
    }

    /// Borrow the projected value.
    pub fn inner(&self) -> &T {
        &self.0
    }
}

/// Projection onto a convex admissible set A (box constraints).
///
/// Properties:
/// - Idempotent: Π²_A = Π_A
/// - Firmly non-expansive: ‖Π_A(x) - Π_A(y)‖ ≤ ‖x - y‖
/// - Monotone in ≤_k: x ≤_k y ⟹ Π_A(x) ≤_k Π_A(y) (componentwise clamp is monotone)
/// - Fixed-point on A: x ∈ A ⟹ Π_A(x) = x
/// - NOT extensive: Π_A can decrease components that exceed box bounds.
///   In the propagation pipeline, values outside [0,1] are diffusion artifacts,
///   so this is correct behavior — not a gap.
/// - Resolves Gap 4: when H⁰(G;F) ∩ A ≠ ∅, projection preserves contraction.
///
/// Each dimension d has independent bounds for support and refutation channels.
#[derive(Debug, Clone)]
pub struct AdmissibleProjection {
    /// Per-dimension (floor, ceiling) for support channels.
    pub support_range: Vec<(f64, f64)>,
    /// Per-dimension (floor, ceiling) for refutation channels.
    pub refutation_range: Vec<(f64, f64)>,
}

impl AdmissibleProjection {
    /// Create a uniform box projection: all channels in [0, 1].
    pub fn unit_box(num_dims: usize) -> Self {
        AdmissibleProjection {
            support_range: vec![(0.0, 1.0); num_dims],
            refutation_range: vec![(0.0, 1.0); num_dims],
        }
    }

    /// Create a projection with custom per-dimension bounds.
    pub fn new(support_range: Vec<(f64, f64)>, refutation_range: Vec<(f64, f64)>) -> Self {
        assert_eq!(support_range.len(), refutation_range.len());
        AdmissibleProjection {
            support_range,
            refutation_range,
        }
    }

    /// Number of dimensions.
    pub fn num_dims(&self) -> usize {
        self.support_range.len()
    }

    /// Project a single evidence vector onto the admissible set.
    pub fn project_vector(&self, v: &EvidenceVector) -> EvidenceVector {
        let support: Vec<f64> = v
            .support
            .iter()
            .zip(self.support_range.iter())
            .map(|(&x, &(lo, hi))| x.clamp(lo, hi))
            .collect();
        let refutation: Vec<f64> = v
            .refutation
            .iter()
            .zip(self.refutation_range.iter())
            .map(|(&x, &(lo, hi))| x.clamp(lo, hi))
            .collect();
        EvidenceVector {
            support,
            refutation,
        }
    }

    /// Project all role evidence vectors in a state onto the admissible set.
    pub fn project(&self, state: &EvidenceState) -> EvidenceState {
        EvidenceState {
            role_states: state
                .role_states
                .iter()
                .map(|v| self.project_vector(v))
                .collect(),
            num_roles: state.num_roles,
            num_dims: state.num_dims,
        }
    }

    /// Project and wrap in `Projected<EvidenceState>`, certifying the result
    /// has been projected onto A. This is the type-safe entry point for the
    /// closure lemma: downstream consumers can require `Projected<EvidenceState>`
    /// to statically guarantee all evidence has passed through Π_A.
    pub fn project_certified(&self, state: &EvidenceState) -> Projected<EvidenceState> {
        Projected(self.project(state))
    }

    /// Verify idempotence: Π(Π(x)) == Π(x) within tolerance.
    pub fn verify_idempotence(&self, state: &EvidenceState, tol: f64) -> bool {
        let once = self.project(state);
        let twice = self.project(&once);
        once.role_states
            .iter()
            .zip(twice.role_states.iter())
            .all(|(a, b)| a.distance_squared(b).sqrt() < tol)
    }
}
