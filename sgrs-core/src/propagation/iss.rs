/// ISS (Input-to-State Stability) cascade analysis.
///
/// The governed swarm is modeled as a cascade of three ISS subsystems:
///   1. Semantic layer (monotone lattice evolution) — gain γ₁
///   2. Propagation layer (sheaf diffusion) — gain γ₂
///   3. Contradiction layer (evidence conflicts) — gain γ₃
///
/// The ISS small-gain theorem guarantees global stability when the composed
/// gains satisfy: κ/(1 − ρ²) < 1.
///
/// This gives a *testable, enforceable* condition on the system design.
#[derive(Debug, Clone)]
pub struct ISSAnalysis {
    /// Contraction rate ρ = 1 − αλ₁ (from sheaf diffusion).
    pub contraction_rate: f64,
    /// ρ² (squared contraction rate, used in disagrement bound).
    pub contraction_rate_squared: f64,
    /// Propagation gain γ₂ = 1/(1 − ρ²): steady-state amplification of noise.
    pub propagation_gain: f64,
    /// Contradiction creation rate κ (empirically measured).
    pub contradiction_rate: f64,
    /// Whether the ISS small-gain condition holds: κ/(1 − ρ²) < 1.
    pub small_gain_satisfied: bool,
    /// Small-gain margin: 1 − κ/(1 − ρ²). Positive means stable.
    pub small_gain_margin: f64,
    /// Steady-state disagreement bound B_Ω = ‖ε‖²/(1 − ρ²).
    pub steady_state_disagreement: f64,
    /// Steady-state contradiction bound: κ · B_Ω.
    pub steady_state_contradictions: f64,
    /// Estimated convergence time to practical stability ball (in steps).
    pub convergence_time_estimate: f64,
}

/// Compute ISS cascade analysis.
///
/// Parameters:
/// - spectral_gap: λ₁(L_F), smallest nonzero eigenvalue of sheaf Laplacian
/// - alpha: diffusion rate (must be in (0, 2/λ_max))
/// - noise_bound: empirical ‖ε‖_∞ (max perturbation norm observed)
/// - contradiction_rate: empirical κ (contradictions per unit disagreement)
/// - initial_disagreement: Ω(x₀) at the start
pub fn analyze_iss(
    spectral_gap: f64,
    alpha: f64,
    noise_bound: f64,
    contradiction_rate: f64,
    initial_disagreement: f64,
) -> ISSAnalysis {
    // ρ = 1 - αλ₁
    let rho = 1.0 - alpha * spectral_gap;
    let rho_sq = rho * rho;

    // γ₂ = 1/(1 - ρ²), the steady-state gain
    // Only valid when ρ² < 1 (contraction holds)
    let propagation_gain = if rho_sq < 1.0 {
        1.0 / (1.0 - rho_sq)
    } else {
        f64::INFINITY
    };

    // Small-gain condition: κ/(1 - ρ²) < 1, i.e., κ < 1 - ρ²
    let one_minus_rho_sq = 1.0 - rho_sq;
    let small_gain_ratio = if one_minus_rho_sq > 0.0 {
        contradiction_rate / one_minus_rho_sq
    } else {
        f64::INFINITY
    };
    let small_gain_satisfied = small_gain_ratio < 1.0;
    let small_gain_margin = 1.0 - small_gain_ratio;

    // B_Ω = ‖ε‖² / (1 - ρ²)
    let noise_sq = noise_bound * noise_bound;
    let steady_state_disagreement = if one_minus_rho_sq > 0.0 {
        noise_sq / one_minus_rho_sq
    } else {
        f64::INFINITY
    };

    // Steady-state contradictions: κ · B_Ω
    let steady_state_contradictions = contradiction_rate * steady_state_disagreement;

    // Convergence time: log(Ω₀/B_Ω) / (2·log(1/ρ))
    let convergence_time_estimate = if rho > 0.0
        && rho < 1.0
        && steady_state_disagreement > 0.0
        && initial_disagreement > steady_state_disagreement
    {
        let log_ratio = (initial_disagreement / steady_state_disagreement).ln();
        let log_inv_rho = (1.0 / rho).ln();
        if log_inv_rho > 0.0 {
            log_ratio / (2.0 * log_inv_rho)
        } else {
            f64::INFINITY
        }
    } else {
        0.0
    };

    ISSAnalysis {
        contraction_rate: rho,
        contraction_rate_squared: rho_sq,
        propagation_gain,
        contradiction_rate,
        small_gain_satisfied,
        small_gain_margin,
        steady_state_disagreement,
        steady_state_contradictions,
        convergence_time_estimate,
    }
}
