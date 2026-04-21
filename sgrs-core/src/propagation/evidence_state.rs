use serde::{Deserialize, Serialize};

/// Per-role evidence vector with support and refutation channels.
///
/// Practical bilattice encoding in R^{2D}, where D = number of base dimensions.
/// Each dimension has:
///   - support[d] ∈ [0,1]: evidence strength FOR dimension d
///   - refutation[d] ∈ [0,1]: evidence strength AGAINST dimension d
///
/// Bilattice semantics:
///   - Contradiction: support > θ AND refutation > θ
///   - Ignorance:     support < θ AND refutation < θ
///   - Supported:     support > θ AND refutation < θ
///   - Refuted:       support < θ AND refutation > θ
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EvidenceVector {
    pub support: Vec<f64>,
    pub refutation: Vec<f64>,
}

impl EvidenceVector {
    /// Create a new evidence vector with given dimensionality, initialized to zero.
    pub fn zeros(num_dims: usize) -> Self {
        EvidenceVector {
            support: vec![0.0; num_dims],
            refutation: vec![0.0; num_dims],
        }
    }

    /// Number of base dimensions (D, not 2D).
    pub fn num_dims(&self) -> usize {
        self.support.len()
    }

    /// Full vector length (2D: support concatenated with refutation).
    pub fn full_len(&self) -> usize {
        self.support.len() + self.refutation.len()
    }

    /// Flatten to a single Vec<f64> of length 2D: [support..., refutation...].
    pub fn to_flat(&self) -> Vec<f64> {
        let mut v = self.support.clone();
        v.extend_from_slice(&self.refutation);
        v
    }

    /// Reconstruct from a flat vector of length 2D.
    pub fn from_flat(flat: &[f64], num_dims: usize) -> Self {
        assert_eq!(flat.len(), 2 * num_dims);
        EvidenceVector {
            support: flat[..num_dims].to_vec(),
            refutation: flat[num_dims..].to_vec(),
        }
    }

    /// Dimensions where both support and refutation exceed threshold (contradiction).
    pub fn contradiction_dimensions(&self, threshold: f64) -> Vec<usize> {
        (0..self.num_dims())
            .filter(|&d| self.support[d] > threshold && self.refutation[d] > threshold)
            .collect()
    }

    /// Dimensions where both support and refutation are below threshold (ignorance).
    pub fn ignorance_dimensions(&self, threshold: f64) -> Vec<usize> {
        (0..self.num_dims())
            .filter(|&d| self.support[d] < threshold && self.refutation[d] < threshold)
            .collect()
    }

    /// Net evidence per dimension: support - refutation.
    /// Backward compatible with scalar confidence scores.
    pub fn net(&self) -> Vec<f64> {
        self.support
            .iter()
            .zip(self.refutation.iter())
            .map(|(s, r)| s - r)
            .collect()
    }

    /// Euclidean norm of the full 2D-dimensional vector.
    pub fn norm(&self) -> f64 {
        let sum: f64 = self
            .support
            .iter()
            .chain(self.refutation.iter())
            .map(|x| x * x)
            .sum();
        sum.sqrt()
    }

    /// Squared Euclidean distance to another evidence vector.
    pub fn distance_squared(&self, other: &EvidenceVector) -> f64 {
        self.support
            .iter()
            .zip(other.support.iter())
            .chain(self.refutation.iter().zip(other.refutation.iter()))
            .map(|(a, b)| (a - b) * (a - b))
            .sum()
    }

    // ── Bilattice ordering and operations ────────────────────────────────

    /// Knowledge ordering: (s₁,r₁) ≤_k (s₂,r₂) iff s₁ ≤ s₂ and r₁ ≤ r₂ (componentwise).
    /// More knowledge = higher in both support and refutation.
    pub fn leq_k(&self, other: &EvidenceVector) -> bool {
        assert_eq!(self.num_dims(), other.num_dims());
        self.support.iter().zip(other.support.iter()).all(|(a, b)| *a <= *b + f64::EPSILON)
            && self.refutation.iter().zip(other.refutation.iter()).all(|(a, b)| *a <= *b + f64::EPSILON)
    }

    /// Truth ordering: (s₁,r₁) ≤_t (s₂,r₂) iff s₁ ≤ s₂ and r₁ ≥ r₂ (componentwise).
    /// More true = higher support, lower refutation.
    pub fn leq_t(&self, other: &EvidenceVector) -> bool {
        assert_eq!(self.num_dims(), other.num_dims());
        self.support.iter().zip(other.support.iter()).all(|(a, b)| *a <= *b + f64::EPSILON)
            && self.refutation.iter().zip(other.refutation.iter()).all(|(a, b)| *a >= *b - f64::EPSILON)
    }

    /// Knowledge join: join_k(a,b) = (max(s), max(r)).
    /// Combines all evidence from both sources.
    pub fn join_k(&self, other: &EvidenceVector) -> EvidenceVector {
        assert_eq!(self.num_dims(), other.num_dims());
        EvidenceVector {
            support: self.support.iter().zip(other.support.iter())
                .map(|(a, b)| a.max(*b)).collect(),
            refutation: self.refutation.iter().zip(other.refutation.iter())
                .map(|(a, b)| a.max(*b)).collect(),
        }
    }

    /// Knowledge meet: meet_k(a,b) = (min(s), min(r)).
    /// Consensus: only evidence both sources agree on.
    pub fn meet_k(&self, other: &EvidenceVector) -> EvidenceVector {
        assert_eq!(self.num_dims(), other.num_dims());
        EvidenceVector {
            support: self.support.iter().zip(other.support.iter())
                .map(|(a, b)| a.min(*b)).collect(),
            refutation: self.refutation.iter().zip(other.refutation.iter())
                .map(|(a, b)| a.min(*b)).collect(),
        }
    }

    /// Truth join: join_t(a,b) = (max(s), min(r)).
    /// Most optimistic: strongest support, weakest refutation.
    pub fn join_t(&self, other: &EvidenceVector) -> EvidenceVector {
        assert_eq!(self.num_dims(), other.num_dims());
        EvidenceVector {
            support: self.support.iter().zip(other.support.iter())
                .map(|(a, b)| a.max(*b)).collect(),
            refutation: self.refutation.iter().zip(other.refutation.iter())
                .map(|(a, b)| a.min(*b)).collect(),
        }
    }

    /// Truth meet: meet_t(a,b) = (min(s), max(r)).
    /// Most conservative: weakest support, strongest refutation.
    /// Used for hypothesis elimination (§6.8).
    pub fn meet_t(&self, other: &EvidenceVector) -> EvidenceVector {
        assert_eq!(self.num_dims(), other.num_dims());
        EvidenceVector {
            support: self.support.iter().zip(other.support.iter())
                .map(|(a, b)| a.min(*b)).collect(),
            refutation: self.refutation.iter().zip(other.refutation.iter())
                .map(|(a, b)| a.max(*b)).collect(),
        }
    }

    /// Construct an elimination mask for a specific dimension.
    ///
    /// The mask is "neutral" (identity under meet_t) on all dimensions except
    /// the target, where it sets support=0, refutation=evidence — forcing
    /// meet_t to zero out support and maximize refutation on that dimension.
    ///
    /// meet_t(x, mask) on dimension d:
    ///   support'[d] = min(x.support[d], 0) = 0
    ///   refutation'[d] = max(x.refutation[d], evidence) = evidence
    ///
    /// On other dimensions (mask has support=1, refutation=0):
    ///   support'[i] = min(x.support[i], 1) = x.support[i]   (unchanged)
    ///   refutation'[i] = max(x.refutation[i], 0) = x.refutation[i] (unchanged)
    pub fn elimination_mask(num_dims: usize, target_dim: usize, evidence: f64) -> Self {
        assert!(target_dim < num_dims);
        assert!((0.0..=1.0).contains(&evidence));
        let mut support = vec![1.0; num_dims]; // neutral for min
        let mut refutation = vec![0.0; num_dims]; // neutral for max
        support[target_dim] = 0.0;
        refutation[target_dim] = evidence;
        EvidenceVector {
            support,
            refutation,
        }
    }

    /// Negation: neg(s,r) = (r,s). Swaps support and refutation channels.
    pub fn neg(&self) -> EvidenceVector {
        EvidenceVector {
            support: self.refutation.clone(),
            refutation: self.support.clone(),
        }
    }

    /// Pure support contribution: the positive part of this evidence in the knowledge order.
    /// Defined as join_k(self, zeros). Since values are in [0,1] this equals self.clone().
    /// Named separately to expose the positive-projection structure.
    pub fn positive_part_k(&self) -> EvidenceVector {
        let zeros = EvidenceVector::zeros(self.num_dims());
        self.join_k(&zeros)
    }

    /// Pure refutation contribution: the negative part viewed through the knowledge order.
    /// Defined as join_k(neg(self), zeros) = neg(self).
    /// Returns a vector whose support channel is the original refutation channel.
    pub fn negative_part_k(&self) -> EvidenceVector {
        let zeros = EvidenceVector::zeros(self.num_dims());
        self.neg().join_k(&zeros)
    }

    /// True when two evidence vectors are non-overlapping: for every dimension,
    /// at most one vector carries meaningful evidence (modulus = max(support, refutation)).
    /// Checks: min(modulus_self[d], modulus_other[d]) < epsilon for all d.
    pub fn is_non_overlapping_k(&self, other: &EvidenceVector, epsilon: f64) -> bool {
        assert_eq!(self.num_dims(), other.num_dims());
        for d in 0..self.num_dims() {
            let m_self  = self.support[d].max(self.refutation[d]);
            let m_other = other.support[d].max(other.refutation[d]);
            if m_self.min(m_other) > epsilon { return false; }
        }
        true
    }
}

/// Evidence state for the entire system: n roles, each with a 2D-dimensional vector.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EvidenceState {
    pub role_states: Vec<EvidenceVector>,
    pub num_roles: usize,
    pub num_dims: usize,
}

impl EvidenceState {
    /// Create a zero-initialized evidence state.
    pub fn zeros(num_roles: usize, num_dims: usize) -> Self {
        EvidenceState {
            role_states: (0..num_roles).map(|_| EvidenceVector::zeros(num_dims)).collect(),
            num_roles,
            num_dims,
        }
    }

    /// Flatten the full state into a single vector of length n × 2D.
    pub fn to_flat(&self) -> Vec<f64> {
        self.role_states.iter().flat_map(|v| v.to_flat()).collect()
    }

    /// Reconstruct from a flat vector of length n × 2D.
    pub fn from_flat(flat: &[f64], num_roles: usize, num_dims: usize) -> Self {
        let stride = 2 * num_dims;
        assert_eq!(flat.len(), num_roles * stride);
        let role_states = (0..num_roles)
            .map(|i| EvidenceVector::from_flat(&flat[i * stride..(i + 1) * stride], num_dims))
            .collect();
        EvidenceState {
            role_states,
            num_roles,
            num_dims,
        }
    }

    /// Compute the mean evidence vector across all roles.
    pub fn mean(&self) -> EvidenceVector {
        let n = self.num_roles as f64;
        let d = self.num_dims;
        let mut support = vec![0.0; d];
        let mut refutation = vec![0.0; d];
        for role in &self.role_states {
            for i in 0..d {
                support[i] += role.support[i] / n;
                refutation[i] += role.refutation[i] / n;
            }
        }
        EvidenceVector {
            support,
            refutation,
        }
    }

    /// Add another evidence state element-wise (for perturbation).
    pub fn add(&self, other: &EvidenceState) -> EvidenceState {
        assert_eq!(self.num_roles, other.num_roles);
        assert_eq!(self.num_dims, other.num_dims);
        let role_states = self
            .role_states
            .iter()
            .zip(other.role_states.iter())
            .map(|(a, b)| EvidenceVector {
                support: a
                    .support
                    .iter()
                    .zip(b.support.iter())
                    .map(|(x, y)| x + y)
                    .collect(),
                refutation: a
                    .refutation
                    .iter()
                    .zip(b.refutation.iter())
                    .map(|(x, y)| x + y)
                    .collect(),
            })
            .collect();
        EvidenceState {
            role_states,
            num_roles: self.num_roles,
            num_dims: self.num_dims,
        }
    }
}
