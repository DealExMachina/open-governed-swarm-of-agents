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
