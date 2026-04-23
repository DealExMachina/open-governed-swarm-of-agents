use crate::types::GovernanceLevel;
use std::cmp::Ordering;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Drift severity level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DriftLevel {
    None,
    Low,
    Medium,
    High,
    Critical,
}

impl DriftLevel {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "low" => Self::Low,
            "medium" => Self::Medium,
            "high" => Self::High,
            "critical" => Self::Critical,
            _ => Self::None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Critical => "critical",
        }
    }

    /// Numeric severity. Higher = more severe.
    pub fn severity(self) -> u8 {
        match self {
            Self::None => 0,
            Self::Low => 1,
            Self::Medium => 2,
            Self::High => 3,
            Self::Critical => 4,
        }
    }

    /// Conservative drift estimate: the higher severity.
    pub fn join(a: Self, b: Self) -> Self {
        if a.severity() >= b.severity() { a } else { b }
    }

    /// Optimistic drift estimate: the lower severity.
    pub fn meet(a: Self, b: Self) -> Self {
        if a.severity() <= b.severity() { a } else { b }
    }
}

impl PartialOrd for DriftLevel {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for DriftLevel {
    fn cmp(&self, other: &Self) -> Ordering {
        self.severity().cmp(&other.severity())
    }
}

/// Maps drift severity to the governance level required to contain it.
///
/// The map is anti-monotone: higher drift → more restrictive governance.
pub fn required_governance_level(drift: DriftLevel) -> GovernanceLevel {
    match drift {
        DriftLevel::None | DriftLevel::Low => GovernanceLevel::Yolo,
        DriftLevel::Medium => GovernanceLevel::Mitl,
        DriftLevel::High | DriftLevel::Critical => GovernanceLevel::Master,
    }
}

/// A policy rule: when drift matches level + type → execute action.
///
/// Port of `PolicyRule` from governance.ts.
#[derive(Debug, Clone)]
pub struct PolicyRule {
    pub when_drift_levels: Vec<DriftLevel>,
    pub when_drift_type: String,
    pub action: String,
}

/// A transition rule: block specific state transitions under certain drift levels.
///
/// Port of `TransitionRule` from governance.ts.
#[derive(Debug, Clone)]
pub struct TransitionRule {
    pub from: String,
    pub to: String,
    pub block_when_drift: Vec<DriftLevel>,
    pub reason: String,
}

/// Result of checking whether a state transition is allowed.
#[derive(Debug, Clone)]
pub struct TransitionDecision {
    pub allowed: bool,
    pub reason: String,
}

// ---------------------------------------------------------------------------
// Evaluation functions — ports from governance.ts
// ---------------------------------------------------------------------------

/// Evaluate policy rules against current drift.
///
/// Returns a list of actions to execute (e.g., "open_investigation").
///
/// Port of `evaluateRules` from governance.ts lines 70-80.
pub fn evaluate_rules(
    drift_level: &DriftLevel,
    drift_types: &[String],
    rules: &[PolicyRule],
) -> Vec<String> {
    let mut actions = Vec::new();
    for rule in rules {
        let level_match = rule.when_drift_levels.contains(drift_level);
        let type_match = drift_types.iter().any(|t| t == &rule.when_drift_type);
        if level_match && type_match {
            actions.push(rule.action.clone());
        }
    }
    actions
}

/// Check whether a state transition is allowed given current drift.
///
/// Port of `canTransition` from governance.ts lines 82-97.
pub fn can_transition(
    from: &str,
    to: &str,
    drift_level: &DriftLevel,
    transition_rules: &[TransitionRule],
) -> TransitionDecision {
    for rule in transition_rules {
        if rule.from == from && rule.to == to {
            if rule.block_when_drift.contains(drift_level) {
                return TransitionDecision {
                    allowed: false,
                    reason: rule.reason.clone(),
                };
            }
        }
    }
    TransitionDecision {
        allowed: true,
        reason: "no blocking rule".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drift_level_ordering_is_severity() {
        assert!(DriftLevel::None < DriftLevel::Low);
        assert!(DriftLevel::Low < DriftLevel::Medium);
        assert!(DriftLevel::Medium < DriftLevel::High);
        assert!(DriftLevel::High < DriftLevel::Critical);
    }

    #[test]
    fn drift_level_meet_is_lower_severity() {
        assert_eq!(DriftLevel::meet(DriftLevel::High, DriftLevel::Low), DriftLevel::Low);
        assert_eq!(DriftLevel::meet(DriftLevel::Critical, DriftLevel::Medium), DriftLevel::Medium);
        assert_eq!(DriftLevel::meet(DriftLevel::None, DriftLevel::None), DriftLevel::None);
    }

    #[test]
    fn drift_level_join_is_higher_severity() {
        assert_eq!(DriftLevel::join(DriftLevel::Medium, DriftLevel::Critical), DriftLevel::Critical);
        assert_eq!(DriftLevel::join(DriftLevel::Low, DriftLevel::High), DriftLevel::High);
        assert_eq!(DriftLevel::join(DriftLevel::None, DriftLevel::None), DriftLevel::None);
    }

    #[test]
    fn required_governance_level_is_anti_monotone() {
        // Higher drift → more restrictive (lower permissiveness) governance
        let pairs = [
            (DriftLevel::None, DriftLevel::Medium),
            (DriftLevel::None, DriftLevel::Critical),
            (DriftLevel::Medium, DriftLevel::Critical),
        ];
        for (low, high) in pairs {
            let gov_low  = required_governance_level(low);
            let gov_high = required_governance_level(high);
            assert!(
                gov_high <= gov_low,
                "required_governance_level({:?}) should be ≤ required_governance_level({:?})",
                high, low
            );
        }
    }

    #[test]
    fn required_governance_level_values() {
        assert_eq!(required_governance_level(DriftLevel::None), GovernanceLevel::Yolo);
        assert_eq!(required_governance_level(DriftLevel::Low), GovernanceLevel::Yolo);
        assert_eq!(required_governance_level(DriftLevel::Medium), GovernanceLevel::Mitl);
        assert_eq!(required_governance_level(DriftLevel::High), GovernanceLevel::Master);
        assert_eq!(required_governance_level(DriftLevel::Critical), GovernanceLevel::Master);
    }
}
