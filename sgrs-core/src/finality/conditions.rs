use crate::convergence::SnapshotInput;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Comparison operator for finality conditions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComparisonOp {
    Gte, // >=
    Lte, // <=
    Gt,  // >
    Lt,  // <
    Eq,  // ==
}

impl ComparisonOp {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Gte => ">=",
            Self::Lte => "<=",
            Self::Gt => ">",
            Self::Lt => "<",
            Self::Eq => "==",
        }
    }
}

/// A parsed finality condition: `key op value`.
#[derive(Debug, Clone)]
pub struct Condition {
    pub key: String,
    pub op: ComparisonOp,
    pub value: f64,
}

/// Extended snapshot with all fields needed for finality condition evaluation.
/// Superset of `SnapshotInput` — includes idle/age fields for BLOCKED/EXPIRED.
#[derive(Debug, Clone)]
pub struct FinalitySnapshotFull {
    // Core fields (same as SnapshotInput)
    pub claims_active_avg_confidence: f64,
    pub contradictions_unresolved_count: u32,
    pub contradictions_total_count: u32,
    pub goals_completion_ratio: f64,
    pub scope_risk_score: f64,
    // Extended fields
    pub claims_active_min_confidence: f64,
    pub claims_active_count: u32,
    pub risks_critical_active_count: u32,
    pub scope_idle_cycles: u32,
    pub scope_last_delta_age_ms: u64,
    pub scope_last_active_age_ms: u64,
    pub assessments_critical_unaddressed_count: u32,
    /// Gate B: weighted contradiction mass (severity x materiality).
    pub contradiction_mass: f64,
    /// Gate B: evidence coverage ratio (0-1).
    pub evidence_coverage: f64,
    /// Gate F: whether all dimensions with refutation > θ have been formally eliminated.
    /// Computed externally by the propagation layer. Default true (when elimination is not used).
    pub elimination_complete: bool,
}

impl FinalitySnapshotFull {
    /// Convert to the smaller SnapshotInput used by convergence math.
    pub fn to_snapshot_input(&self) -> SnapshotInput {
        SnapshotInput {
            claims_active_avg_confidence: self.claims_active_avg_confidence,
            contradictions_unresolved_count: self.contradictions_unresolved_count,
            contradictions_total_count: self.contradictions_total_count,
            goals_completion_ratio: self.goals_completion_ratio,
            scope_risk_score: self.scope_risk_score,
        }
    }
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/// Parse a condition string like `"claims.active.min_confidence: 0.85"` or
/// `"scope.risk_score: \"< 0.20\""`.
///
/// Port of `parseCondition` from finalityEvaluator.ts lines 151-164.
pub fn parse_condition(condition: &str) -> Condition {
    let colon = match condition.find(':') {
        Some(pos) => pos,
        None => {
            return Condition {
                key: String::new(),
                op: ComparisonOp::Eq,
                value: 0.0,
            }
        }
    };

    let key = condition[..colon].trim().to_string();
    let rest = condition[colon + 1..].trim();
    // Strip surrounding quotes
    let rest = rest
        .strip_prefix('"')
        .or_else(|| rest.strip_prefix('\''))
        .map(|s| {
            s.strip_suffix('"')
                .or_else(|| s.strip_suffix('\''))
                .unwrap_or(s)
        })
        .unwrap_or(rest)
        .trim();

    // Try to match operator prefix: >=, <=, >, <, ==
    if let Some((op, num_str)) = try_parse_op_value(rest) {
        if let Ok(value) = num_str.parse::<f64>() {
            return Condition { key, op, value };
        }
    }

    // No operator prefix — parse as plain number, default op is >=
    // Exception: if value is 0 and key contains "count", default op is ==
    let value = rest.parse::<f64>().unwrap_or(0.0);
    let op = if value == 0.0 && (key.contains("count") || key.contains("_count")) {
        ComparisonOp::Eq
    } else {
        ComparisonOp::Gte
    };

    Condition { key, op, value }
}

/// Try to extract an operator and numeric string from the rest of the condition.
fn try_parse_op_value(s: &str) -> Option<(ComparisonOp, &str)> {
    // Order matters: check two-char ops before single-char
    for (prefix, op) in &[
        (">=", ComparisonOp::Gte),
        ("<=", ComparisonOp::Lte),
        ("==", ComparisonOp::Eq),
        (">", ComparisonOp::Gt),
        ("<", ComparisonOp::Lt),
    ] {
        if let Some(rest) = s.strip_prefix(prefix) {
            return Some((*op, rest.trim()));
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Evaluate
// ---------------------------------------------------------------------------

/// Evaluate a single condition against a snapshot.
///
/// Returns `Some(true/false)` if the key is known, `None` if unknown.
///
/// Port of `evaluateOne` from finalityEvaluator.ts lines 166-214.
pub fn evaluate_condition(condition: &Condition, snapshot: &FinalitySnapshotFull) -> Option<bool> {
    let actual = resolve_key(&condition.key, snapshot)?;
    Some(compare(actual, condition.op, condition.value))
}

/// Resolve a condition key to its snapshot value.
fn resolve_key(key: &str, snapshot: &FinalitySnapshotFull) -> Option<f64> {
    match key {
        "claims.active.avg_confidence" => Some(snapshot.claims_active_avg_confidence),
        "claims.active.min_confidence" => Some(snapshot.claims_active_min_confidence),
        "claims.active.count" => Some(snapshot.claims_active_count as f64),
        "contradictions.unresolved_count" => Some(snapshot.contradictions_unresolved_count as f64),
        "contradictions.total_count" | "contradictions.total.count" => {
            Some(snapshot.contradictions_total_count as f64)
        }
        "risks.critical.active_count" => Some(snapshot.risks_critical_active_count as f64),
        "goals.completion_ratio" | "goals.completion" => Some(snapshot.goals_completion_ratio),
        "scope.risk_score" => Some(snapshot.scope_risk_score),
        "scope.idle_cycles" => Some(snapshot.scope_idle_cycles as f64),
        "scope.last_delta_age_ms" => Some(snapshot.scope_last_delta_age_ms as f64),
        "scope.last_active_age_ms" => Some(snapshot.scope_last_active_age_ms as f64),
        "assessments.critical_unaddressed_count" | "assessments.critical_unaddressed.count" => {
            Some(snapshot.assessments_critical_unaddressed_count as f64)
        }
        _ => None,
    }
}

/// Apply a comparison operator.
fn compare(actual: f64, op: ComparisonOp, target: f64) -> bool {
    match op {
        ComparisonOp::Gte => actual >= target,
        ComparisonOp::Lte => actual <= target,
        ComparisonOp::Gt => actual > target,
        ComparisonOp::Lt => actual < target,
        ComparisonOp::Eq => (actual - target).abs() < f64::EPSILON,
    }
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/// Format a condition as `"key op value"`.
pub fn condition_to_string(condition: &Condition) -> String {
    format!(
        "{} {} {}",
        condition.key,
        condition.op.as_str(),
        condition.value
    )
}
