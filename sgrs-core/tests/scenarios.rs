//! Realistic evidence state scenarios derived from the Project Horizon M&A demo.
//!
//! The live demo feeds 5 documents through the swarm, each producing distinct
//! evidence patterns across 7 roles × 4 dimensions. These generators model
//! the actual evidence distributions observed during demo runs, replacing
//! the synthetic alternating pattern used in early experiments.
//!
//! Dimensions (D=4):
//!   D₀ = claim_confidence          (strength of belief in factual claims)
//!   D₁ = contradiction_resolution  (fraction of contradictions resolved)
//!   D₂ = goal_completion           (fraction of goals achieved)
//!   D₃ = risk_score_inverse        (1 - risk severity)
//!
//! Roles (N=7):
//!   0 = facts, 1 = drift, 2 = resolver, 3 = planner,
//!   4 = status, 5 = governance, 6 = tuner

use sgrs_core::propagation::{EvidenceState, EvidenceVector};

pub const NUM_DIMS: usize = 4;
pub const NUM_ROLES: usize = 7;

/// Role indices matching the live system.
pub const FACTS: usize = 0;
pub const DRIFT: usize = 1;
pub const RESOLVER: usize = 2;
pub const PLANNER: usize = 3;
pub const STATUS: usize = 4;
pub const GOVERNANCE: usize = 5;
pub const TUNER: usize = 6;

fn ev(support: [f64; 4], refutation: [f64; 4]) -> EvidenceVector {
    EvidenceVector {
        support: support.to_vec(),
        refutation: refutation.to_vec(),
    }
}

// ─── Phase generators ─────────────────────────────────────────────────────────

/// Phase 1: Initial analyst briefing (Doc 01).
///
/// High claim confidence (ARR €50M stated), no contradictions detected,
/// goals just articulated, moderate risk awareness. Evidence is optimistic
/// and roles largely agree — low initial disagreement.
pub fn phase1_initial_briefing() -> EvidenceState {
    EvidenceState {
        role_states: vec![
            // facts: high claim confidence, not much else known
            ev([0.85, 0.10, 0.20, 0.30], [0.10, 0.05, 0.05, 0.15]),
            // drift: nothing to contradict yet
            ev([0.70, 0.10, 0.15, 0.25], [0.15, 0.05, 0.05, 0.10]),
            // resolver: idle, low evidence
            ev([0.50, 0.10, 0.10, 0.20], [0.10, 0.05, 0.05, 0.10]),
            // planner: goals stated but not started
            ev([0.60, 0.10, 0.15, 0.25], [0.10, 0.05, 0.10, 0.10]),
            // status: some risks noted (talent, patent)
            ev([0.55, 0.10, 0.10, 0.60], [0.10, 0.05, 0.05, 0.25]),
            // governance: overview, moderate on everything
            ev([0.65, 0.10, 0.15, 0.40], [0.15, 0.05, 0.05, 0.15]),
            // tuner: mirrors governance baseline
            ev([0.60, 0.10, 0.12, 0.35], [0.12, 0.05, 0.05, 0.12]),
        ],
        num_roles: NUM_ROLES,
        num_dims: NUM_DIMS,
    }
}

/// Phase 2: Financial DD reveals €12M ARR overstatement (Doc 02).
///
/// Claim confidence drops sharply for facts/governance (ARR contradiction).
/// Drift detects contradictions — contradiction_resolution falls. Resolver
/// begins work. Risk increases. Roles DISAGREE on claim_confidence.
pub fn phase2_financial_dd() -> EvidenceState {
    EvidenceState {
        role_states: vec![
            // facts: ARR claim challenged, confidence drops
            ev([0.45, 0.15, 0.20, 0.25], [0.40, 0.10, 0.05, 0.20]),
            // drift: detects contradiction, high refutation on claims
            ev([0.30, 0.20, 0.15, 0.20], [0.55, 0.60, 0.05, 0.15]),
            // resolver: working on contradictions
            ev([0.40, 0.30, 0.15, 0.20], [0.30, 0.40, 0.05, 0.15]),
            // planner: goals unchanged, risk noted
            ev([0.55, 0.15, 0.18, 0.22], [0.15, 0.10, 0.10, 0.18]),
            // status: risk elevated
            ev([0.40, 0.15, 0.12, 0.35], [0.20, 0.10, 0.05, 0.45]),
            // governance: blocks on contradictions
            ev([0.35, 0.20, 0.15, 0.25], [0.45, 0.50, 0.05, 0.30]),
            // tuner: adjusting, moderate skepticism
            ev([0.40, 0.18, 0.14, 0.25], [0.35, 0.35, 0.05, 0.20]),
        ],
        num_roles: NUM_ROLES,
        num_dims: NUM_DIMS,
    }
}

/// Phase 3: Technical DD + talent risk + patent concern (Docs 03-04).
///
/// Tech validated (claim_confidence recovers slightly), but key-person
/// departure and patent lawsuit add new contradictions and risks.
/// Maximum disagreement across roles — the interesting propagation case.
pub fn phase3_contested_mixed() -> EvidenceState {
    EvidenceState {
        role_states: vec![
            // facts: tech claims validated, financial still disputed
            ev([0.55, 0.25, 0.22, 0.20], [0.30, 0.15, 0.08, 0.25]),
            // drift: new contradictions from patent lawsuit
            ev([0.35, 0.15, 0.18, 0.18], [0.45, 0.65, 0.10, 0.20]),
            // resolver: partially resolved financial, new patent issue
            ev([0.50, 0.40, 0.20, 0.22], [0.25, 0.35, 0.08, 0.18]),
            // planner: goals partially met (tech validation done)
            ev([0.50, 0.20, 0.45, 0.20], [0.15, 0.10, 0.20, 0.15]),
            // status: high risk (talent departure + patent)
            ev([0.40, 0.18, 0.15, 0.25], [0.25, 0.12, 0.10, 0.65]),
            // governance: cautious, diverse evidence
            ev([0.42, 0.30, 0.25, 0.22], [0.38, 0.40, 0.12, 0.40]),
            // tuner: sees mixed signals everywhere
            ev([0.45, 0.22, 0.20, 0.22], [0.32, 0.30, 0.10, 0.30]),
        ],
        num_roles: NUM_ROLES,
        num_dims: NUM_DIMS,
    }
}

/// Phase 4: Near-finality — legal review, most contradictions resolved (Doc 05).
///
/// Contradictions largely resolved. Claim confidence stabilized at adjusted
/// ARR (€38M). Goals mostly complete. Residual risk acknowledged. Roles
/// converging toward agreement — low disagreement.
pub fn phase4_near_finality() -> EvidenceState {
    EvidenceState {
        role_states: vec![
            // facts: adjusted claims accepted
            ev([0.75, 0.85, 0.70, 0.55], [0.15, 0.10, 0.15, 0.20]),
            // drift: contradictions mostly resolved
            ev([0.70, 0.80, 0.65, 0.50], [0.18, 0.12, 0.18, 0.22]),
            // resolver: resolution work done
            ev([0.72, 0.90, 0.68, 0.52], [0.14, 0.08, 0.15, 0.20]),
            // planner: goals mostly complete
            ev([0.68, 0.78, 0.80, 0.50], [0.15, 0.10, 0.10, 0.18]),
            // status: residual risk accepted
            ev([0.65, 0.75, 0.60, 0.70], [0.18, 0.12, 0.15, 0.15]),
            // governance: ready for HITL
            ev([0.70, 0.82, 0.72, 0.58], [0.16, 0.10, 0.12, 0.18]),
            // tuner: aligned with governance
            ev([0.68, 0.80, 0.70, 0.55], [0.17, 0.11, 0.14, 0.19]),
        ],
        num_roles: NUM_ROLES,
        num_dims: NUM_DIMS,
    }
}

/// All M&A phases as a labeled collection.
pub fn all_phases() -> Vec<(&'static str, EvidenceState)> {
    vec![
        ("P1-briefing", phase1_initial_briefing()),
        ("P2-financial-dd", phase2_financial_dd()),
        ("P3-contested", phase3_contested_mixed()),
        ("P4-near-finality", phase4_near_finality()),
    ]
}

// ─── Topology matching the live swarm ─────────────────────────────────────────

/// The actual sheaf edges from propagation.yaml.
///
/// facts → drift → resolver → planner → status → governance → facts
///                                       status → governance (shortcut)
///
/// This is a directed cycle with one shortcut edge. For undirected
/// propagation tests we use the undirected version.
pub fn swarm_edges() -> Vec<(usize, usize)> {
    vec![
        (FACTS, DRIFT),
        (DRIFT, RESOLVER),
        (RESOLVER, PLANNER),
        (PLANNER, STATUS),
        (STATUS, GOVERNANCE),
        (GOVERNANCE, FACTS),
        (GOVERNANCE, TUNER),
    ]
}

// ─── Scaled scenarios: realistic N for propagation stress-testing ────────────
//
// Real-world governed swarms scale to 20-50+ agents. The 7-role base is a
// minimal system; production deploys multiple instances per role, specialized
// sub-agents, and domain experts. These generators scale the M&A phases to
// realistic node counts while preserving the evidence distribution structure.
//
// Scaling strategy:
//   - Each base role spawns ⌈n/7⌉ instances with jittered evidence
//   - Jitter models real variance: different LLM calls on the same docs
//     produce slightly different confidence scores (±0.05 to ±0.15)
//   - Topology is built to match the scaling: ring, 3-regular, or modular

use rand::rngs::StdRng;
use rand::SeedableRng;
use rand::Rng;

/// Scale a 7-role M&A phase to n nodes with realistic jitter.
///
/// Each node inherits from the base role `i % 7` with per-component
/// Gaussian-like jitter (uniform ±jitter_range, clamped to [0,1]).
/// This models multiple LLM instances extracting from the same corpus
/// but producing slightly different confidence scores.
pub fn scale_phase(base: &EvidenceState, n: usize, jitter_range: f64, seed: u64) -> EvidenceState {
    let mut rng = StdRng::seed_from_u64(seed);
    let d = base.num_dims;
    let base_n = base.num_roles;

    let role_states = (0..n)
        .map(|i| {
            let template = &base.role_states[i % base_n];
            EvidenceVector {
                support: (0..d)
                    .map(|dim| {
                        let jitter = rng.random::<f64>() * 2.0 * jitter_range - jitter_range;
                        (template.support[dim] + jitter).clamp(0.0, 1.0)
                    })
                    .collect(),
                refutation: (0..d)
                    .map(|dim| {
                        let jitter = rng.random::<f64>() * 2.0 * jitter_range - jitter_range;
                        (template.refutation[dim] + jitter).clamp(0.0, 1.0)
                    })
                    .collect(),
            }
        })
        .collect();

    EvidenceState {
        role_states,
        num_roles: n,
        num_dims: d,
    }
}

/// Build a 3-regular graph on n nodes (each node connects to 3 neighbors).
///
/// Uses a ring plus one long-range shortcut per node. This models
/// a realistic gossip overlay: local neighbors + occasional long-range links.
pub fn regular3_edges(n: usize) -> Vec<(usize, usize)> {
    let mut edges = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for i in 0..n {
        // Ring neighbor
        let j = (i + 1) % n;
        let key = (i.min(j), i.max(j));
        if seen.insert(key) {
            edges.push(key);
        }

        // Long-range shortcut (deterministic, spread evenly)
        let k = (i + n / 3) % n;
        if k != i {
            let key2 = (i.min(k), i.max(k));
            if seen.insert(key2) {
                edges.push(key2);
            }
        }
    }

    edges
}

/// Build a modular graph: k clusters of size n/k, dense within, sparse between.
///
/// Models multi-team swarms where agents within a team communicate densely
/// but inter-team communication is sparse.
pub fn modular_edges(n: usize, num_clusters: usize) -> Vec<(usize, usize)> {
    let cluster_size = n / num_clusters;
    let mut edges = Vec::new();

    // Intra-cluster: complete subgraph
    for c in 0..num_clusters {
        let start = c * cluster_size;
        let end = start + cluster_size;
        for i in start..end {
            for j in (i + 1)..end.min(n) {
                edges.push((i, j));
            }
        }
    }

    // Inter-cluster: one bridge per adjacent cluster pair
    for c in 0..num_clusters {
        let next = (c + 1) % num_clusters;
        let bridge_a = c * cluster_size;
        let bridge_b = next * cluster_size;
        if bridge_a != bridge_b {
            edges.push((bridge_a, bridge_b));
        }
    }

    edges
}

/// Scaled M&A phases at a given node count.
pub fn scaled_phases(n: usize) -> Vec<(&'static str, EvidenceState)> {
    vec![
        ("P1-scaled", scale_phase(&phase1_initial_briefing(), n, 0.08, 100)),
        ("P2-scaled", scale_phase(&phase2_financial_dd(), n, 0.12, 200)),
        ("P3-scaled", scale_phase(&phase3_contested_mixed(), n, 0.15, 300)),
        ("P4-scaled", scale_phase(&phase4_near_finality(), n, 0.06, 400)),
    ]
}

// ─── JSON fixture loading ────────────────────────────────────────────────────

/// Load an evidence state from a JSON fixture file.
///
/// Expected format: { "num_roles": N, "num_dims": D, "role_states": [...] }
/// where each role_state is { "support": [...], "refutation": [...] }
pub fn load_fixture(path: &str) -> Option<EvidenceState> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}
