use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

// ---------------------------------------------------------------------------
// Dimension identity
// ---------------------------------------------------------------------------

/// The four convergence dimensions, indexed 0..3.
/// Used as indices into `[f64; 4]` arrays throughout the crate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum DimensionId {
    ClaimConfidence,
    ContradictionResolution,
    GoalCompletion,
    RiskInverse,
}

impl DimensionId {
    /// Array index for this dimension.
    pub fn index(self) -> usize {
        match self {
            Self::ClaimConfidence => 0,
            Self::ContradictionResolution => 1,
            Self::GoalCompletion => 2,
            Self::RiskInverse => 3,
        }
    }

    /// v1 TypeScript key name (backward compatibility for bridge DTOs).
    pub fn v1_name(self) -> &'static str {
        match self {
            Self::ClaimConfidence => "claim_confidence",
            Self::ContradictionResolution => "contradiction_resolution",
            Self::GoalCompletion => "goal_completion",
            Self::RiskInverse => "risk_score_inverse",
        }
    }

    /// All four dimensions in index order.
    pub const ALL: [DimensionId; 4] = [
        Self::ClaimConfidence,
        Self::ContradictionResolution,
        Self::GoalCompletion,
        Self::RiskInverse,
    ];
}

// ---------------------------------------------------------------------------
// Governance level — encodes permissiveness
// ---------------------------------------------------------------------------

/// Governance level in the lattice L.
///
/// Ordering encodes *permissiveness* (not restriction):
///   Yolo (most permissive, top) > Mitl > Master (most restrictive, bottom)
///
/// Escalation (toward restriction) is descent and always admissible.
/// De-escalation (toward permissiveness) is ascent and always rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum GovernanceLevel {
    Master,
    Mitl,
    Yolo,
}

impl GovernanceLevel {
    /// Numeric permissiveness value. Higher = more permissive.
    pub fn permissiveness(self) -> u8 {
        match self {
            Self::Master => 0,
            Self::Mitl => 1,
            Self::Yolo => 2,
        }
    }

    /// Parse from string (case-insensitive).
    pub fn from_str(s: &str) -> Self {
        match s.to_uppercase().as_str() {
            "MASTER" => Self::Master,
            "MITL" => Self::Mitl,
            "YOLO" => Self::Yolo,
            _ => Self::Master, // most restrictive default
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Master => "MASTER",
            Self::Mitl => "MITL",
            Self::Yolo => "YOLO",
        }
    }

    /// Conservative merger: choose the more restrictive governance level.
    pub fn meet(a: Self, b: Self) -> Self {
        if a.permissiveness() <= b.permissiveness() {
            a
        } else {
            b
        }
    }

    /// Liberal merger: choose the more permissive governance level.
    pub fn join(a: Self, b: Self) -> Self {
        if a.permissiveness() >= b.permissiveness() {
            a
        } else {
            b
        }
    }
}

impl PartialOrd for GovernanceLevel {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for GovernanceLevel {
    fn cmp(&self, other: &Self) -> Ordering {
        self.permissiveness().cmp(&other.permissiveness())
    }
}

// ---------------------------------------------------------------------------
// Convergence rank — vector partial order
// ---------------------------------------------------------------------------

/// Epsilon tolerance for floating-point comparisons.
pub const EPSILON: f64 = 0.001;

/// Vector convergence rank A in the product lattice M = L × A.
///
/// Dimensions are indexed by `DimensionId::index()`:
///   [0] ClaimConfidence, [1] ContradictionResolution,
///   [2] GoalCompletion, [3] RiskInverse
#[derive(Debug, Clone, PartialEq)]
pub struct ConvergenceRank {
    pub dimensions: [f64; 4],
    pub epoch: u64,
}

impl PartialOrd for ConvergenceRank {
    /// Componentwise partial order on the convergence dimensions.
    /// Returns Some(Less/Equal/Greater) when all dimensions agree,
    /// None when dimensions are incomparable (some improved, some regressed).
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        let mut has_less = false;
        let mut has_greater = false;
        for (a, b) in self.dimensions.iter().zip(other.dimensions.iter()) {
            if *a < *b - EPSILON {
                has_less = true;
            }
            if *a > *b + EPSILON {
                has_greater = true;
            }
            if has_less && has_greater {
                return None; // incomparable
            }
        }
        match (has_less, has_greater) {
            (false, false) => Some(Ordering::Equal),
            (true, false) => Some(Ordering::Less),
            (false, true) => Some(Ordering::Greater),
            (true, true) => None, // unreachable due to early return, but kept for safety
        }
    }
}

impl ConvergenceRank {
    /// True if `self` componentwise dominates `other` (all dimensions >= with EPSILON tolerance).
    pub fn dominates(&self, other: &Self) -> bool {
        self.dimensions
            .iter()
            .zip(other.dimensions.iter())
            .all(|(a, b)| *a >= *b - EPSILON)
    }

    /// Compare dimensions componentwise. Returns (improved, regressed) lists.
    pub fn compare_dimensions(&self, other: &Self) -> (Vec<DimensionId>, Vec<DimensionId>) {
        let mut improved = Vec::new();
        let mut regressed = Vec::new();
        for dim in DimensionId::ALL {
            let i = dim.index();
            let delta = other.dimensions[i] - self.dimensions[i];
            if delta > EPSILON {
                improved.push(dim);
            } else if delta < -EPSILON {
                regressed.push(dim);
            }
        }
        (improved, regressed)
    }

    /// Scalar Lyapunov V(t) — derived diagnostic, NOT used for lattice admissibility.
    pub fn scalar_v(&self, targets: &[f64; 4], weights: &[f64; 4]) -> f64 {
        self.dimensions
            .iter()
            .enumerate()
            .map(|(i, &score)| weights[i] * (targets[i] - score).powi(2))
            .sum::<f64>()
            .max(0.0)
    }

    /// Conservative estimate: componentwise minimum (greatest lower bound in the convergence order).
    pub fn meet(a: &Self, b: &Self) -> Self {
        let dimensions = std::array::from_fn(|i| a.dimensions[i].min(b.dimensions[i]));
        ConvergenceRank {
            dimensions,
            epoch: a.epoch.max(b.epoch),
        }
    }

    /// Optimistic estimate: componentwise maximum (least upper bound in the convergence order).
    pub fn join(a: &Self, b: &Self) -> Self {
        let dimensions = std::array::from_fn(|i| a.dimensions[i].max(b.dimensions[i]));
        ConvergenceRank {
            dimensions,
            epoch: a.epoch.max(b.epoch),
        }
    }

    /// Componentwise remaining deficit toward `target`, clamped to non-negative.
    /// gap[i] = max(0, target[i] - self.dimensions[i])
    pub fn gap_to_target(&self, target: &[f64; 4]) -> [f64; 4] {
        std::array::from_fn(|i| (target[i] - self.dimensions[i]).max(0.0))
    }

    /// Per-dimension remaining work in the admissible cone.
    /// Alias for gap_to_target; named separately to make the positive-cone projection
    /// explicit at call sites that reason about admissibility rather than distance.
    pub fn positive_part_wrt(&self, target: &[f64; 4]) -> [f64; 4] {
        self.gap_to_target(target)
    }
}

// ---------------------------------------------------------------------------
// Product lattice M = L × A
// ---------------------------------------------------------------------------

/// A point in the product lattice M = L × A.
#[derive(Debug, Clone)]
pub struct LatticePoint {
    pub governance: GovernanceLevel,
    pub rank: ConvergenceRank,
}

impl LatticePoint {
    /// Conservative merger of two governance proposals.
    pub fn meet(a: &Self, b: &Self) -> Self {
        LatticePoint {
            governance: GovernanceLevel::meet(a.governance, b.governance),
            rank: ConvergenceRank::meet(&a.rank, &b.rank),
        }
    }

    /// Liberal merger of two governance proposals.
    pub fn join(a: &Self, b: &Self) -> Self {
        LatticePoint {
            governance: GovernanceLevel::join(a.governance, b.governance),
            rank: ConvergenceRank::join(&a.rank, &b.rank),
        }
    }

    /// Check whether transitioning from `self` to `after` is admissible.
    ///
    /// Rules:
    /// - Governance must not ascend (no de-escalation).
    /// - Within an epoch (`same_epoch=true`), convergence rank must not regress.
    /// - Across epochs, convergence rank may spike (new context injected).
    pub fn check_transition(&self, after: &LatticePoint, same_epoch: bool) -> AdmissibilityResult {
        let gov_ok = after.governance <= self.governance;

        if same_epoch && !after.rank.dominates(&self.rank) {
            // Convergence regression within the same epoch
            let (improved, regressed) = self.rank.compare_dimensions(&after.rank);
            if !gov_ok {
                return AdmissibilityResult::BothViolated;
            }
            if improved.is_empty() {
                return AdmissibilityResult::ConvergenceViolation { regressed };
            }
            return AdmissibilityResult::Incomparable {
                improved,
                regressed,
            };
        }

        if !gov_ok {
            return AdmissibilityResult::GovernanceViolation;
        }

        AdmissibilityResult::Admissible
    }
}

// ---------------------------------------------------------------------------
// Admissibility result
// ---------------------------------------------------------------------------

/// Result of checking a lattice transition for admissibility.
#[derive(Debug, Clone, PartialEq)]
pub enum AdmissibilityResult {
    /// Transition is admissible (descent or equal in M).
    Admissible,
    /// Governance level attempted to ascend (de-escalation). Hard reject.
    GovernanceViolation,
    /// All regressed, no improved dimensions. Escalatable.
    ConvergenceViolation { regressed: Vec<DimensionId> },
    /// Some dimensions improved, some regressed. Tradeoff decision.
    Incomparable {
        improved: Vec<DimensionId>,
        regressed: Vec<DimensionId>,
    },
    /// Both governance and convergence violated.
    BothViolated,
}

// ---------------------------------------------------------------------------
// Default weights and targets
// ---------------------------------------------------------------------------

/// Default dimension weights: [claim_confidence, contradiction_resolution, goal_completion, risk_inverse].
pub const DEFAULT_WEIGHTS: [f64; 4] = [0.3, 0.3, 0.25, 0.15];

/// Default finality targets: all dimensions at 1.0.
pub const DEFAULT_TARGETS: [f64; 4] = [1.0, 1.0, 1.0, 1.0];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn governance_ordering_is_permissiveness() {
        assert!(GovernanceLevel::Yolo > GovernanceLevel::Mitl);
        assert!(GovernanceLevel::Mitl > GovernanceLevel::Master);
        assert!(GovernanceLevel::Yolo > GovernanceLevel::Master);
        assert_eq!(GovernanceLevel::Master.permissiveness(), 0);
        assert_eq!(GovernanceLevel::Yolo.permissiveness(), 2);
    }

    #[test]
    fn escalation_is_descent() {
        // Yolo -> Mitl is descent (permissiveness decreases)
        assert!(GovernanceLevel::Yolo > GovernanceLevel::Mitl);
        // Mitl -> Master is descent
        assert!(GovernanceLevel::Mitl > GovernanceLevel::Master);
    }

    #[test]
    fn deescalation_is_ascent() {
        // Master -> Yolo would be ascent (rejected by check_transition)
        assert!(GovernanceLevel::Master < GovernanceLevel::Yolo);
    }

    #[test]
    fn convergence_rank_dominates() {
        let a = ConvergenceRank {
            dimensions: [0.8, 0.7, 0.6, 0.5],
            epoch: 1,
        };
        let b = ConvergenceRank {
            dimensions: [0.8, 0.7, 0.6, 0.5],
            epoch: 1,
        };
        assert!(a.dominates(&b));
        assert!(b.dominates(&a));
    }

    #[test]
    fn convergence_rank_dominates_with_improvement() {
        let before = ConvergenceRank {
            dimensions: [0.5, 0.5, 0.5, 0.5],
            epoch: 1,
        };
        let after = ConvergenceRank {
            dimensions: [0.6, 0.6, 0.6, 0.6],
            epoch: 1,
        };
        assert!(after.dominates(&before));
        assert!(!before.dominates(&after));
    }

    #[test]
    fn convergence_rank_incomparable() {
        let a = ConvergenceRank {
            dimensions: [0.8, 0.5, 0.6, 0.5],
            epoch: 1,
        };
        let b = ConvergenceRank {
            dimensions: [0.5, 0.8, 0.6, 0.5],
            epoch: 1,
        };
        assert!(!a.dominates(&b));
        assert!(!b.dominates(&a));
    }

    #[test]
    fn lattice_check_transition_admissible_same_epoch() {
        let before = LatticePoint {
            governance: GovernanceLevel::Yolo,
            rank: ConvergenceRank {
                dimensions: [0.5, 0.5, 0.5, 0.5],
                epoch: 1,
            },
        };
        let after = LatticePoint {
            governance: GovernanceLevel::Yolo,
            rank: ConvergenceRank {
                dimensions: [0.6, 0.6, 0.6, 0.6],
                epoch: 1,
            },
        };
        assert_eq!(
            before.check_transition(&after, true),
            AdmissibilityResult::Admissible
        );
    }

    #[test]
    fn lattice_check_transition_governance_violation() {
        let before = LatticePoint {
            governance: GovernanceLevel::Mitl,
            rank: ConvergenceRank {
                dimensions: [0.5, 0.5, 0.5, 0.5],
                epoch: 1,
            },
        };
        let after = LatticePoint {
            governance: GovernanceLevel::Yolo, // de-escalation = ascent
            rank: ConvergenceRank {
                dimensions: [0.6, 0.6, 0.6, 0.6],
                epoch: 1,
            },
        };
        assert_eq!(
            before.check_transition(&after, true),
            AdmissibilityResult::GovernanceViolation
        );
    }

    #[test]
    fn lattice_check_transition_convergence_violation_same_epoch() {
        let before = LatticePoint {
            governance: GovernanceLevel::Yolo,
            rank: ConvergenceRank {
                dimensions: [0.8, 0.8, 0.8, 0.8],
                epoch: 1,
            },
        };
        let after = LatticePoint {
            governance: GovernanceLevel::Yolo,
            rank: ConvergenceRank {
                dimensions: [0.5, 0.5, 0.5, 0.5], // all regressed
                epoch: 1,
            },
        };
        match before.check_transition(&after, true) {
            AdmissibilityResult::ConvergenceViolation { regressed } => {
                assert_eq!(regressed.len(), 4);
            }
            other => panic!("expected ConvergenceViolation, got {:?}", other),
        }
    }

    #[test]
    fn lattice_check_transition_cross_epoch_allows_regression() {
        let before = LatticePoint {
            governance: GovernanceLevel::Yolo,
            rank: ConvergenceRank {
                dimensions: [0.8, 0.8, 0.8, 0.8],
                epoch: 1,
            },
        };
        let after = LatticePoint {
            governance: GovernanceLevel::Yolo,
            rank: ConvergenceRank {
                dimensions: [0.5, 0.5, 0.5, 0.5],
                epoch: 2,
            },
        };
        // Cross-epoch: convergence regression allowed
        assert_eq!(
            before.check_transition(&after, false),
            AdmissibilityResult::Admissible
        );
    }

    #[test]
    fn lattice_check_transition_incomparable() {
        let before = LatticePoint {
            governance: GovernanceLevel::Yolo,
            rank: ConvergenceRank {
                dimensions: [0.8, 0.5, 0.6, 0.5],
                epoch: 1,
            },
        };
        let after = LatticePoint {
            governance: GovernanceLevel::Yolo,
            rank: ConvergenceRank {
                dimensions: [0.5, 0.8, 0.6, 0.5], // claim regressed, contra improved
                epoch: 1,
            },
        };
        match before.check_transition(&after, true) {
            AdmissibilityResult::Incomparable {
                improved,
                regressed,
            } => {
                assert!(improved.contains(&DimensionId::ContradictionResolution));
                assert!(regressed.contains(&DimensionId::ClaimConfidence));
            }
            other => panic!("expected Incomparable, got {:?}", other),
        }
    }

    #[test]
    fn lattice_check_transition_both_violated() {
        let before = LatticePoint {
            governance: GovernanceLevel::Mitl,
            rank: ConvergenceRank {
                dimensions: [0.8, 0.8, 0.8, 0.8],
                epoch: 1,
            },
        };
        let after = LatticePoint {
            governance: GovernanceLevel::Yolo, // de-escalation
            rank: ConvergenceRank {
                dimensions: [0.5, 0.5, 0.5, 0.5], // regression
                epoch: 1,
            },
        };
        assert_eq!(
            before.check_transition(&after, true),
            AdmissibilityResult::BothViolated
        );
    }

    #[test]
    fn convergence_rank_partial_ord_consistent_with_dominates() {
        let a = ConvergenceRank {
            dimensions: [0.5, 0.5, 0.5, 0.5],
            epoch: 1,
        };
        let b = ConvergenceRank {
            dimensions: [0.6, 0.6, 0.6, 0.6],
            epoch: 1,
        };
        // b dominates a → b > a in partial order
        assert!(b.dominates(&a));
        assert!(b > a);
        assert!(a < b);
    }

    #[test]
    fn convergence_rank_partial_ord_incomparable() {
        let a = ConvergenceRank {
            dimensions: [0.8, 0.5, 0.6, 0.5],
            epoch: 1,
        };
        let b = ConvergenceRank {
            dimensions: [0.5, 0.8, 0.6, 0.5],
            epoch: 1,
        };
        // Neither dominates → partial_cmp returns None
        assert!(a.partial_cmp(&b).is_none());
    }

    #[test]
    fn convergence_rank_partial_ord_equal() {
        let a = ConvergenceRank {
            dimensions: [0.5, 0.5, 0.5, 0.5],
            epoch: 1,
        };
        let b = ConvergenceRank {
            dimensions: [0.5, 0.5, 0.5, 0.5],
            epoch: 1,
        };
        assert_eq!(a.partial_cmp(&b), Some(std::cmp::Ordering::Equal));
    }

    #[test]
    fn escalation_with_same_convergence_is_admissible() {
        let before = LatticePoint {
            governance: GovernanceLevel::Yolo,
            rank: ConvergenceRank {
                dimensions: [0.5, 0.5, 0.5, 0.5],
                epoch: 1,
            },
        };
        let after = LatticePoint {
            governance: GovernanceLevel::Mitl, // escalation = descent
            rank: ConvergenceRank {
                dimensions: [0.5, 0.5, 0.5, 0.5],
                epoch: 1,
            },
        };
        assert_eq!(
            before.check_transition(&after, true),
            AdmissibilityResult::Admissible
        );
    }

    // --- GovernanceLevel meet / join ---

    #[test]
    fn governance_meet_chooses_most_restrictive() {
        assert_eq!(
            GovernanceLevel::meet(GovernanceLevel::Yolo, GovernanceLevel::Master),
            GovernanceLevel::Master
        );
        assert_eq!(
            GovernanceLevel::meet(GovernanceLevel::Mitl, GovernanceLevel::Yolo),
            GovernanceLevel::Mitl
        );
        assert_eq!(
            GovernanceLevel::meet(GovernanceLevel::Master, GovernanceLevel::Master),
            GovernanceLevel::Master
        );
    }

    #[test]
    fn governance_join_chooses_most_permissive() {
        assert_eq!(
            GovernanceLevel::join(GovernanceLevel::Master, GovernanceLevel::Yolo),
            GovernanceLevel::Yolo
        );
        assert_eq!(
            GovernanceLevel::join(GovernanceLevel::Mitl, GovernanceLevel::Master),
            GovernanceLevel::Mitl
        );
        assert_eq!(
            GovernanceLevel::join(GovernanceLevel::Yolo, GovernanceLevel::Yolo),
            GovernanceLevel::Yolo
        );
    }

    // --- ConvergenceRank meet / join ---

    fn rank(dims: [f64; 4]) -> ConvergenceRank {
        ConvergenceRank {
            dimensions: dims,
            epoch: 1,
        }
    }

    #[test]
    fn convergence_rank_meet_is_componentwise_min() {
        let a = rank([0.8, 0.4, 0.7, 0.9]);
        let b = rank([0.5, 0.9, 0.6, 0.3]);
        let m = ConvergenceRank::meet(&a, &b);
        assert!((m.dimensions[0] - 0.5).abs() < EPSILON);
        assert!((m.dimensions[1] - 0.4).abs() < EPSILON);
        assert!((m.dimensions[2] - 0.6).abs() < EPSILON);
        assert!((m.dimensions[3] - 0.3).abs() < EPSILON);
    }

    #[test]
    fn convergence_rank_join_is_componentwise_max() {
        let a = rank([0.8, 0.4, 0.7, 0.9]);
        let b = rank([0.5, 0.9, 0.6, 0.3]);
        let j = ConvergenceRank::join(&a, &b);
        assert!((j.dimensions[0] - 0.8).abs() < EPSILON);
        assert!((j.dimensions[1] - 0.9).abs() < EPSILON);
        assert!((j.dimensions[2] - 0.7).abs() < EPSILON);
        assert!((j.dimensions[3] - 0.9).abs() < EPSILON);
    }

    #[test]
    fn convergence_rank_meet_dominated_by_both_inputs() {
        let a = rank([0.8, 0.4, 0.7, 0.9]);
        let b = rank([0.5, 0.9, 0.6, 0.3]);
        let m = ConvergenceRank::meet(&a, &b);
        assert!(a.dominates(&m));
        assert!(b.dominates(&m));
    }

    #[test]
    fn convergence_rank_join_dominates_both_inputs() {
        let a = rank([0.8, 0.4, 0.7, 0.9]);
        let b = rank([0.5, 0.9, 0.6, 0.3]);
        let j = ConvergenceRank::join(&a, &b);
        assert!(j.dominates(&a));
        assert!(j.dominates(&b));
    }

    #[test]
    fn gap_to_target_is_nonnegative_residual() {
        let r = rank([0.6, 1.2, 0.9, 0.5]);
        let target = [1.0, 1.0, 1.0, 1.0];
        let gap = r.gap_to_target(&target);
        assert!((gap[0] - 0.4).abs() < EPSILON);
        assert!((gap[1] - 0.0).abs() < EPSILON); // exceeds target → clamped to 0
        assert!((gap[2] - 0.1).abs() < EPSILON);
        assert!((gap[3] - 0.5).abs() < EPSILON);
    }

    #[test]
    fn positive_part_wrt_equals_gap_to_target() {
        let r = rank([0.3, 0.7, 0.5, 0.9]);
        let target = [0.85, 0.95, 0.90, 0.80];
        let gap = r.gap_to_target(&target);
        let pp = r.positive_part_wrt(&target);
        for i in 0..4 {
            assert!((gap[i] - pp[i]).abs() < 1e-15);
        }
    }

    // --- LatticePoint meet / join ---

    #[test]
    fn lattice_point_meet_is_conservative() {
        let a = LatticePoint {
            governance: GovernanceLevel::Mitl,
            rank: rank([0.8, 0.4, 0.7, 0.9]),
        };
        let b = LatticePoint {
            governance: GovernanceLevel::Yolo,
            rank: rank([0.5, 0.9, 0.6, 0.3]),
        };
        let m = LatticePoint::meet(&a, &b);
        // More restrictive governance
        assert_eq!(m.governance, GovernanceLevel::Mitl);
        // Rank dominated by both inputs
        assert!(a.rank.dominates(&m.rank));
        assert!(b.rank.dominates(&m.rank));
    }

    #[test]
    fn lattice_point_join_is_liberal() {
        let a = LatticePoint {
            governance: GovernanceLevel::Mitl,
            rank: rank([0.8, 0.4, 0.7, 0.9]),
        };
        let b = LatticePoint {
            governance: GovernanceLevel::Master,
            rank: rank([0.5, 0.9, 0.6, 0.3]),
        };
        let j = LatticePoint::join(&a, &b);
        // More permissive governance
        assert_eq!(j.governance, GovernanceLevel::Mitl);
        // Rank dominates both inputs
        assert!(j.rank.dominates(&a.rank));
        assert!(j.rank.dominates(&b.rank));
    }
}
