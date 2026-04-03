//! E14: FCA Structure Test — Gate Experiment for FCA Viability
//!
//! Compares concept count at near-finality under constant vs projection sheaf.
//! If the projection sheaf produces more non-trivial formal concepts, it
//! provides structural information that FCA can exploit in Stage 3.
//!
//! Uses a minimal inline concept enumerator (Next-Closure) on the 7-role x 16-attribute
//! boolean incidence matrix (7 agents, 4 dims x 2 channels x 2 {high,low} = 16 attributes).
//!
//! Run: cargo test --test exp_fca_structure -- --nocapture

use sgrs_core::propagation::{
    compute_disagreement, propagation_step, spectral_analysis, AdmissibleProjection,
    CellularSheaf, EvidenceState, EvidenceVector,
};

// ─── Configuration ──────────────────────────────────────────────────────────

const NUM_ROLES: usize = 7;
const NUM_DIMS: usize = 4;
const STEPS: usize = 30;
const THETA: f64 = 0.5;

const ROLE_NAMES: [&str; 7] = [
    "facts", "drift", "resolver", "planner", "status", "governance", "tuner",
];

fn role_observations() -> Vec<Vec<usize>> {
    vec![
        vec![0],          // facts
        vec![1],          // drift
        vec![1, 2],       // resolver
        vec![2],          // planner
        vec![3],          // status
        vec![0, 1, 2, 3], // governance
        vec![0, 1, 2, 3], // tuner
    ]
}

fn complete_edges(n: usize) -> Vec<(usize, usize)> {
    let mut e = Vec::new();
    for i in 0..n {
        for j in (i + 1)..n {
            e.push((i, j));
        }
    }
    e
}

fn make_initial_state() -> EvidenceState {
    let role_states = (0..NUM_ROLES)
        .map(|i| {
            let base = (i as f64 + 1.0) / NUM_ROLES as f64;
            EvidenceVector {
                support: (0..NUM_DIMS)
                    .map(|d| (base + d as f64 * 0.12).min(1.0))
                    .collect(),
                refutation: (0..NUM_DIMS)
                    .map(|d| (1.0 - base + d as f64 * 0.08).min(1.0))
                    .collect(),
            }
        })
        .collect();
    EvidenceState {
        role_states,
        num_roles: NUM_ROLES,
        num_dims: NUM_DIMS,
    }
}

// ─── FCA: Formal context and concept enumeration ────────────────────────────

/// Build a formal context (boolean incidence matrix) from an evidence state.
///
/// Attributes are: for each dim d and channel c (support, refutation),
///   - "d_c_high" = value > theta
///   - "d_c_low"  = value <= theta
///
/// Total attributes = 4 dims x 2 channels x 2 levels = 16.
/// Rows = roles (objects), columns = attributes.
fn build_formal_context(state: &EvidenceState, theta: f64) -> Vec<Vec<bool>> {
    let num_attrs = NUM_DIMS * 4; // 4 dims x (support_high, support_low, refutation_high, refutation_low)
    let mut context = vec![vec![false; num_attrs]; NUM_ROLES];

    for (role_idx, ev) in state.role_states.iter().enumerate() {
        for d in 0..NUM_DIMS {
            let s = ev.support[d];
            let r = ev.refutation[d];
            let base = d * 4;
            context[role_idx][base] = s > theta;     // support_high
            context[role_idx][base + 1] = s <= theta; // support_low
            context[role_idx][base + 2] = r > theta;  // refutation_high
            context[role_idx][base + 3] = r <= theta;  // refutation_low
        }
    }

    context
}

/// Compute the intent (common attributes) of an object set.
fn intent(context: &[Vec<bool>], objects: &[bool]) -> Vec<bool> {
    let num_attrs = context[0].len();
    let mut result = vec![true; num_attrs];

    let mut any_object = false;
    for (i, &included) in objects.iter().enumerate() {
        if included {
            any_object = true;
            for j in 0..num_attrs {
                result[j] = result[j] && context[i][j];
            }
        }
    }

    if !any_object {
        return vec![true; num_attrs]; // empty extent -> all attributes
    }

    result
}

/// Compute the extent (common objects) of an attribute set.
fn extent(context: &[Vec<bool>], attrs: &[bool]) -> Vec<bool> {
    let num_objects = context.len();
    let num_attrs = attrs.len();
    let mut result = vec![true; num_objects];

    let mut any_attr = false;
    for j in 0..num_attrs {
        if attrs[j] {
            any_attr = true;
            for i in 0..num_objects {
                result[i] = result[i] && context[i][j];
            }
        }
    }

    if !any_attr {
        return vec![true; num_objects]; // empty intent -> all objects
    }

    result
}

/// Enumerate all formal concepts using a brute-force approach.
/// For 7 objects x 16 attributes, this is tractable (2^7 = 128 subsets).
fn enumerate_concepts(context: &[Vec<bool>]) -> Vec<(Vec<bool>, Vec<bool>)> {
    let num_objects = context.len();
    let mut concepts = Vec::new();
    let mut seen_intents: Vec<Vec<bool>> = Vec::new();

    // Iterate over all subsets of objects (2^num_objects)
    for mask in 0..(1u32 << num_objects) {
        let objects: Vec<bool> = (0..num_objects).map(|i| (mask >> i) & 1 == 1).collect();
        let int = intent(context, &objects);
        let ext = extent(context, &int);

        // Verify closure: the extent of the intent must equal the original object set
        // (otherwise this subset doesn't form a concept)
        if ext == objects {
            // Dedup: check if we already have this intent
            if !seen_intents.contains(&int) {
                seen_intents.push(int.clone());
                concepts.push((ext, int));
            }
        }
    }

    concepts
}

/// Count "non-trivial" concepts: those where extent is neither empty nor full,
/// and intent is neither empty nor full.
fn count_nontrivial_concepts(concepts: &[(Vec<bool>, Vec<bool>)]) -> usize {
    concepts.iter().filter(|(ext, int)| {
        let ext_count = ext.iter().filter(|&&x| x).count();
        let int_count = int.iter().filter(|&&x| x).count();
        ext_count > 0 && ext_count < ext.len() && int_count > 0 && int_count < int.len()
    }).count()
}

fn attr_name(idx: usize) -> String {
    let dim = idx / 4;
    let sub = idx % 4;
    let dim_names = ["claim", "contra", "goal", "risk"];
    let sub_names = ["s_hi", "s_lo", "r_hi", "r_lo"];
    format!("{}_{}", dim_names[dim], sub_names[sub])
}

// ─── E14: FCA Structure Test ────────────────────────────────────────────────

#[test]
fn e14_fca_structure_comparison() {
    println!("\n=== E14: FCA Structure Test — Constant vs Projection Sheaf ===\n");

    let edges = complete_edges(NUM_ROLES);
    let obs = role_observations();
    let stalk_dim = 2 * NUM_DIMS;

    let sheaf_const = CellularSheaf::constant(NUM_ROLES, stalk_dim, &edges);
    let sa_const = spectral_analysis(&sheaf_const);

    let sheaf_proj = CellularSheaf::from_role_observations(NUM_ROLES, NUM_DIMS, &obs, &edges);
    let sa_proj = spectral_analysis(&sheaf_proj);

    let initial = make_initial_state();
    let perturbation = EvidenceState::zeros(NUM_ROLES, NUM_DIMS);
    let projection = AdmissibleProjection::unit_box(NUM_DIMS);

    let mut state_const = initial.clone();
    let mut state_proj = initial.clone();

    let snapshot_steps = vec![5, 15, 30];
    let mut const_concept_trajectory: Vec<(usize, usize, usize)> = Vec::new();
    let mut proj_concept_trajectory: Vec<(usize, usize, usize)> = Vec::new();

    println!(
        "{:>4} | {:>8} {:>6} {:>8} | {:>8} {:>6} {:>8}",
        "Step", "Ω(const)", "#cpt_c", "#ntv_c", "Ω(proj)", "#cpt_p", "#ntv_p"
    );
    println!("{}", "-".repeat(70));

    for step in 1..=STEPS {
        let r = propagation_step(
            &sheaf_const, &state_const, &perturbation, &projection, sa_const.optimal_alpha,
        );
        state_const = r.new_state;

        let r = propagation_step(
            &sheaf_proj, &state_proj, &perturbation, &projection, sa_proj.optimal_alpha,
        );
        state_proj = r.new_state;

        if snapshot_steps.contains(&step) {
            let ctx_const = build_formal_context(&state_const, THETA);
            let concepts_const = enumerate_concepts(&ctx_const);
            let ntv_const = count_nontrivial_concepts(&concepts_const);

            let ctx_proj = build_formal_context(&state_proj, THETA);
            let concepts_proj = enumerate_concepts(&ctx_proj);
            let ntv_proj = count_nontrivial_concepts(&concepts_proj);

            let omega_const = compute_disagreement(&state_const);
            let omega_proj = compute_disagreement(&state_proj);

            println!(
                "{:>4} | {:>8.2e} {:>6} {:>8} | {:>8.2e} {:>6} {:>8}",
                step,
                omega_const, concepts_const.len(), ntv_const,
                omega_proj, concepts_proj.len(), ntv_proj,
            );

            const_concept_trajectory.push((step, concepts_const.len(), ntv_const));
            proj_concept_trajectory.push((step, concepts_proj.len(), ntv_proj));
        }
    }

    // Print final concept details for projection sheaf
    let ctx_proj_final = build_formal_context(&state_proj, THETA);
    let concepts_proj_final = enumerate_concepts(&ctx_proj_final);

    println!("\n--- Projection sheaf concepts at step {} ---\n", STEPS);
    let num_attrs = NUM_DIMS * 4;
    for (i, (ext, int)) in concepts_proj_final.iter().enumerate() {
        let ext_roles: Vec<&str> = ext.iter().enumerate()
            .filter(|(_, &x)| x)
            .map(|(j, _)| ROLE_NAMES[j])
            .collect();
        let int_attrs: Vec<String> = int.iter().enumerate()
            .filter(|(_, &x)| x)
            .map(|(j, _)| attr_name(j))
            .collect();
        if ext_roles.len() > 0 && ext_roles.len() < NUM_ROLES
            && int_attrs.len() > 0 && int_attrs.len() < num_attrs
        {
            println!(
                "  C{}: {{ {} }} -> {{ {} }}",
                i,
                ext_roles.join(", "),
                int_attrs.join(", ")
            );
        }
    }

    // Extract final counts
    let (_, final_const_total, final_const_ntv) = const_concept_trajectory.last().unwrap();
    let (_, final_proj_total, final_proj_ntv) = proj_concept_trajectory.last().unwrap();

    println!(
        "\n--- Summary ---"
    );
    println!(
        "At step {}: constant sheaf = {} concepts ({} non-trivial)",
        STEPS, final_const_total, final_const_ntv
    );
    println!(
        "At step {}: projection sheaf = {} concepts ({} non-trivial)",
        STEPS, final_proj_total, final_proj_ntv
    );

    // Gate assertion: projection sheaf should produce more non-trivial concepts
    assert!(
        final_proj_ntv > final_const_ntv,
        "E14 GATE FAILED: projection sheaf ({} non-trivial concepts) does not produce\n\
         more structure than constant sheaf ({} non-trivial concepts).\n\
         FCA roadmap needs reassessment.",
        final_proj_ntv, final_const_ntv
    );

    println!(
        "\nE14 GATE PASSED: projection sheaf produces {} more non-trivial concepts.",
        final_proj_ntv - final_const_ntv
    );
    println!("FCA (Stage 3) can exploit this structural information.\n");
}
