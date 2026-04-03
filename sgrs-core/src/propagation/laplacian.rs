use nalgebra::DMatrix;

use super::sheaf::CellularSheaf;

/// Spectral analysis of the sheaf Laplacian L_F = δᵀδ.
#[derive(Debug, Clone)]
pub struct SpectralAnalysis {
    /// All eigenvalues of L_F, sorted ascending.
    pub eigenvalues: Vec<f64>,
    /// Smallest nonzero eigenvalue (spectral gap). 0.0 if disconnected.
    pub spectral_gap: f64,
    /// Largest eigenvalue.
    pub lambda_max: f64,
    /// Optimal diffusion rate α = 2/(λ₁ + λ_max).
    pub optimal_alpha: f64,
    /// Contraction rate ρ = (λ_max - λ₁)/(λ_max + λ₁).
    pub contraction_rate: f64,
    /// Approximate mixing time in steps: log(n)/log(1/ρ).
    pub mixing_time_estimate: f64,
    /// Whether the sheaf is connected (λ₁ > 0).
    pub is_connected: bool,
}

/// Eigenvalue threshold for considering a value "nonzero".
const EIGENVALUE_EPSILON: f64 = 1e-10;

/// Compute spectral analysis of a sheaf Laplacian.
///
/// Uses symmetric eigendecomposition since L_F = δᵀδ is PSD and symmetric.
pub fn spectral_analysis(sheaf: &CellularSheaf) -> SpectralAnalysis {
    let l_f = sheaf.laplacian();
    spectral_analysis_from_matrix(&l_f)
}

/// Compute spectral analysis from an already-computed Laplacian matrix.
pub fn spectral_analysis_from_matrix(l_f: &DMatrix<f64>) -> SpectralAnalysis {
    let n = l_f.nrows();
    if n == 0 {
        return SpectralAnalysis {
            eigenvalues: vec![],
            spectral_gap: 0.0,
            lambda_max: 0.0,
            optimal_alpha: 0.0,
            contraction_rate: 1.0,
            mixing_time_estimate: f64::INFINITY,
            is_connected: false,
        };
    }

    // Symmetrize (should already be symmetric, but ensure numerical stability)
    let symmetric = (l_f + l_f.transpose()) * 0.5;

    // Eigendecomposition
    let eigen = symmetric.symmetric_eigen();
    let mut eigenvalues: Vec<f64> = eigen.eigenvalues.iter().cloned().collect();
    eigenvalues.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    // Clamp tiny negative eigenvalues to zero (numerical noise)
    for ev in &mut eigenvalues {
        if *ev < 0.0 && *ev > -EIGENVALUE_EPSILON {
            *ev = 0.0;
        }
    }

    let lambda_max = eigenvalues.last().cloned().unwrap_or(0.0);

    // Spectral gap: smallest eigenvalue > EIGENVALUE_EPSILON
    let spectral_gap = eigenvalues
        .iter()
        .find(|&&ev| ev > EIGENVALUE_EPSILON)
        .cloned()
        .unwrap_or(0.0);

    let is_connected = spectral_gap > EIGENVALUE_EPSILON;

    // Optimal α = 2/(λ₁ + λ_max), only if connected
    let optimal_alpha = if is_connected && (spectral_gap + lambda_max) > 0.0 {
        2.0 / (spectral_gap + lambda_max)
    } else {
        0.0
    };

    // Contraction rate ρ = (λ_max - λ₁)/(λ_max + λ₁)
    let contraction_rate = if is_connected && (lambda_max + spectral_gap) > 0.0 {
        (lambda_max - spectral_gap) / (lambda_max + spectral_gap)
    } else {
        1.0 // no contraction if disconnected
    };

    // Mixing time ≈ log(n) / log(1/ρ)
    let mixing_time_estimate = if contraction_rate < 1.0 && contraction_rate > 0.0 {
        (n as f64).ln() / (1.0 / contraction_rate).ln()
    } else {
        f64::INFINITY
    };

    SpectralAnalysis {
        eigenvalues,
        spectral_gap,
        lambda_max,
        optimal_alpha,
        contraction_rate,
        mixing_time_estimate,
        is_connected,
    }
}
