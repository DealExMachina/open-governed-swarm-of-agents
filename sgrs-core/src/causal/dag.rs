use std::collections::{HashMap, HashSet, VecDeque};

use crate::error::KernelError;

use super::contribution::{Contribution, ContributionId, ContributionKind};
use super::validation::validate_content_hash;

/// An immutable causal DAG of content-addressed contributions.
///
/// Invariants maintained by `insert`:
/// - Every contribution's `rid` matches SHA-256(CBOR(sorted_parents, payload, kind))
/// - Every parent referenced by a contribution exists in the DAG
/// - The graph is acyclic (no contribution is its own ancestor)
///
/// These invariants ensure DCS policy-independence (Proposition 1):
/// any valid insertion ordering of the same contribution set produces
/// an isomorphic DAG.
#[derive(Debug)]
pub struct CausalDag {
    nodes: HashMap<ContributionId, Contribution>,
    children: HashMap<ContributionId, Vec<ContributionId>>,
}

impl CausalDag {
    pub fn new() -> Self {
        CausalDag {
            nodes: HashMap::new(),
            children: HashMap::new(),
        }
    }

    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    pub fn contains(&self, id: &ContributionId) -> bool {
        self.nodes.contains_key(id)
    }

    pub fn get(&self, id: &ContributionId) -> Option<&Contribution> {
        self.nodes.get(id)
    }

    /// Returns all contribution IDs in the DAG.
    pub fn node_ids(&self) -> HashSet<ContributionId> {
        self.nodes.keys().cloned().collect()
    }

    /// Returns all edges as (parent, child) pairs.
    pub fn edges(&self) -> Vec<(ContributionId, ContributionId)> {
        let mut result = Vec::new();
        for (parent, kids) in &self.children {
            for child in kids {
                result.push((parent.clone(), child.clone()));
            }
        }
        result
    }

    /// Insert a contribution into the DAG.
    ///
    /// Validates:
    /// 1. `rid` matches the content hash of (parents, payload, kind)
    /// 2. All parents exist in the DAG
    /// 3. Inserting this contribution would not create a cycle
    ///
    /// Idempotent: re-inserting a contribution with the same `rid` is a no-op.
    pub fn insert(&mut self, c: Contribution) -> Result<(), KernelError> {
        // Idempotent: skip if already present
        if self.nodes.contains_key(&c.rid) {
            return Ok(());
        }

        // 1. Validate content hash
        validate_content_hash(&c)?;

        // 2. Validate all parents exist
        for parent_id in &c.parents {
            if !self.nodes.contains_key(parent_id) {
                return Err(KernelError::MissingParent {
                    child: c.rid.to_hex(),
                    parent: parent_id.to_hex(),
                });
            }
        }

        // 3. Check for cycles: the new contribution's rid must not appear
        //    in the ancestor set of any of its parents (which would mean
        //    there's already a path from rid to one of its parents).
        //    Since rid is a content hash and the contribution doesn't exist yet,
        //    the only cycle possible is if rid appears in its own parents list.
        for parent_id in &c.parents {
            if parent_id == &c.rid {
                return Err(KernelError::CycleDetected {
                    contribution: c.rid.to_hex(),
                });
            }
        }

        // Register as child of each parent
        for parent_id in &c.parents {
            self.children
                .entry(parent_id.clone())
                .or_default()
                .push(c.rid.clone());
        }

        // Ensure this contribution has a children entry
        self.children.entry(c.rid.clone()).or_default();

        self.nodes.insert(c.rid.clone(), c);
        Ok(())
    }

    /// Topological sort using Kahn's algorithm.
    ///
    /// Returns contributions in an order where every parent appears before its children.
    /// For a valid (acyclic) DAG, this always succeeds.
    pub fn topological_order(&self) -> Vec<&Contribution> {
        if self.nodes.is_empty() {
            return Vec::new();
        }

        // Compute in-degree (number of parents in DAG) for each node
        let mut in_degree: HashMap<&ContributionId, usize> = HashMap::new();
        for (id, contribution) in &self.nodes {
            // Count only parents that are in the DAG
            let parent_count = contribution
                .parents
                .iter()
                .filter(|p| self.nodes.contains_key(p))
                .count();
            in_degree.insert(id, parent_count);
        }

        // Start with roots (in-degree 0)
        let mut queue: VecDeque<&ContributionId> = in_degree
            .iter()
            .filter(|(_, &deg)| deg == 0)
            .map(|(&id, _)| id)
            .collect();

        // Sort queue for determinism
        let mut sorted_queue: Vec<&ContributionId> = queue.drain(..).collect();
        sorted_queue.sort_by_key(|id| &id.0);
        queue.extend(sorted_queue);

        let mut result = Vec::with_capacity(self.nodes.len());

        while let Some(id) = queue.pop_front() {
            if let Some(contribution) = self.nodes.get(id) {
                result.push(contribution);
            }

            if let Some(kids) = self.children.get(id) {
                // Sort children for deterministic ordering
                let mut sorted_kids: Vec<&ContributionId> = kids.iter().collect();
                sorted_kids.sort_by_key(|id| &id.0);

                for child_id in sorted_kids {
                    if let Some(deg) = in_degree.get_mut(child_id) {
                        *deg = deg.saturating_sub(1);
                        if *deg == 0 {
                            queue.push_back(child_id);
                        }
                    }
                }
            }
        }

        result
    }

    /// Compute the transitive closure of parents (all ancestors) for a contribution.
    ///
    /// Uses BFS over parent links. Returns an empty set for root contributions.
    pub fn ancestors(&self, id: &ContributionId) -> Result<HashSet<ContributionId>, KernelError> {
        if !self.nodes.contains_key(id) {
            return Err(KernelError::ConfigError(format!(
                "contribution not found: {}",
                id.to_hex()
            )));
        }

        let mut visited = HashSet::new();
        let mut queue = VecDeque::new();

        // Seed with direct parents
        if let Some(contribution) = self.nodes.get(id) {
            for parent_id in &contribution.parents {
                if visited.insert(parent_id.clone()) {
                    queue.push_back(parent_id.clone());
                }
            }
        }

        // BFS over parent links
        while let Some(current) = queue.pop_front() {
            if let Some(contribution) = self.nodes.get(&current) {
                for parent_id in &contribution.parents {
                    if visited.insert(parent_id.clone()) {
                        queue.push_back(parent_id.clone());
                    }
                }
            }
        }

        Ok(visited)
    }

    /// Causal cone: the contribution and all its ancestors, topologically sorted.
    pub fn causal_cone(&self, id: &ContributionId) -> Result<Vec<&Contribution>, KernelError> {
        let mut ancestor_ids = self.ancestors(id)?;
        ancestor_ids.insert(id.clone());

        // Build a sub-DAG topological order
        // Reuse the full topological order and filter
        let full_order = self.topological_order();
        let cone: Vec<&Contribution> = full_order
            .into_iter()
            .filter(|c| ancestor_ids.contains(&c.rid))
            .collect();

        Ok(cone)
    }

    /// Frontier: contributions with no children (DAG tips).
    pub fn frontier(&self) -> Vec<&ContributionId> {
        let mut tips: Vec<&ContributionId> = self
            .nodes
            .keys()
            .filter(|id| self.children.get(*id).is_none_or(|kids| kids.is_empty()))
            .collect();
        tips.sort_by_key(|id| &id.0);
        tips
    }

    /// Filter contributions by kind.
    pub fn by_kind(&self, kind: &ContributionKind) -> Vec<&Contribution> {
        self.nodes.values().filter(|c| &c.kind == kind).collect()
    }
}

impl Default for CausalDag {
    fn default() -> Self {
        Self::new()
    }
}
