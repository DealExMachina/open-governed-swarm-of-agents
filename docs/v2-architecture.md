# V2 Architecture -- Stratified Governed Reduction System with Unified Lattice Descent

## 0. Premise

The v1 system implements convergence, governance, and finality as loosely coupled TypeScript modules. The theory (docs/theory-framing.md) defines a tighter structure: a product lattice M = L x A where governance and convergence are unified into a single well-founded descent domain with a deterministic reduction kernel. The v1 modules approximate this but do not enforce it structurally.

V2 extracts the formal core into a Rust engine. The engine owns the mathematical invariants. Everything else -- I/O, LLM calls, messaging, storage -- stays in Node.js/TypeScript. The boundary is a napi-rs FFI bridge.

---

## 1. What Moves to Rust, What Stays in TypeScript

### Rust core engine (`sgrs-core`)

Everything that must be deterministic, replayable, and structurally invariant:

| Component | Current TS module | Why Rust |
|-----------|-------------------|----------|
| Governance lattice L | governance.ts, policyEngine.ts | Exhaustive match on policy rules; compile-time transition verification |
| Convergence rank A | convergenceTracker.ts (pure functions) | Numerical stability, no GC jitter on hot path |
| Product lattice M = L x A | Not explicit in v1 | New: the central abstraction. Must be correct by construction |
| Reduction kernel | Spread across governanceAgent.ts, finalityEvaluator.ts | The deterministic filter: proposal -> {Accept, Reject, Escalate} |
| Lyapunov V(t), pressure, dimension scores | convergenceTracker.ts | Pure math, zero allocation |
| Five-gate finality predicate F(t) | finalityEvaluator.ts (evaluateFinality) | Gate conjunction must be deterministic and replayable |
| Trajectory quality Q(t) | convergenceTracker.ts (analyzeConvergence) | Oscillation detection, autocorrelation |
| Condition evaluator | finalityEvaluator.ts (parseCondition, evaluateOne) | YAML-driven condition matching |
| Decision record builder | decisionRecorder.ts (struct only) | Immutable audit record |
| State machine transitions | stateGraph.ts (canTransition) | Compile-time exhaustive match |

### TypeScript orchestration layer (unchanged)

Everything I/O-bound, non-deterministic, or infrastructure-dependent:

| Component | Current TS module | Why stays |
|-----------|-------------------|-----------|
| NATS JetStream | eventBus.ts | I/O; async; mature TS SDK |
| Agent loops | agentLoop.ts, agents/* | LLM calls dominate (30s+); language irrelevant |
| Semantic graph (Postgres) | semanticGraph.ts | SQL queries; pgvector; I/O-bound |
| S3 storage | s3.ts | AWS SDK; I/O-bound |
| OpenFGA authorization | Checked via HTTP | No Rust SDK |
| Hatchery / scaling | hatchery.ts | Orchestration logic; rare hot path |
| LLM oversight | governanceAgent.ts (LLM paths) | Non-deterministic by nature |
| MITL server | mitlServer.ts | HTTP; human interaction |
| Context WAL | contextWal.ts | Postgres append; I/O-bound |
| OTEL metrics emission | metrics.ts | opentelemetry-rust exists but TS SDK is mature |

---

## 2. The Rust Core: `sgrs-core`

### 2.1 Crate structure

```
sgrs-core/
  Cargo.toml
  src/
    lib.rs              -- Public API surface
    error.rs            -- KernelError (typed, no panics)
    lattice/
      mod.rs            -- Product lattice M = L x A
      governance.rs     -- GovernanceLevel with manual Ord (permissiveness)
      convergence.rs    -- ConvergenceRank (structural potential)
      admissibility.rs  -- AdmissibilityResult, LatticePoint::check_transition
    reduction/
      mod.rs            -- Reduction kernel (stateless)
      proposal.rs       -- CandidateProposal, ValidatedProposal, admission gate
      transition.rs     -- ProcessingState + FinalityStatus transition table
      triage.rs         -- Oversight triage classification
      mitl.rs           -- MITL re-entry after human decision
    finality/
      mod.rs            -- Five-gate finality predicate
      gates.rs          -- Individual gate implementations (Gate B now enforced)
      conditions.rs     -- YAML-driven condition evaluator
      snapshot.rs       -- FinalitySnapshot struct
    convergence/
      mod.rs            -- Convergence analysis (pure)
      lyapunov.rs       -- V(t), dimension scores, pressure
      trajectory.rs     -- Q(t), oscillation, autocorrelation
      plateau.rs        -- EMA plateau detection
    config/
      mod.rs            -- Configuration types
      governance.rs     -- GovernanceConfig from YAML
      finality.rs       -- FinalityConfig from YAML
    types/
      mod.rs            -- Shared domain types (Epoch, DriftLevel, etc.)
    replay/
      mod.rs            -- Deterministic replay from decision log + config snapshots
```

### 2.2 Core types

> **Design note:** This section is the single authoritative type
> definition. Sections 10-12 provide motivation and rationale for
> the design choices made here (scalar vs vector, proposal decoupling).
> In case of conflict, this section wins.

```rust
// ============================================================
// Lattice layer
// ============================================================

/// Governance lattice element.
///
/// Ordering encodes *permissiveness*, not restrictiveness:
///   Yolo (2) > Mitl (1) > Master (0)
///
/// A descent in the lattice means moving toward *more* restriction.
/// Escalation (Yolo → Mitl, or Mitl → Master) is a descent and is
/// always admissible. De-escalation (Master → Yolo) is an ascent
/// and is rejected by the kernel.
///
/// This resolves the v1 MASTER ambiguity: MASTER is the most
/// restrictive level (the lattice bottom), not a bypass.
///
/// NOTE: We implement `PartialOrd` manually instead of deriving,
/// because `derive(Ord)` on enums uses declaration order, and we
/// need Master (declared last) to be the *minimum*.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GovernanceLevel {
    Yolo,
    Mitl,
    Master,
}

impl GovernanceLevel {
    /// Permissiveness rank. Higher = more permissive.
    /// Master (most restrictive) = 0, Yolo (most permissive) = 2.
    fn permissiveness(self) -> u8 {
        match self {
            GovernanceLevel::Master => 0,
            GovernanceLevel::Mitl => 1,
            GovernanceLevel::Yolo => 2,
        }
    }
}

impl PartialOrd for GovernanceLevel {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.permissiveness().cmp(&other.permissiveness()))
    }
}

impl Ord for GovernanceLevel {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.permissiveness().cmp(&other.permissiveness())
    }
}

/// The four convergence dimensions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DimensionId {
    ClaimConfidence,
    ContradictionResolution,
    GoalCompletion,
    RiskInverse,
}

/// Convergence rank: a vector over dimensions.
///
/// Ordered componentwise (product order): a >= b iff a_i >= b_i
/// for all i. This is a partial order — two ranks may be
/// incomparable (one dimension improved, another regressed).
///
/// The epoch is metadata, not part of the ordering. Epoch-awareness
/// is handled by `LatticePoint::check_transition`.
#[derive(Debug, Clone)]
pub struct ConvergenceRank {
    pub dimensions: [f64; 4],  // indexed by DimensionId ordinal
    pub epoch: u64,
}

const EPSILON: f64 = 0.001;

impl ConvergenceRank {
    /// Componentwise partial order: self >= other iff every dimension
    /// of self is >= the corresponding dimension of other (within epsilon).
    pub fn dominates(&self, other: &ConvergenceRank) -> bool {
        self.dimensions.iter().zip(other.dimensions.iter())
            .all(|(a, b)| *a >= *b - EPSILON)
    }

    /// Identify which dimensions regressed and which improved.
    pub fn compare_dimensions(&self, before: &ConvergenceRank)
        -> (Vec<DimensionId>, Vec<DimensionId>)
    {
        let dims = [
            DimensionId::ClaimConfidence,
            DimensionId::ContradictionResolution,
            DimensionId::GoalCompletion,
            DimensionId::RiskInverse,
        ];
        let mut improved = vec![];
        let mut regressed = vec![];
        for (i, dim) in dims.iter().enumerate() {
            if self.dimensions[i] > before.dimensions[i] + EPSILON {
                improved.push(*dim);
            } else if self.dimensions[i] < before.dimensions[i] - EPSILON {
                regressed.push(*dim);
            }
        }
        (improved, regressed)
    }

    /// Scalar V(t) — derived diagnostic, NOT used for admissibility.
    /// Used for ETA estimation, dashboard display, and convergence rate.
    pub fn scalar_v(&self, targets: &[f64; 4], weights: &[f64; 4]) -> f64 {
        self.dimensions.iter()
            .zip(targets.iter())
            .zip(weights.iter())
            .map(|((actual, target), w)| w * (target - actual).powi(2))
            .sum::<f64>()
            .max(0.0)
    }
}

/// Product lattice M = L x A.
/// Ordered by the product of two descent domains:
///   - L: governance permissiveness (Yolo > Mitl > Master)
///   - A: convergence rank (componentwise partial order on dimensions)
///
/// A transition is admissible iff it does not ascend in M.
/// The check returns a typed result that distinguishes governance
/// violations (hard reject) from convergence violations (escalatable)
/// from incomparable transitions (tradeoffs).
#[derive(Debug, Clone)]
pub struct LatticePoint {
    pub governance: GovernanceLevel,
    pub rank: ConvergenceRank,
}

/// Result of a lattice admissibility check.
#[derive(Debug, Clone, PartialEq)]
pub enum AdmissibilityResult {
    /// Transition is admissible (descent or equal in both components).
    Admissible,
    /// Governance level would decrease in restrictiveness (de-escalation).
    /// Hard reject — cannot be overridden.
    GovernanceViolation,
    /// Some dimensions regressed within the same epoch, but none improved.
    /// Can be escalated to MITL for human approval.
    ConvergenceViolation { regressed: Vec<DimensionId> },
    /// Some dimensions improved, some regressed — a tradeoff.
    /// Routed by governance level: Yolo checks policy, Mitl escalates,
    /// Master rejects.
    Incomparable {
        improved: Vec<DimensionId>,
        regressed: Vec<DimensionId>,
    },
    /// Both governance and convergence violated.
    BothViolated,
}

impl LatticePoint {
    /// Check admissibility of a transition from `self` to `after`.
    ///
    /// Governance: permissiveness must not increase
    /// (escalation OK, de-escalation rejected).
    /// Convergence (intra-epoch only): no dimension may regress
    /// unless another improves (incomparable → escalation).
    /// Cross-epoch: convergence constraint is relaxed.
    pub fn check_transition(&self, after: &LatticePoint, same_epoch: bool)
        -> AdmissibilityResult
    {
        let gov_ok = self.governance >= after.governance;

        if !gov_ok {
            // Check convergence too so we can report BothViolated
            if same_epoch && !after.rank.dominates(&self.rank) {
                return AdmissibilityResult::BothViolated;
            }
            return AdmissibilityResult::GovernanceViolation;
        }

        if !same_epoch {
            return AdmissibilityResult::Admissible;
        }

        // Intra-epoch: check componentwise
        if after.rank.dominates(&self.rank) {
            return AdmissibilityResult::Admissible;
        }

        // Some dimension regressed. Check if it's a pure regression
        // or a tradeoff (some improved, some regressed).
        let (improved, regressed) = after.rank.compare_dimensions(&self.rank);
        if improved.is_empty() {
            AdmissibilityResult::ConvergenceViolation { regressed }
        } else {
            AdmissibilityResult::Incomparable { improved, regressed }
        }
    }
}

// ============================================================
// Proposal and reduction
// ============================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReductionVerdict {
    Accept,
    Reject,
    Escalate,
}

/// What agents produce. Untrusted. May be malformed, duplicate, or spam.
/// Agents do NOT set governance mode or drift — those come from scope state.
pub struct CandidateProposal {
    pub id: String,
    pub proposer: String,
    pub scope_id: String,
    pub from_state: String,    // raw string, not yet validated
    pub to_state: String,      // raw string, not yet validated
    pub payload: serde_json::Value,
    pub timestamp: String,
}

/// Newtype wrappers for validated identifiers.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ProposalId(pub String);
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct AgentId(pub String);
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ScopeId(pub String);

/// After admission gate. Structurally valid. Deduplicated.
/// The `mode` field is absent — governance mode is resolved from
/// scope configuration by the kernel, not carried on the proposal.
/// Drift level is injected by the admission gate from scope state.
pub struct ValidatedProposal {
    pub id: ProposalId,
    pub proposer: AgentId,
    pub scope_id: ScopeId,
    pub from_state: CaseState,    // parsed and validated enum
    pub to_state: CaseState,      // parsed and validated enum
    pub drift_level: DriftLevel,  // from scope state, not from agent
    pub drift_types: Vec<String>, // from scope state
    pub epoch: u64,               // from scope state
}

/// Post-decision action required by policy.
#[derive(Debug, Clone)]
pub struct Obligation {
    pub kind: String,        // e.g. "notify", "audit", "require_review"
    pub params: serde_json::Value,
}

/// Identifies which governance path produced the decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GovernancePath {
    Deterministic,           // kernel only
    OversightAccepted,       // oversight LLM accepted deterministic result
    OversightEscalatedLlm,   // oversight escalated to full governance LLM
    OversightEscalatedHuman, // oversight escalated to MITL
    MitlResolved,            // human resolved via MITL
}

/// Immutable decision record.
pub struct DecisionRecord {
    pub decision_id: String,
    pub timestamp: String,
    pub policy_version: String,
    pub config_snapshot_hash: String,  // for replay: hash of governance+finality YAML
    pub verdict: ReductionVerdict,
    pub admissibility: AdmissibilityResult,
    pub reason: String,
    pub obligations: Vec<Obligation>,
    pub governance_path: GovernancePath,
    pub lattice_before: LatticePoint,
    pub lattice_after: Option<LatticePoint>,
    pub epoch: u64,
    pub scope_id: ScopeId,
}

// ============================================================
// State machine
// ============================================================

/// Processing states (the ingest-extract-check cycle).
/// These are the states agents advance through during analysis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ProcessingState {
    ContextIngested,
    FactsExtracted,
    DriftChecked,
}

/// Finality states (the resolution lifecycle).
/// These are set by the finality evaluator, not by agent proposals.
/// The two state spaces are orthogonal: a scope has both a processing
/// state and a finality status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FinalityStatus {
    Active,
    Resolved,
    Escalated,
    Blocked,
    Suspended,
    Superseded,
    Expired,
}

/// Combined case state for the reduction kernel.
/// Agent proposals target `Processing` transitions.
/// The finality evaluator targets `Finality` transitions.
/// The kernel validates both, but through different match arms.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CaseState {
    Processing(ProcessingState),
    Finality(FinalityStatus),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum DriftLevel {
    None,
    Low,
    Medium,
    High,
    Critical,
}

// ============================================================
// Scope state (read by TS, passed to kernel as immutable input)
// ============================================================

/// Snapshot of scope state at proposal evaluation time.
/// Built by the TS orchestration layer from Postgres + S3.
/// The kernel never reads external state — it receives this.
pub struct ScopeState {
    pub scope_id: ScopeId,
    pub epoch: u64,
    pub context_hash: String,
    pub drift_level: DriftLevel,
    pub drift_types: Vec<String>,
    pub governance_mode: GovernanceLevel,
    pub current_processing_state: ProcessingState,
    pub current_finality_status: FinalityStatus,
}

// ============================================================
// Finality
// ============================================================

/// Snapshot of convergence/evidence state for a scope.
/// Loaded from Postgres by the TS layer, passed to Rust as input.
pub struct FinalitySnapshot {
    pub claims_active_count: u32,
    pub claims_avg_confidence: f64,
    pub contradictions_total: u32,
    pub contradictions_unresolved: u32,
    pub contradiction_mass: f64,
    pub evidence_coverage: f64,
    pub risk_score: f64,
    pub goals_total: u32,
    pub goals_completed: u32,
    pub goals_completion_ratio: f64,
    pub scope_age_hours: f64,
    pub idle_rounds: u32,
}

/// Result of convergence analysis. Built by Rust from history points.
pub struct ConvergenceAnalysis {
    pub rate: f64,                          // alpha: positive = converging
    pub estimated_rounds: Option<u32>,
    pub is_monotonic: bool,                 // Gate A (per-dimension)
    pub regressed_dimensions: Vec<DimensionId>, // which dims failed monotonicity
    pub is_plateaued: bool,
    pub plateau_rounds: u32,
    pub highest_pressure_dimension: DimensionId,
    pub oscillation_detected: bool,
    pub trajectory_quality: f64,            // Q(t), 0..1
    pub autocorrelation_lag1: Option<f64>,
    pub history_len: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FinalityDecision {
    Active,
    Resolved,
    Escalated,
    Blocked,
    Expired,
    HitlReview,
}

/// Gate state: each gate is independently evaluated.
pub struct GateState {
    pub a_monotonic: bool,
    pub b_evidence: bool,
    pub c_trajectory: bool,
    pub d_quiescent: bool,
    pub e_has_content: bool,
}

impl GateState {
    pub fn all_passed(&self) -> bool {
        self.a_monotonic
            && self.b_evidence
            && self.c_trajectory
            && self.d_quiescent
            && self.e_has_content
    }
}

// ============================================================
// Configuration (parsed from YAML, passed to kernel per call)
// ============================================================

pub struct GovernanceConfig {
    pub mode: GovernanceLevel,
    pub rules: Vec<PolicyRule>,
    pub transition_rules: Vec<TransitionRule>,
    /// Per-scope mode overrides.
    pub scope_overrides: HashMap<ScopeId, GovernanceLevel>,
    /// Dimension tradeoffs permitted under Yolo mode.
    /// E.g., "ContradictionResolution may regress if ClaimConfidence improves."
    pub permitted_tradeoffs: Vec<TradeoffPolicy>,
}

pub struct PolicyRule {
    pub when_drift_levels: Vec<DriftLevel>,
    pub when_drift_type: Option<String>,
    pub action: String,
}

pub struct TransitionRule {
    pub from: CaseState,
    pub to: CaseState,
    pub block_when_drift: Vec<DriftLevel>,
    pub reason: String,
}

pub struct TradeoffPolicy {
    pub may_regress: DimensionId,
    pub if_improves: DimensionId,
    pub max_regression: f64,    // maximum allowed regression magnitude
}

pub struct FinalityConfig {
    pub convergence: ConvergenceConfig,
    pub auto_threshold: f64,
    pub near_threshold: f64,
    pub evidence_threshold: f64,     // Gate B: minimum evidence coverage
    pub trajectory_threshold: f64,   // Gate C: minimum trajectory quality
    pub quiescence: QuiescenceConfig,
    pub resolved_conditions: Vec<ConditionRule>,
    pub escalated_conditions: Vec<ConditionRule>,
    pub blocked_conditions: Vec<ConditionRule>,
    pub expired_conditions: Vec<ConditionRule>,
    pub gate_b_enforced: bool,       // gradual rollout flag (v1 compat)
}

pub struct ConvergenceConfig {
    pub beta: usize,             // monotonicity window
    pub tau: usize,              // plateau window
    pub ema_alpha: f64,
    pub plateau_threshold: f64,
    pub divergence_rate: f64,
    pub history_depth: usize,
}

pub struct QuiescenceConfig {
    pub min_idle_rounds: u32,
    pub min_age_hours: f64,
}

pub struct ConditionRule {
    pub mode: ConditionMode, // All or Any
    pub conditions: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConditionMode { All, Any }

// ============================================================
// Policy evaluation output
// ============================================================

/// Returned by `ReductionKernel::evaluate_policy`.
pub struct PolicyResult {
    pub allowed: bool,
    pub obligations: Vec<Obligation>,
}

// ============================================================
// Escalation resolution (from LLM or MITL, re-validated by kernel)
// ============================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EscalationResolution {
    Accept,
    Reject,
}
```

### 2.3 Reduction kernel

The kernel is a set of pure functions. All inputs — proposal, lattice point, snapshot, and configuration — are passed as parameters. The kernel holds no state. This guarantees replay determinism: the caller persists config snapshot hashes in the decision record.

```rust
/// The reduction kernel is a namespace of pure functions.
/// No internal state. All inputs are parameters.
pub struct ReductionKernel;

impl ReductionKernel {
    /// Evaluate a validated proposal against the governance lattice.
    ///
    /// Invariants enforced:
    /// - Inadmissible transitions are rejected (lattice descent)
    /// - Policy rules are evaluated exhaustively (no fallthrough)
    /// - Governance violations are hard rejects
    /// - Convergence violations and incomparable tradeoffs are routed
    ///   by governance level (Yolo: policy check, Mitl: escalate, Master: reject)
    /// - The decision record is deterministic and replayable
    pub fn evaluate(
        proposal: &ValidatedProposal,
        current: &LatticePoint,
        snapshot: &FinalitySnapshot,
        gov_config: &GovernanceConfig,
        fin_config: &FinalityConfig,
    ) -> Result<DecisionRecord, KernelError> {
        // 0. Resolve governance mode for this scope
        let mode = gov_config.scope_overrides
            .get(&proposal.scope_id)
            .copied()
            .unwrap_or(gov_config.mode);

        // 1. Check state machine transition legality
        let transition_ok = Self::check_transition(proposal);

        // 2. Evaluate policy rules
        let policy_result = Self::evaluate_policy(proposal, gov_config);

        // 3. Compute post-transition lattice point (dimension scores
        //    from the snapshot projected through the proposed state change)
        let after = Self::project_lattice_point(proposal, snapshot, mode);

        // 4. Check lattice admissibility with epoch awareness
        let same_epoch = current.rank.epoch == proposal.epoch;
        let admissibility = current.check_transition(&after, same_epoch);

        // 5. Determine verdict
        let verdict = match (&admissibility, transition_ok, policy_result.allowed) {
            // Governance violation: hard reject, never overridable
            (AdmissibilityResult::GovernanceViolation, _, _) |
            (AdmissibilityResult::BothViolated, _, _) =>
                ReductionVerdict::Reject,

            // Illegal state machine transition: hard reject
            (_, false, _) =>
                ReductionVerdict::Reject,

            // Happy path: lattice admits, transition legal, policy allows
            (AdmissibilityResult::Admissible, true, true) =>
                ReductionVerdict::Accept,

            // Policy denied but lattice OK
            (AdmissibilityResult::Admissible, true, false) =>
                Self::route_by_mode(mode),

            // Convergence violation (pure regression)
            (AdmissibilityResult::ConvergenceViolation { .. }, true, _) =>
                Self::route_by_mode(mode),

            // Incomparable tradeoff
            (AdmissibilityResult::Incomparable { improved, regressed },
             true, _) => {
                match mode {
                    GovernanceLevel::Yolo => {
                        if Self::policy_permits_tradeoff(
                            improved, regressed, &gov_config.permitted_tradeoffs
                        ) {
                            ReductionVerdict::Accept
                        } else {
                            ReductionVerdict::Escalate
                        }
                    }
                    GovernanceLevel::Mitl => ReductionVerdict::Escalate,
                    GovernanceLevel::Master => ReductionVerdict::Reject,
                }
            }
        };

        Ok(DecisionRecord {
            decision_id: /* UUID generated deterministically from inputs */,
            timestamp: /* ISO 8601 */,
            policy_version: gov_config.version.clone(),
            config_snapshot_hash: /* hash of gov_config + fin_config */,
            verdict,
            admissibility: admissibility.clone(),
            reason: Self::build_reason(&admissibility, transition_ok, &policy_result),
            obligations: policy_result.obligations,
            governance_path: GovernancePath::Deterministic,
            lattice_before: current.clone(),
            lattice_after: if verdict == ReductionVerdict::Accept {
                Some(after)
            } else {
                None
            },
            epoch: proposal.epoch,
            scope_id: proposal.scope_id.clone(),
        })
    }

    /// Re-validate an escalation resolution (from LLM or MITL).
    /// The resolution is a recommendation — the kernel re-checks
    /// lattice descent before committing.
    pub fn validate_escalation_resolution(
        proposal: &ValidatedProposal,
        current: &LatticePoint,
        snapshot: &FinalitySnapshot,
        gov_config: &GovernanceConfig,
        fin_config: &FinalityConfig,
        resolution: EscalationResolution,
        human_reason: &str,
    ) -> Result<DecisionRecord, KernelError> {
        match resolution {
            EscalationResolution::Reject => {
                // Human/LLM rejected — build record, no re-check needed
                Ok(Self::build_rejection(proposal, current, "escalation_rejected"))
            }
            EscalationResolution::Accept => {
                // Re-check lattice descent — LLM/human cannot override
                // structural invariants
                let mode = gov_config.scope_overrides
                    .get(&proposal.scope_id)
                    .copied()
                    .unwrap_or(gov_config.mode);
                let after = Self::project_lattice_point(proposal, snapshot, mode);
                let same_epoch = current.rank.epoch == proposal.epoch;
                let admissibility = current.check_transition(&after, same_epoch);

                match admissibility {
                    AdmissibilityResult::Admissible |
                    AdmissibilityResult::Incomparable { .. } => {
                        // Escalation approved and lattice permits
                        Ok(Self::build_acceptance(
                            proposal, current, after,
                            GovernancePath::MitlResolved,
                            &format!("escalation_approved: {}", human_reason),
                        ))
                    }
                    _ => {
                        // LLM/human said accept but lattice says no — kernel wins
                        Ok(Self::build_rejection(
                            proposal, current,
                            "escalation_overridden_by_lattice_descent",
                        ))
                    }
                }
            }
        }
    }

    fn route_by_mode(mode: GovernanceLevel) -> ReductionVerdict {
        match mode {
            GovernanceLevel::Yolo => ReductionVerdict::Reject,
            GovernanceLevel::Mitl => ReductionVerdict::Escalate,
            GovernanceLevel::Master => ReductionVerdict::Reject,
        }
    }

    fn policy_permits_tradeoff(
        improved: &[DimensionId],
        regressed: &[DimensionId],
        policies: &[TradeoffPolicy],
    ) -> bool {
        regressed.iter().all(|r| {
            policies.iter().any(|p| {
                p.may_regress == *r && improved.contains(&p.if_improves)
            })
        })
    }

    /// Validate state transitions. See full table below.
    fn check_transition(proposal: &ValidatedProposal) -> bool {
        use ProcessingState::*;
        match (&proposal.from_state, &proposal.to_state) {
            // --- Processing cycle ---
            (CaseState::Processing(ContextIngested),
             CaseState::Processing(FactsExtracted)) => true,
            (CaseState::Processing(FactsExtracted),
             CaseState::Processing(DriftChecked)) => true,
            (CaseState::Processing(DriftChecked),
             CaseState::Processing(ContextIngested)) => true, // re-cycle

            // --- Finality transitions (from any processing state) ---
            (CaseState::Processing(_),
             CaseState::Finality(FinalityStatus::Resolved)) => true,
            (CaseState::Processing(_),
             CaseState::Finality(FinalityStatus::Escalated)) => true,
            (CaseState::Processing(_),
             CaseState::Finality(FinalityStatus::Blocked)) => true,
            (CaseState::Processing(_),
             CaseState::Finality(FinalityStatus::Expired)) => true,

            // --- Finality-to-finality transitions ---
            (CaseState::Finality(FinalityStatus::Active),
             CaseState::Finality(FinalityStatus::Resolved)) => true,
            (CaseState::Finality(FinalityStatus::Active),
             CaseState::Finality(FinalityStatus::Escalated)) => true,
            (CaseState::Finality(FinalityStatus::Active),
             CaseState::Finality(FinalityStatus::Blocked)) => true,
            (CaseState::Finality(FinalityStatus::Active),
             CaseState::Finality(FinalityStatus::Expired)) => true,
            (CaseState::Finality(FinalityStatus::Blocked),
             CaseState::Finality(FinalityStatus::Active)) => true, // unblock
            (CaseState::Finality(FinalityStatus::Escalated),
             CaseState::Finality(FinalityStatus::Active)) => true, // de-escalate

            // --- Suspension (from any non-terminal state) ---
            (CaseState::Processing(_),
             CaseState::Finality(FinalityStatus::Suspended)) => true,
            (CaseState::Finality(FinalityStatus::Active),
             CaseState::Finality(FinalityStatus::Suspended)) => true,
            (CaseState::Finality(FinalityStatus::Suspended),
             CaseState::Finality(FinalityStatus::Active)) => true, // resume

            // Everything else is rejected.
            _ => false,
        }
    }
}
```

### 2.4 Convergence analysis (pure)

All convergence functions are pure: no I/O, no allocation beyond the return value. They operate on the vector convergence rank (section 2.2).

```rust
/// Compute dimension scores from a FinalitySnapshot.
/// Returns the [f64; 4] used in ConvergenceRank.dimensions.
pub fn compute_dimension_scores(snapshot: &FinalitySnapshot) -> [f64; 4] {
    [
        // ClaimConfidence
        (snapshot.claims_avg_confidence / 0.85).min(1.0),
        // ContradictionResolution
        if snapshot.contradictions_total == 0 { 1.0 }
        else { 1.0 - (snapshot.contradictions_unresolved as f64
                       / snapshot.contradictions_total as f64) },
        // GoalCompletion
        snapshot.goals_completion_ratio,
        // RiskInverse
        1.0 - snapshot.risk_score.min(1.0),
    ]
}

/// Per-dimension pressure for stigmergic routing.
/// pressure_d = weight_d * max(0, 1 - score_d)
pub fn compute_pressure(scores: &[f64; 4], weights: &[f64; 4]) -> [f64; 4] {
    let mut p = [0.0; 4];
    for i in 0..4 {
        p[i] = weights[i] * (1.0 - scores[i]).max(0.0);
    }
    p
}

/// Scalar V(t) — derived diagnostic.
/// V = sum(w_d * (target_d - actual_d)^2)
pub fn scalar_lyapunov_v(scores: &[f64; 4], targets: &[f64; 4],
                         weights: &[f64; 4]) -> f64 {
    scores.iter().zip(targets).zip(weights)
        .map(|((s, t), w)| w * (t - s).powi(2))
        .sum::<f64>()
        .max(0.0)
}

/// Convergence rate: alpha = -ln(V(t)/V(t-1)), averaged over recent pairs.
/// Uses scalar V for the rate since it provides a single trend signal.
pub fn convergence_rate(v_history: &[f64], window: usize) -> f64 { /* ... */ }

/// Trajectory quality Q(t): direction changes + autocorrelation penalty.
/// Computed per-dimension, then aggregated (min across dimensions).
pub fn trajectory_quality(
    dimension_histories: &[[f64; 4]],
) -> f64 { /* ... */ }

/// Per-dimension monotonicity check: non-decreasing for beta consecutive rounds.
/// Returns which dimensions (if any) regressed.
pub fn check_monotonicity(
    dimension_histories: &[[f64; 4]], beta: usize, epsilon: f64,
) -> (bool, Vec<DimensionId>) {
    if dimension_histories.len() < beta {
        return (true, vec![]); // insufficient history → assume monotonic
    }
    let window = &dimension_histories[dimension_histories.len() - beta..];
    let dims = [
        DimensionId::ClaimConfidence,
        DimensionId::ContradictionResolution,
        DimensionId::GoalCompletion,
        DimensionId::RiskInverse,
    ];
    let mut regressed = vec![];
    for d in 0..4 {
        for i in 1..window.len() {
            if window[i][d] < window[i - 1][d] - epsilon {
                regressed.push(dims[d]);
                break; // one regression in this dimension is enough
            }
        }
    }
    (regressed.is_empty(), regressed)
}

/// Plateau detection: EMA of progress ratio below threshold for tau rounds.
pub fn plateau_rounds(score_history: &[f64], auto_threshold: f64,
                      ema_alpha: f64, plateau_threshold: f64) -> usize { /* ... */ }

/// Build a full ConvergenceAnalysis from a history of convergence points.
/// This is the main entry point called by the bridge.
pub fn analyze_convergence(
    history: &[ConvergencePoint],
    config: &ConvergenceConfig,
    auto_threshold: f64,
) -> ConvergenceAnalysis { /* ... */ }
```

### 2.5 Five-gate finality predicate

> **Behavioral change from v1:** In v1, Gate B (evidence coverage and
> contradiction mass) was recorded for experiment telemetry but was
> **never checked** in the Path A RESOLVED condition. V2 includes Gate B
> in the `all_passed()` conjunction, meaning scopes with non-zero
> contradiction mass or < 99% evidence coverage will no longer reach
> RESOLVED automatically. This is the correct behavior per the theory,
> but will tighten finality compared to v1. Migration should verify
> that existing YAML conditions and evidence thresholds are compatible
> with this stricter gate.

```rust
pub fn evaluate_gates(
    snapshot: &FinalitySnapshot,
    convergence: &ConvergenceAnalysis,
    config: &FinalityConfig,
) -> GateState {
    GateState {
        a_monotonic: convergence.is_monotonic,
        // Gate B: now enforced (was telemetry-only in v1).
        // Gated by config.gate_b_enforced for gradual v1 → v2 rollout.
        b_evidence: !config.gate_b_enforced || (
            snapshot.contradiction_mass == 0.0
            && snapshot.evidence_coverage >= config.evidence_threshold
        ),
        c_trajectory: convergence.trajectory_quality >= config.trajectory_threshold,
        d_quiescent: is_quiescent(snapshot, &config.quiescence),
        e_has_content: snapshot.claims_active_count > 0
            || snapshot.goals_completion_ratio < 1.0,
    }
}

pub fn evaluate_finality(
    snapshot: &FinalitySnapshot,
    convergence: &ConvergenceAnalysis,
    config: &FinalityConfig,
    goal_score: f64,
    gates_disabled: bool,
) -> FinalityDecision {
    let gates = evaluate_gates(snapshot, convergence, config);

    // Gate E: no content -> stay ACTIVE
    if !gates.e_has_content {
        return FinalityDecision::Active;
    }

    // Divergence detection
    if convergence.rate < config.convergence.divergence_rate
        && convergence.history_len >= 3 {
        return FinalityDecision::Escalated;
    }

    // Path A: RESOLVED
    let conditions_met = evaluate_conditions(
        &config.resolved_conditions, snapshot
    );
    let gates_ok = gates_disabled || gates.all_passed();
    if conditions_met && goal_score >= config.auto_threshold && gates_ok {
        return FinalityDecision::Resolved;
    }

    // Path B: HITL review
    if goal_score >= config.near_threshold && goal_score < config.auto_threshold {
        return FinalityDecision::HitlReview;
    }

    // Check ESCALATED, BLOCKED, EXPIRED conditions
    // ...

    FinalityDecision::Active
}
```

---

## 3. The FFI Boundary: napi-rs Bridge

### 3.1 Design principle

The bridge is thin. It converts TypeScript objects to Rust structs, calls the engine, and returns results. No business logic in the bridge.

```
TypeScript (I/O, LLM, messaging)
    |
    | napi-rs FFI (JSON serialization at boundary)
    |
Rust engine (deterministic, replayable)
```

### 3.2 Bridge API

The bridge API covers the full decision surface across two layers: the admission gate (CandidateProposal → ValidatedProposal) and the reduction kernel (ValidatedProposal → DecisionRecord). The TS layer calls the admission gate first, then the kernel. Each function takes all configuration as parameters (stateless).

```typescript
// sgrs-bridge/index.d.ts -- generated by napi-rs

// --- Shared types ---

export type GovernanceMode = "Yolo" | "Mitl" | "Master";
export type DimensionId = "ClaimConfidence" | "ContradictionResolution"
  | "GoalCompletion" | "RiskInverse";

export interface LatticePointDto {
  governance: GovernanceMode;
  dimensions: Record<DimensionId, number>; // the 4 dimension scores
  epoch: number;
}

export type AdmissibilityResult =
  | { kind: "Admissible" }
  | { kind: "GovernanceViolation" }
  | { kind: "ConvergenceViolation"; regressed: DimensionId[] }
  | { kind: "Incomparable"; improved: DimensionId[]; regressed: DimensionId[] }
  | { kind: "BothViolated" };

export type GovernancePath = "Deterministic" | "OversightAccepted"
  | "OversightEscalatedLlm" | "OversightEscalatedHuman" | "MitlResolved";

// --- Admission gate ---
// Validates structural well-formedness. No policy, no lattice.
// Injects scope state (epoch, drift) into the proposal.

export interface AdmitProposalInput {
  candidate: {
    id: string;
    proposer: string;
    scope_id: string;
    from_state: string;    // raw string, validated by Rust
    to_state: string;      // raw string, validated by Rust
    payload: object;
    timestamp: string;
  };
  scope_state: {
    epoch: number;
    drift_level: string;
    drift_types: string[];
    governance_mode: GovernanceMode;
  };
}

export interface AdmitProposalOutput {
  validated: {
    id: string;
    proposer: string;
    scope_id: string;
    from_state: string;    // "Processing:ContextIngested" | "Finality:Active" | ...
    to_state: string;
    drift_level: string;
    drift_types: string[];
    epoch: number;
  };
}

/** Returns AdmitProposalOutput or throws KernelError. */
export function admitProposal(input: AdmitProposalInput): AdmitProposalOutput;

// --- Proposal evaluation (kernel) ---

export interface EvaluateProposalInput {
  /** Output from admitProposal — structurally validated. */
  proposal: AdmitProposalOutput["validated"];
  current_lattice: LatticePointDto;
  snapshot: FinalitySnapshotDto;
  governance_yaml: string;  // raw YAML, parsed in Rust
  finality_yaml: string;    // raw YAML, parsed in Rust
}

export interface DecisionRecordDto {
  decision_id: string;
  timestamp: string;
  policy_version: string;
  config_snapshot_hash: string;
  verdict: "Accept" | "Reject" | "Escalate";
  admissibility: AdmissibilityResult;
  reason: string;
  obligations: Array<{ kind: string; params: object }>;
  governance_path: GovernancePath;
  lattice_before: LatticePointDto;
  lattice_after: LatticePointDto | null;
  epoch: number;
  scope_id: string;
}

export interface EvaluateProposalOutput {
  verdict: "Accept" | "Reject" | "Escalate";
  reason: string;
  admissibility: AdmissibilityResult;
  decision_record: DecisionRecordDto;
  lattice_before: LatticePointDto;
  lattice_after: LatticePointDto | null;
}

/** Returns EvaluateProposalOutput or throws KernelError. */
export function evaluateProposal(input: EvaluateProposalInput): EvaluateProposalOutput;

// --- Escalation re-validation ---
// After LLM or MITL resolves an escalated proposal, the kernel
// re-checks lattice descent before committing.

export interface RevalidateEscalationInput {
  original_input: EvaluateProposalInput;
  resolution: "approve" | "reject";
  resolution_reason: string;
}

export interface RevalidateEscalationOutput {
  verdict: "Accept" | "Reject";  // no Escalate — already resolved
  decision_record: DecisionRecordDto;
  lattice_before: LatticePointDto;
  lattice_after: LatticePointDto | null;
}

export function revalidateEscalation(
  input: RevalidateEscalationInput
): RevalidateEscalationOutput;

// --- Oversight triage classification ---
// Pure classification: which escalation path to take.

export interface TriageInput {
  deterministic_verdict: "Accept" | "Reject" | "Escalate";
  admissibility: AdmissibilityResult;
  drift_level: string;
  governance_mode: GovernanceMode;
  convergence_rate: number;
  trajectory_quality: number;
}

export type TriageRoute =
  | "commit_deterministic"
  | "escalate_to_llm"
  | "escalate_to_human";

export function classifyForOversight(input: TriageInput): TriageRoute;

// --- Convergence analysis ---

export interface ConvergenceInput {
  /** Oldest-first history of convergence points. */
  history: Array<{
    epoch: number;
    dimension_scores: Record<DimensionId, number>;
    pressure: Record<DimensionId, number>;
    scalar_v: number;       // derived diagnostic
    scalar_goal_score: number; // derived diagnostic
  }>;
  config: {
    beta: number; tau: number; ema_alpha: number;
    plateau_threshold: number; divergence_rate: number;
  };
  auto_threshold: number;
}

export interface ConvergenceOutput {
  convergence_rate: number;
  estimated_rounds: number | null;
  is_monotonic: boolean;
  regressed_dimensions: DimensionId[];  // which dims failed monotonicity
  is_plateaued: boolean;
  plateau_rounds: number;
  highest_pressure_dimension: DimensionId;
  oscillation_detected: boolean;
  trajectory_quality: number;
  autocorrelation_lag1: number | null;
}

export function analyzeConvergence(input: ConvergenceInput): ConvergenceOutput;

// --- Finality evaluation ---

export interface FinalitySnapshotDto {
  claims_active_count: number;
  claims_avg_confidence: number;
  contradictions_total: number;
  contradictions_unresolved: number;
  contradiction_mass: number;
  evidence_coverage: number;
  risk_score: number;
  goals_total: number;
  goals_completed: number;
  goals_completion_ratio: number;
  scope_age_hours: number;
  idle_rounds: number;
}

export interface FinalityInput {
  snapshot: FinalitySnapshotDto;
  convergence: ConvergenceOutput;
  finality_yaml: string;
  goal_score: number;
  gates_disabled: boolean;
}

export interface FinalityOutput {
  decision: "Active" | "Resolved" | "Escalated" | "Blocked" | "Expired" | "HitlReview";
  gates: { a: boolean; b: boolean; c: boolean; d: boolean; e: boolean };
}

export function evaluateFinality(input: FinalityInput): FinalityOutput;

// --- Pure math (hot path — napi struct bindings, no serialization) ---

export function computeDimensionScores(
  snapshot: FinalitySnapshotDto): Record<DimensionId, number>;

/** Scalar V(t) — derived diagnostic, not used for admissibility. */
export function computeScalarV(
  snapshot: FinalitySnapshotDto,
  weights?: Record<DimensionId, number>): number;

export function computePressure(
  snapshot: FinalitySnapshotDto,
  weights?: Record<DimensionId, number>): Record<DimensionId, number>;

// --- Lattice point computation ---

export function computeLatticePoint(
  governance_mode: GovernanceMode,
  snapshot: FinalitySnapshotDto,
  epoch: number,
): LatticePointDto;

// --- Admissibility check (standalone, for pre-flight) ---

export function checkAdmissibility(
  before: LatticePointDto,
  after: LatticePointDto,
  same_epoch: boolean,
): AdmissibilityResult;
```

### 3.3 Serialization strategy

At the FFI boundary, TypeScript passes JSON strings (or napi-rs `Object` bindings). The Rust side deserializes with serde. This is acceptable because:

- The boundary is crossed once per governance cycle (every 2-30s, not per-message).
- Serialization cost is negligible vs. the 30s+ LLM calls that dominate wall time.
- JSON gives full debuggability: every input/output can be logged.

For the hot path (convergence math called in tight loops during batch analysis), napi-rs `#[napi]` struct bindings avoid serialization entirely.

---

## 4. Migration Path

> **Timeline note:** The original estimate was 9 weeks. The design
> iteration needed for governance ordering semantics, epoch protocol,
> state machine completeness, and Gate B behavioral validation adds
> ~2 weeks of design work (mostly in Phase 1-2). Revised total: 11-12 weeks.

### Phase 0: Rust crate scaffold, pure convergence (week 1-3)

1. Create `sgrs-core/` with Cargo.toml, basic types, `KernelError`.
2. Port pure convergence functions: `scalar_lyapunov_v`, `compute_pressure`, `compute_dimension_scores`, `trajectory_quality`, `check_monotonicity`, `plateau_rounds`, `convergence_rate`.
3. Port the entire v1 test suite for these functions (test/unit/convergenceTracker.test.ts -> Rust unit tests).
4. Create napi-rs bridge with `computeScalarV`, `computePressure`, `computeDimensionScores`, `analyzeConvergence`, `computeLatticePoint`, `checkAdmissibility`.
5. Replace imports in `convergenceTracker.ts`: pure functions call Rust, DB functions remain TS.
6. Verify: `pnpm test` passes with Rust engine under the hood.
7. **New:** Validate governance level ordering (Yolo > Mitl > Master permissiveness) with property tests.

### Phase 1: Finality gates (week 4-5)

1. Port `FinalitySnapshot`, gate evaluation, condition parser to Rust.
2. Port `evaluateFinality` logic (Path A, Path B, divergence detection).
3. **New:** Gate B enforcement validation: run v1 experiment data through v2 gate conjunction, identify scopes that would no longer reach RESOLVED, and adjust `evidence_threshold` config if needed. Add `gate_b_enforced` config flag for gradual rollout.
4. Bridge: `evaluateFinality` callable from TS.
5. Replace the evaluateFinality body in `finalityEvaluator.ts` with a bridge call.
6. TS retains: `loadFinalitySnapshot` (Postgres), `emitSessionFinalized`, `emitFinalityCertificate`, `recordGateStateIfAvailable`, HITL request building.

### Phase 2: Governance lattice and reduction kernel (week 6-8)

1. Implement `GovernanceLevel` (with manual `PartialOrd`/`Ord`), `ConvergenceRank`, `LatticePoint`, `AdmissibilityResult`.
2. Implement `ProcessingState`, `FinalityStatus`, `CaseState` with the full transition table.
3. Port policy rule evaluation, transition checking.
4. Implement the reduction kernel: `ReductionKernel::evaluate` (stateless — config as parameter).
5. **New:** Implement `classifyForOversight` (triage classification) and `reenterAfterMitl` (MITL re-entry).
6. Bridge: `evaluateProposal`, `classifyForOversight`, `reenterAfterMitl`.
7. Replace `evaluateProposalDeterministic` in `governanceAgent.ts` with bridge call.
8. TS retains: LLM oversight paths, MITL HTTP, NATS publishing.
9. **New:** Implement epoch identity protocol in TS layer (contextIngestor creates epochs, epoch ID in convergence history).

### Phase 3: Replay and verification (week 9-10)

1. Implement deterministic replay in Rust: feed decision log + config snapshots, verify same verdicts.
2. Build a replay CLI: `sgrs-replay --decisions decisions.jsonl --verify`.
3. **New:** Replay must load config snapshots (governance YAML + finality YAML) from the decision log, since the kernel is stateless and config may change between decisions.
4. This is the structural invariant from the theory: "replay remains deterministic."

### Phase 4: Remove v1 pure functions, error hardening (week 11-12)

1. Delete pure TS functions that are now in Rust (convergence math, condition evaluation, gate logic).
2. `convergenceTracker.ts` becomes a thin wrapper: load from DB -> call Rust -> write to DB.
3. `finalityEvaluator.ts` becomes a thin wrapper: load snapshot -> call Rust -> emit events.
4. `governanceAgent.ts` retains LLM/MITL paths; deterministic path delegates to Rust.
5. **New:** Replace v1 silent try/catch degradation with structured `KernelError` handling on the governance path. Non-governance paths (WAL, certificates, telemetry) retain graceful degradation.
6. **New:** Remove the v1 MASTER auto-approve path. Verify `--unsafe-approve-all` CLI flag works for development.

---

## 5. Architectural Invariants (enforced by Rust type system)

### 5.1 Lattice descent

Every accepted transition must satisfy `M_before >= M_after` in the product ordering. This is checked in `ReductionKernel::evaluate` via `LatticePoint::check_transition` (section 2.2) and cannot be bypassed. The check returns a typed `AdmissibilityResult` that distinguishes governance violations (hard reject) from convergence violations (escalatable to MITL). Epoch boundaries relax the convergence constraint while preserving the governance constraint (section 8).

### 5.2 Exhaustive state matching

The state machine has two orthogonal dimensions (section 2.2): processing states (`ProcessingState`) and finality states (`FinalityStatus`). The kernel's `check_transition` method (section 2.3) handles both with explicit match arms for every legal transition. The wildcard `_ => false` catch-all ensures that adding a new variant to either enum produces a compiler warning (non-exhaustive match with `#[warn(non_exhaustive_omitted_patterns)]`), forcing the developer to decide whether the new state has legal transitions.

See section 2.3 for the full transition table.

### 5.3 Gate conjunction

`GateState::all_passed()` is the finality predicate F(t) = G_A AND G_B AND G_C AND G_D AND G_E. Each gate is independently computed and independently testable.

### 5.4 Replay determinism

The reduction kernel has no internal state, no randomness, no I/O. Configuration is passed as parameters on every call (section 2.3), not stored in the struct. Given the same `(proposal, lattice_point, snapshot, governance_config, finality_config)` tuple, it always returns the same `DecisionRecord`. This is enforced by Rust's ownership model: the kernel takes immutable references only.

For replay, the caller must persist the exact config that was active at decision time. The `DecisionRecord` includes `policy_version` and `config_snapshot_hash` (a hash of the governance + finality YAML active at decision time). The replay CLI (Phase 3) loads config snapshots from the decision log alongside proposals.

### 5.5 Separation of exploration and reduction

Agents (TypeScript) propose transitions -- this is exploration. The Rust kernel accepts or rejects -- this is reduction. Exploration cannot mutate authoritative state because only the kernel can produce an `Accept` verdict, and the bridge returns the verdict to the TS orchestration layer which then applies it.

---

## 6. MASTER Mode Resolution

V1 has a contradiction: the paper says MASTER is the most restrictive mode; the implementation auto-approves everything.

V2 resolves this by aligning with the theory. The governance ordering (section 2.2) encodes *permissiveness*: `Yolo > Mitl > Master`. Descent in the lattice moves toward more restriction (escalation). Ascent moves toward more permissiveness (de-escalation) and is rejected.

- **Yolo** (most permissive, lattice top): Rules-based with optional LLM escalation. Current default. Highest permissiveness value.
- **Mitl** (middle): Mandatory human-in-the-loop. Every proposal requires human review.
- **Master** (most restrictive, lattice bottom): Rules-based, strictest interpretation, no escalation to LLM, no override. This is the "master key locks everything" interpretation, not "master key opens everything."

Escalation (Yolo → Mitl → Master) is descent and always admissible. De-escalation (Master → Yolo) is ascent and always rejected by the kernel.

The old auto-approve behavior is removed. If an escape hatch is needed for development, it is a separate `--unsafe-approve-all` CLI flag that is never represented in the lattice.

---

## 7. What Changes for the Theory

The Rust core makes the theory executable:

| Theory concept | V1 status | V2 enforcement |
|---------------|-----------|----------------|
| M = L x A product lattice | Implicit | `LatticePoint` struct with `check_transition` returning typed `AdmissibilityResult` |
| Governance ordering | MASTER auto-approves (inverted) | Permissiveness ordering: Yolo > Mitl > Master; escalation = descent |
| Well-founded descent | V(t) computed but not checked at governance boundary | Kernel checks `M_before >= M_after` with separate governance/convergence failure modes |
| Deterministic kernel | Spread across multiple async TS functions | Single `ReductionKernel::evaluate`, pure, stateless (config as parameter), no I/O |
| Exploration / reduction separation | Architectural convention | Type-system enforced: agents return proposals, kernel returns verdicts |
| Replay determinism | Not implemented | `sgrs-replay` CLI; kernel is pure by construction; config snapshots in decision log |
| Structural anti-gaming | Policy rules check drift | Lattice descent check: spam cannot cause ascent in M |
| Partial confluence | Not addressed | Compatible transitions commute because kernel is deterministic and stateless |
| Finality = gate conjunction | Gate B not enforced; interleaved with I/O | All five gates enforced in `evaluate_gates` (Gate B now checked); I/O is outside |
| Epoch-conditioned monotonicity | Not addressed | `check_transition(same_epoch)`: V(t) monotonic intra-epoch, may spike cross-epoch |
| State machine completeness | 3 processing states only | `ProcessingState` + `FinalityStatus` with exhaustive transition table |

---

## 8. Intra-Epoch vs Cross-Epoch Dynamics

The theory-work-2 review identified the most important gap: V(t) can increase when new context is injected (new documents, new risk assessments). V2 formalizes the two-regime model.

The epoch-aware admissibility check is already integrated into `LatticePoint::check_transition` (section 2.2) and `ReductionKernel::evaluate` (section 2.3). This section defines the epoch identity protocol.

### 8.1 Epoch Identity

```rust
pub struct Epoch {
    pub id: u64,
    /// Hash of the context corpus at epoch creation.
    /// Changed context = new epoch.
    pub context_hash: String,
    /// Timestamp of epoch creation.
    pub created_at: String,
    /// The V(t) at epoch start (may be higher than the previous
    /// epoch's final V if new context was injected).
    pub initial_v: f64,
}
```

### 8.2 Epoch Lifecycle Protocol

Epochs are created and managed by the **TypeScript orchestration layer**, not the Rust kernel. The kernel only receives a `same_epoch: bool` flag computed by the caller.

**Who creates epochs:**
- The TS `contextIngestor` creates a new epoch when new documents are ingested, new risk assessments arrive, or the scope's context corpus changes materially.
- Epoch creation is recorded in the convergence history table with a new epoch ID and the context hash.

**How the TS layer determines `same_epoch`:**
- Before calling `evaluateProposal`, the TS layer compares `proposal.epoch` with `current_lattice.epoch`.
- If they differ, the proposal is from a new epoch. The kernel receives `same_epoch = false` and allows V(t) to increase.
- The TS layer is responsible for incrementing epoch IDs and computing context hashes.

**What constitutes a new epoch:**
- A single new document: yes, new epoch (context hash changes).
- A re-evaluation of existing evidence without new data: no, same epoch.
- A batch of documents ingested together: one epoch for the batch, not one per document.
- A human override via MITL: same epoch (human input is not new context).

This gives Proposition 1 the conditioning it needs: monotonicity of V(t) is guaranteed within an epoch; context injection starts a new epoch where V(t) may increase. The perpetual finality lifecycle is a sequence of convergent epochs.

### 8.3 Epoch Boundary Invariants

- Epoch IDs are monotonically increasing (u64).
- A proposal must declare its epoch. Stale proposals (epoch < current) are rejected by the kernel (optimistic concurrency).
- Cross-epoch transitions preserve governance level constraints: escalation is still admissible, de-escalation is still rejected.
- The decision record includes both the epoch ID and context hash for replay.

---

## 9. Build and Integration

### Cargo.toml (sgrs-core)

```toml
[package]
name = "sgrs-core"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { version = "3", features = ["napi9"] }
napi-derive = "3"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
# NOTE: serde_yaml is deprecated. Use serde_yml (the maintained fork).
serde_yml = "0.0.12"
thiserror = "2"

[build-dependencies]
napi-build = "2"
```

### package.json integration

```json
{
  "dependencies": {
    "sgrs-core": "file:sgrs-core"
  },
  "scripts": {
    "build:rust": "cd sgrs-core && napi build --release",
    "prebuild": "npm run build:rust"
  }
}
```

### CI

- Rust toolchain added to CI (rustup, cargo).
- `cargo test` runs Rust unit tests.
- `cargo clippy` enforces lint.
- `pnpm test` runs TS integration tests that call the bridge.
- Both must pass.

---

## 10. Design Rationale: Why Vector Convergence, Not Scalar

This section explains the motivation for the vector convergence rank defined in section 2.2. The authoritative type definitions are in section 2.2; this section provides rationale only.

### 10.1 The v1 problem

V1 computes convergence as a single scalar:

```
V(t) = sum(w_d * (target_d - actual_d)^2)    ->  one float
S(t) = sum(w_d * score_d)                     ->  one float
```

This is a total order. The theory calls for a **partial order** on the convergence rank A. The scalar projection collapses the 4-dimensional convergence space into a line, hiding dimension regressions inside weighted sums.

### 10.2 What the scalar loses

Consider a transition where `claim_confidence` improves from 0.7 to 0.9 while `contradiction_resolution` regresses from 0.8 to 0.6. With typical weights, the scalar V may decrease — the scalar says "progress." But a contradiction that was resolved has been re-opened.

### 10.3 V2 solution

The convergence rank is a 4-dimensional vector with componentwise partial order (section 2.2, `ConvergenceRank`). The scalar V(t) is retained as a derived diagnostic (`ConvergenceRank::scalar_v`) for ETA estimation and dashboard display, but is NOT used for lattice admissibility.

| Concept | V1 role | V2 role |
|---------|---------|---------|
| Scalar V(t) | Governance input, finality gate | **Diagnostic only**: ETA estimation, dashboard display |
| Vector rank | Not represented | **Governance input**: lattice descent check (section 2.2) |
| Scalar S(t) | Finality threshold | **Derived**: weighted sum, used for HITL threshold only |
| Per-dimension scores | Computed but not used for admissibility | **Primary**: each dimension checked independently |
| Pressure | Routing heuristic | **Unchanged**: per-dimension gap for stigmergic activation |

### 10.4 The incomparability problem

With a partial order, two ranks can be **incomparable**: one dimension improved, another regressed. The kernel handles this via `AdmissibilityResult::Incomparable` (section 2.2), routing by governance level (section 2.3):

- **Yolo**: check `TradeoffPolicy` rules in config; accept if permitted, else escalate.
- **Mitl**: escalate to human.
- **Master**: reject.

### 10.5 Monotonicity gate under vector convergence

Gate A (monotonicity) checks per-dimension non-regression over the last `beta` rounds. The `ConvergenceAnalysis` struct (section 2.2) reports both `is_monotonic: bool` and `regressed_dimensions: Vec<DimensionId>` so the finality evaluator and HITL request can identify exactly which dimensions are preventing finality.

---

## 11. Design Rationale: Why Strict Exploration/Reduction Decoupling

This section explains the motivation for the admission gate (section 2.2, `CandidateProposal` → `ValidatedProposal`) and the escalation re-validation (section 2.3, `validate_escalation_resolution`). The authoritative type definitions and kernel signatures are in sections 2.2-2.3; this section provides rationale only.

### 11.1 V1 violations of exploration/reduction separation

The theory requires that exploration (agents proposing) does not alter the Kripke structure — only reductions (kernel verdicts) define accessibility relations. V1 violates this in five ways:

1. **Proposals carry a `mode` field** that dictates kernel behavior. The stochastic plane tells the deterministic plane how to behave. V2 fix: governance mode is resolved from scope config by the kernel (section 2.3, step 0), not carried on the proposal.

2. **MASTER mode bypasses the kernel entirely** — auto-approve with no policy, lattice, or transition check. V2 fix: MASTER is the most restrictive level; no bypass exists (section 6).

3. **LLM oversight can override the deterministic verdict** — a second LLM can call `publishApproval` with its own judgment, overwriting the kernel's decision. V2 fix: LLM/human resolutions must be re-validated by the kernel (`validate_escalation_resolution`, section 2.3). The kernel always has final say on structural invariants.

4. **The "deterministic" path does I/O** — reads from Postgres, S3, OpenFGA. V2 fix: scope state is loaded by the TS layer and passed as immutable input (section 2.2, `ScopeState`).

5. **No admission gate** — agents publish directly to NATS with no structural validation. V2 fix: `admitProposal` (section 3.2) validates well-formedness, checks epoch, deduplicates, and injects scope state before the proposal reaches the kernel.

### 11.2 V2 processing pipeline

```
+------------------------------------------------------------------+
|  EXPLORATION PLANE (TypeScript)                                   |
|  Agents, LLMs, I/O, activation filters                           |
|  Output: CandidateProposal (unvalidated)                         |
+------------------------------------------------------------------+
         |
         |  FFI: admitProposal (section 3.2)
         v
+------------------------------------------------------------------+
|  ADMISSION GATE (Rust)                                            |
|  Validates well-formedness, epoch, dedup.                         |
|  Injects scope state (drift, epoch). No policy, no lattice.      |
|  Output: ValidatedProposal                                       |
+------------------------------------------------------------------+
         |
         |  FFI: evaluateProposal (section 3.2)
         v
+------------------------------------------------------------------+
|  REDUCTION KERNEL (Rust, pure)                                    |
|  Takes: ValidatedProposal + LatticePoint + FinalitySnapshot      |
|         + GovernanceConfig + FinalityConfig                       |
|  Returns: DecisionRecord (verdict + admissibility + lattice)      |
|  No I/O. No stochastic input. Deterministic.                     |
+------------------------------------------------------------------+
         |
         |  If Escalate:
         |  FFI: revalidateEscalation (section 3.2)
         v
+------------------------------------------------------------------+
|  COMMIT LAYER (TypeScript)                                        |
|  Applies the verdict: publish to NATS, persist record,            |
|  emit events, update state.                                       |
|  Cannot alter the verdict.                                        |
+------------------------------------------------------------------+
```

The critical invariant: **the LLM can recommend, but only the kernel can commit**. If an LLM or human says "accept" but lattice descent is violated, the kernel blocks the commit via `validate_escalation_resolution` (section 2.3).

---

## 12. Summary of Structural Corrections

| Issue | V1 | V2 |
|-------|-----|-----|
| Convergence ordering | Scalar V(t), total order | Vector rank, componentwise partial order |
| Dimension regression | Hidden by weighted sum | Detected per-dimension; blocks or escalates |
| Monotonicity gate | On scalar S(t) | Per-dimension, identifies regressed dimensions |
| Proposal carries governance mode | Yes (`mode: "YOLO"`) | No. Mode resolved from scope config by kernel |
| MASTER bypasses kernel | Yes (auto-approve) | No. MASTER = strictest kernel, no bypass |
| LLM can override kernel verdict | Yes (oversight -> full LLM -> publish) | No. LLM recommends; kernel re-validates |
| Deterministic path does I/O | Yes (Postgres, S3, OpenFGA) | No. Scope state passed as immutable input |
| Proposal spam resistance | Evaluate each, no structural block | Admission gate with dedup and epoch check |
| Incomparable transitions | Impossible (scalar is total order) | Escalated to governance or rejected |

---

## 13. DriftLevel and Lattice Interaction

`DriftLevel` (section 2.2) is an input to the policy rule evaluator, not a component of the lattice point. It affects the reduction kernel's *policy verdict* (step 2 in `evaluate`), not the *lattice admissibility check* (step 4).

The ordering (`None < Low < ... < Critical`) is used inside `evaluate_policy` to match against YAML rules like `drift_level: [high, critical] → action: block`. Higher drift makes policy rules more likely to deny, which causes the kernel to reject or escalate. But drift does not directly affect the lattice point or the convergence rank vector.

Drift *indirectly* affects convergence: if a proposal is rejected due to high drift, dimension scores do not improve, and convergence stalls. But this is an emergent property of the reduction loop, not a structural lattice invariant.

---

## 14. Error Model Across the FFI Boundary

### 14.1 Rust-side errors

The kernel is pure and should not panic on well-formed inputs. Errors arise from:
- Malformed YAML config (deserialization failure)
- Unknown state strings that don't map to enum variants
- NaN or infinity in numeric inputs
- Stale epoch (optimistic concurrency violation)

These are modeled as typed errors, not panics:

```rust
#[derive(Debug, thiserror::Error)]
pub enum KernelError {
    #[error("invalid governance config: {0}")]
    ConfigError(String),

    #[error("unknown state: {0}")]
    UnknownState(String),

    #[error("invalid numeric input: {field} = {value}")]
    InvalidNumeric { field: String, value: f64 },

    #[error("epoch mismatch: proposal epoch {proposal} < current {current}")]
    StaleEpoch { proposal: u64, current: u64 },
}
```

### 14.2 Bridge translation

napi-rs converts Rust `Result::Err` to JavaScript exceptions. The bridge wraps all kernel calls in `Result` and maps `KernelError` variants to structured JS errors:

```typescript
export class KernelError extends Error {
  readonly code: "CONFIG_ERROR" | "UNKNOWN_STATE" | "INVALID_NUMERIC" | "STALE_EPOCH";
  readonly details: Record<string, unknown>;
}
```

### 14.3 TS-side recovery

The TS orchestration layer must handle kernel errors gracefully, but without silently ignoring them (unlike v1's try/catch swallowing pattern):

| Error | Recovery |
|-------|----------|
| `CONFIG_ERROR` | Log, fall back to default config, alert operator |
| `UNKNOWN_STATE` | Reject proposal, log for debugging |
| `INVALID_NUMERIC` | Reject proposal (corrupted snapshot data) |
| `STALE_EPOCH` | Reject proposal (optimistic concurrency conflict; agent retries with fresh epoch) |
| napi-rs panic (should not happen) | Log stack trace, reject proposal, increment `kernel_panic` counter |

The kernel *must* produce a result or a typed error. Silent degradation is not acceptable for governance decisions.

---

## 15. Risk Assessment

| Risk | Mitigation |
|------|------------|
| napi-rs serialization overhead | Benchmark at Phase 0; fallback to struct bindings if > 1ms |
| Rust compilation slows dev cycle | `cargo watch` for Rust; bridge rebuild only on Rust changes |
| Team Rust experience | Phase 0 is pure math functions -- low-risk Rust. Complex async stays in TS |
| Cross-platform builds | napi-rs provides prebuild support for linux-x64, darwin-arm64 |
| Debugging across FFI | JSON logging at boundary; Rust side uses `tracing` crate |
| Two-language testing burden | Shared test fixtures (JSON) consumed by both Rust and TS test suites |
| Vector ordering causes too many escalations | Configurable tradeoff policies per scope; can whitelist permitted dimension regressions |
| Re-validation after escalation adds latency | Kernel is pure and sub-microsecond; re-validation cost is negligible vs. LLM overhead |
| Gate B behavioral change tightens finality | Run v1 experiment data against v2 gates before switching; config flag `gate_b_enforced: false` for gradual rollout |
| Governance ordering inversion from v1 | Comprehensive unit tests for escalation/de-escalation at Phase 2; v1 MASTER auto-approve behavior removed with explicit `--unsafe-approve-all` escape hatch |
