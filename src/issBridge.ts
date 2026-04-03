/**
 * ISS cascade monitoring.
 * Composes semantic defect, propagation disagreement, and contradiction burden
 * into a single ISSCascadeResult; replaces unproven composite Lyapunov.
 */
import type { ISSAnalysis } from "./sgrsAdapter.js";

export interface ISSCascadeResult {
  semantic: {
    psi: number;
    monotone: boolean;
  };
  propagation: {
    omega: number;
    rho: number;
    practical_bound: number;
    within_bound: boolean;
  };
  contradiction: {
    burden: number;
    kappa: number;
    bounded: boolean;
  };
  cascade_stable: boolean;
  finality_reachable: boolean;
  convergence_eta_rounds: number;
}

export interface ISSCascadeInput {
  /** Semantic defect V₁(S) from convergence/finality snapshot (e.g. 1 - goal_score). */
  psi?: number;
  /** Whether semantic state is monotone S_t ⪯ S_{t+1}. */
  monotone?: boolean;
  /** Current disagreement Ω(x). */
  omega: number;
  /** Result from PropagationEngine.analyzeISS or sgrsAdapter.analyzeISS. */
  iss: ISSAnalysis;
  /** Current contradiction burden C(S) (e.g. unresolved count or weighted sum). */
  burden?: number;
  /** Threshold below which we consider finality reachable (e.g. 0.1). */
  finality_threshold?: number;
}

/**
 * Build ISS cascade result from propagation/ISS data and optional semantic inputs.
 */
export function computeISSCascadeResult(input: ISSCascadeInput): ISSCascadeResult {
  const {
    psi = 0,
    monotone = true,
    omega,
    iss,
    burden = 0,
    finality_threshold = 0.1,
  } = input;

  const practicalBound = iss.steady_state_disagreement;
  const withinBound = Number.isFinite(practicalBound) && omega <= practicalBound + 1e-12;
  const contradictionBounded =
    Number.isFinite(iss.steady_state_contradictions) &&
    burden <= iss.steady_state_contradictions + 1e-12;

  return {
    semantic: { psi, monotone },
    propagation: {
      omega,
      rho: iss.contraction_rate,
      practical_bound: practicalBound,
      within_bound: withinBound,
    },
    contradiction: {
      burden,
      kappa: iss.contradiction_rate,
      bounded: contradictionBounded,
    },
    cascade_stable: iss.small_gain_satisfied,
    finality_reachable: withinBound && psi <= finality_threshold,
    convergence_eta_rounds: Math.ceil(iss.convergence_time_estimate),
  };
}
