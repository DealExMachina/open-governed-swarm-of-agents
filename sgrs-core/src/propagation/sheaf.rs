use nalgebra::DMatrix;

/// Linear restriction map on an edge of the role graph.
///
/// For edge (source, target) with stalks of dimensions d_source and d_target,
/// and an edge stalk of dimension d_edge:
///   - source_map: d_edge × d_source matrix mapping stalk(source) → edge_stalk
///   - target_map: d_edge × d_target matrix mapping stalk(target) → edge_stalk
///
/// The coboundary on this edge is: δ_e(x) = source_map · x_source - target_map · x_target.
/// When source_map and target_map are both identity, this reduces to x_source - x_target
/// (standard graph Laplacian consensus).
#[derive(Debug, Clone)]
pub struct RestrictionMap {
    pub source_role: usize,
    pub target_role: usize,
    pub edge_dim: usize,
    pub source_map: DMatrix<f64>,
    pub target_map: DMatrix<f64>,
}

impl RestrictionMap {
    /// Create an identity restriction map (constant sheaf case).
    /// Both source and target maps are identity matrices of dimension `dim`.
    pub fn identity(source_role: usize, target_role: usize, dim: usize) -> Self {
        RestrictionMap {
            source_role,
            target_role,
            edge_dim: dim,
            source_map: DMatrix::identity(dim, dim),
            target_map: DMatrix::identity(dim, dim),
        }
    }

    /// Create a scaled restriction map: both maps are `scale * I`.
    pub fn scaled_identity(source_role: usize, target_role: usize, dim: usize, scale: f64) -> Self {
        RestrictionMap {
            source_role,
            target_role,
            edge_dim: dim,
            source_map: DMatrix::identity(dim, dim) * scale,
            target_map: DMatrix::identity(dim, dim) * scale,
        }
    }

    /// Projection restriction map for heterogeneous-stalk sheaves.
    ///
    /// Each role's stalk is R^{2D} (support + refutation for D base dimensions).
    /// The edge stalk projects onto the **shared observed subspace**: the intersection
    /// of `source_observed` and `target_observed` dimension indices.
    ///
    /// edge_dim = 2 * |shared|. When both roles observe all dims, this degenerates
    /// to the identity map (backward compatible with constant sheaf).
    ///
    /// The coboundary δ_e(x) = source_map · x_source - target_map · x_target
    /// measures disagreement only on the dimensions both roles observe.
    pub fn projection(
        source_role: usize,
        target_role: usize,
        num_dims: usize,
        source_observed: &[usize],
        target_observed: &[usize],
    ) -> Self {
        let stalk_dim = 2 * num_dims;
        let mut shared: Vec<usize> = source_observed
            .iter()
            .filter(|d| target_observed.contains(d))
            .copied()
            .collect();
        shared.sort_unstable();
        shared.dedup();

        let edge_dim = 2 * shared.len();

        let mut source_map = DMatrix::zeros(edge_dim, stalk_dim);
        let mut target_map = DMatrix::zeros(edge_dim, stalk_dim);

        for (j, &dim_idx) in shared.iter().enumerate() {
            // Support channel: row j picks column dim_idx
            source_map[(j, dim_idx)] = 1.0;
            target_map[(j, dim_idx)] = 1.0;
            // Refutation channel: row |shared|+j picks column num_dims+dim_idx
            source_map[(shared.len() + j, num_dims + dim_idx)] = 1.0;
            target_map[(shared.len() + j, num_dims + dim_idx)] = 1.0;
        }

        RestrictionMap {
            source_role,
            target_role,
            edge_dim,
            source_map,
            target_map,
        }
    }
}

/// Cellular sheaf F on the role graph G = (R, E).
///
/// A sheaf assigns:
///   - A stalk (vector space) F(v) to each vertex (role) v
///   - A stalk F(e) to each edge e, with restriction maps F(v) → F(e)
///
/// The sheaf Laplacian L_F = δᵀδ generalizes the graph Laplacian.
/// - When all restriction maps are identity: L_F = standard graph Laplacian
/// - The kernel ker(L_F) = H⁰(G; F) = global sections (consensus states)
/// - The spectral gap λ₁(L_F) determines convergence rate
#[derive(Debug, Clone)]
pub struct CellularSheaf {
    pub num_roles: usize,
    pub stalk_dims: Vec<usize>,
    pub restriction_maps: Vec<RestrictionMap>,
}

impl CellularSheaf {
    /// Total dimension of the vertex stalk space: Σ stalk_dims[i].
    pub fn total_vertex_dim(&self) -> usize {
        self.stalk_dims.iter().sum()
    }

    /// Total dimension of the edge stalk space: Σ edge_dims.
    pub fn total_edge_dim(&self) -> usize {
        self.restriction_maps.iter().map(|r| r.edge_dim).sum()
    }

    /// Stalk offset for role i in the assembled vector.
    pub fn stalk_offset(&self, role: usize) -> usize {
        self.stalk_dims[..role].iter().sum()
    }

    /// Coboundary matrix δ: ⊕ F(v) → ⊕ F(e).
    ///
    /// For each edge e = (u, v):
    ///   δ_e(x) = source_map · x_u - target_map · x_v
    ///
    /// The assembled matrix has dimensions (total_edge_dim × total_vertex_dim).
    pub fn coboundary_matrix(&self) -> DMatrix<f64> {
        let n_vertex = self.total_vertex_dim();
        let n_edge = self.total_edge_dim();
        let mut delta = DMatrix::zeros(n_edge, n_vertex);

        let mut edge_offset = 0;
        for rmap in &self.restriction_maps {
            let src_offset = self.stalk_offset(rmap.source_role);
            let tgt_offset = self.stalk_offset(rmap.target_role);
            let src_dim = self.stalk_dims[rmap.source_role];
            let tgt_dim = self.stalk_dims[rmap.target_role];

            // δ_e block for source: +source_map
            for row in 0..rmap.edge_dim {
                for col in 0..src_dim {
                    delta[(edge_offset + row, src_offset + col)] = rmap.source_map[(row, col)];
                }
            }

            // δ_e block for target: -target_map
            for row in 0..rmap.edge_dim {
                for col in 0..tgt_dim {
                    delta[(edge_offset + row, tgt_offset + col)] = -rmap.target_map[(row, col)];
                }
            }

            edge_offset += rmap.edge_dim;
        }

        delta
    }

    /// Sheaf Laplacian L_F = δᵀδ (positive semidefinite).
    ///
    /// Dimensions: total_vertex_dim × total_vertex_dim.
    pub fn laplacian(&self) -> DMatrix<f64> {
        let delta = self.coboundary_matrix();
        delta.transpose() * &delta
    }

    /// Create a constant sheaf (all restriction maps are identity).
    /// This reduces to the standard graph Laplacian for consensus problems.
    pub fn constant(num_roles: usize, stalk_dim: usize, edges: &[(usize, usize)]) -> Self {
        let stalk_dims = vec![stalk_dim; num_roles];
        let restriction_maps = edges
            .iter()
            .map(|&(src, tgt)| RestrictionMap::identity(src, tgt, stalk_dim))
            .collect();
        CellularSheaf {
            num_roles,
            stalk_dims,
            restriction_maps,
        }
    }

    /// Build a sheaf from per-role observation masks and an explicit edge list.
    ///
    /// Each role's stalk is R^{2D} (support + refutation for `num_dims` base
    /// dimensions). The restriction map on each edge projects onto the **shared
    /// observed subspace** between source and target, using
    /// `RestrictionMap::projection`.
    ///
    /// When all roles observe all dimensions, this is equivalent to `constant`.
    /// When a role observes a strict subset, the sheaf Laplacian couples only
    /// shared dimensions on each edge, preserving role expertise in the fixed
    /// point (H^0).
    ///
    /// Panics if any `observed_dims` entry contains an index >= `num_dims`.
    pub fn from_role_observations(
        num_roles: usize,
        num_dims: usize,
        observed_dims: &[Vec<usize>],
        edges: &[(usize, usize)],
    ) -> Self {
        assert_eq!(observed_dims.len(), num_roles);
        for (i, obs) in observed_dims.iter().enumerate() {
            for &d in obs {
                assert!(
                    d < num_dims,
                    "Role {} observes dim {} but num_dims = {}",
                    i,
                    d,
                    num_dims
                );
            }
        }

        let stalk_dim = 2 * num_dims;
        let stalk_dims = vec![stalk_dim; num_roles];

        let restriction_maps = edges
            .iter()
            .map(|&(src, tgt)| {
                RestrictionMap::projection(
                    src,
                    tgt,
                    num_dims,
                    &observed_dims[src],
                    &observed_dims[tgt],
                )
            })
            .collect();

        CellularSheaf {
            num_roles,
            stalk_dims,
            restriction_maps,
        }
    }
}
