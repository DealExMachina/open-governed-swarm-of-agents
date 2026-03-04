/**
 * Convergence tracker for finality gradient descent.
 *
 * Implements five mechanisms from the literature:
 * 1. Lyapunov disagreement function V(t) — quadratic distance to finality targets (Olfati-Saber 2007)
 * 2. Convergence rate α = -ln(V(t)/V(t-1)) — exponential decay rate estimation
 * 3. Monotonicity gate — score must be non-decreasing for β rounds before auto-resolve (Aegean)
 * 4. Plateau detection — EMA of progress ratio; triggers HITL when stalled (MACI)
 * 5. Pressure-directed activation — per-dimension pressure for stigmergic routing (Royal Society 2024)
 *
 * Gate C: oscillation detection (direction runs + lag-1 autocorrelation), trajectory quality score,
 * and coordination signal (agent-to-agent).
 *
 * All analysis functions are pure (no side effects). DB persistence is separated.
 */

import type { FinalitySnapshot, GoalGradientConfig, CoordinationSignal } from "./finalityEvaluator.js";
import { getPool } from "./db.js";
import { logger } from "./logger.js";
import pg from "pg";
import {
  computeDimensionScores as rustComputeDimensionScores,
  computeLyapunovV as rustComputeLyapunovV,
  computePressure as rustComputePressure,
  analyzeConvergence as rustAnalyzeConvergence,
} from "./sgrsAdapter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConvergencePoint {
  epoch: number;
  goal_score: number;
  lyapunov_v: number;
  dimension_scores: Record<string, number>;
  pressure: Record<string, number>;
  created_at: string;
  context_seq?: number | null;
}

export interface ConvergenceState {
  /** Recent history (oldest first). */
  history: ConvergencePoint[];
  /** Convergence rate α (mixed): >0 = converging, <0 = diverging, 0 = stalled. Retained for backward compatibility. */
  convergence_rate: number;
  /** Intra-epoch α: convergence rate computed only between points with the same context_seq. */
  alpha_intra: number;
  /** Number of evidence injection boundaries (context_seq changes) in the history window. */
  cross_epoch_count: number;
  /** Average V(t) delta at evidence injection boundaries (positive = V increased = new contradictions). */
  cross_epoch_v_delta_avg: number;
  /** Dimensions where intra-epoch score has not improved in the last 5 evaluations. */
  stalled_dimensions: string[];
  /** Estimated rounds to reach auto-threshold using alpha_intra. null if not converging or insufficient data. */
  estimated_rounds: number | null;
  /** Goal score has been non-decreasing for β consecutive rounds. */
  is_monotonic: boolean;
  /** MACI progress ratio below threshold for τ consecutive rounds. */
  is_plateaued: boolean;
  /** Number of consecutive plateau rounds. */
  plateau_rounds: number;
  /** Dimension with highest pressure (biggest gap × weight). */
  highest_pressure_dimension: string;
  /** Gate C: coordination signal (agent-to-agent). */
  coordination_signal?: CoordinationSignal | null;
  /** Gate C: oscillation detected (direction changes or negative autocorrelation). */
  oscillation_detected: boolean;
  /** Gate C: trajectory quality 0–1 (1 = monotonic improvement, lower for oscillation/spike-drop). */
  trajectory_quality: number;
  /** Gate C: lag-1 autocorrelation of goal_score (null if insufficient data). */
  autocorrelation_lag1: number | null;
}

export interface ConvergenceConfig {
  /** Monotonicity window: require non-decreasing for this many rounds (default 3). */
  beta: number;
  /** Plateau detection window: consecutive rounds below threshold to declare plateau (default 3). */
  tau: number;
  /** EMA smoothing factor for progress ratio (default 0.3). */
  ema_alpha: number;
  /** Progress ratio below which counts as plateau (default 0.01). */
  plateau_threshold: number;
  /** Number of history points to load from DB (default 20). */
  history_depth: number;
  /** Convergence rate below this triggers divergence alert (default -0.05). */
  divergence_rate: number;
  /** Trajectory quality: penalty per direction change (default 0.12). */
  q_direction_penalty: number;
  /** Trajectory quality: max direction changes before capping (default 5). */
  q_max_directions: number;
  /** Trajectory quality: autocorrelation threshold for oscillation (default -0.3). */
  q_autocorr_threshold: number;
  /** Trajectory quality: cap when oscillation detected (default 0.65). */
  q_oscillation_cap: number;
  /** Trajectory quality: cap on spike-and-drop (default 0.85). */
  q_spike_drop_cap: number;
}

/** Targets for each dimension — the values that constitute "perfect finality". */
export interface FinalityTargets {
  claim_confidence: number;
  contradiction_resolution: number;
  goal_completion: number;
  risk_inverse: number;
}

export const DEFAULT_CONVERGENCE_CONFIG: ConvergenceConfig = {
  beta: 3,
  tau: 3,
  ema_alpha: 0.3,
  plateau_threshold: 0.01,
  history_depth: 20,
  divergence_rate: -0.05,
  q_direction_penalty: 0.12,
  q_max_directions: 5,
  q_autocorr_threshold: -0.3,
  q_oscillation_cap: 0.65,
  q_spike_drop_cap: 0.85,
};

export const DEFAULT_FINALITY_TARGETS: FinalityTargets = {
  claim_confidence: 1.0,   // avg_confidence / 0.85 clamped to 1 → target ratio = 1
  contradiction_resolution: 1.0,  // 0 unresolved / total → ratio = 1
  goal_completion: 1.0,    // 100% goals resolved
  risk_inverse: 1.0,       // 0 risk → 1 - 0 = 1
};

// ---------------------------------------------------------------------------
// Pure functions — no DB, no side effects
// ---------------------------------------------------------------------------

/**
 * Compute dimension scores from a FinalitySnapshot (same formula as computeGoalScore).
 * Returns per-dimension values in [0, 1] where 1 = at target.
 */
export function computeDimensionScores(
  snapshot: FinalitySnapshot,
  config?: GoalGradientConfig,
): Record<string, number> {
  return rustComputeDimensionScores(snapshot, config);
}

/**
 * Lyapunov disagreement function: V = Σ(w_d × (target_d - actual_d)²)
 * V >= 0; V = 0 means all dimensions at target (perfect finality).
 * V decreasing over time guarantees convergence.
 */
export function computeLyapunovV(
  snapshot: FinalitySnapshot,
  targets: FinalityTargets = DEFAULT_FINALITY_TARGETS,
  weights?: GoalGradientConfig["weights"],
): number {
  return rustComputeLyapunovV(snapshot, targets, weights);
}

/**
 * Per-dimension pressure: how far each dimension is from target, weighted.
 * Higher pressure = bigger bottleneck. Used for stigmergic agent routing.
 */
export function computePressure(
  snapshot: FinalitySnapshot,
  weights?: GoalGradientConfig["weights"],
): Record<string, number> {
  return rustComputePressure(snapshot, weights);
}

/**
 * Analyze convergence from history points. Pure function.
 *
 * Input: history sorted oldest-first (ascending epoch).
 */
export function analyzeConvergence(
  history: ConvergencePoint[],
  config: ConvergenceConfig = DEFAULT_CONVERGENCE_CONFIG,
  autoThreshold: number = 0.92,
): ConvergenceState {
  return rustAnalyzeConvergence(history, config, autoThreshold);
}

// ---------------------------------------------------------------------------
// DB persistence
// ---------------------------------------------------------------------------

/** Gate state for experiment recording (Exp 1, Exp 3). */
export interface ConvergenceGateState {
  gate_a_monotonic?: boolean;
  gate_b_evidence?: boolean;
  gate_c_trajectory_ok?: boolean;
  gate_d_quiescent?: boolean;
  gate_e_has_content?: boolean;
  finality_state?: string;
  unresolved_contradictions?: number;
  trajectory_quality?: number;
}

/**
 * Append a convergence point to the history table.
 *
 * When CONVERGENCE_INSTRUMENTATION=1, also logs per-dimension step sizes
 * (|d_i(t) - d_i(t-1)|) to support the Assumption #1 (discretization)
 * experiment. The log line is JSON-structured for post-processing by
 * scripts/analyze-discretization.ts.
 */
export async function recordConvergencePoint(
  scopeId: string,
  epoch: number,
  goalScore: number,
  lyapunovV: number,
  dimensionScores: Record<string, number>,
  pressure: Record<string, number>,
  pool?: pg.Pool,
  contextSeq?: number | null,
): Promise<void> {
  const p = pool ?? getPool();
  await p.query(
    `INSERT INTO convergence_history (scope_id, epoch, goal_score, lyapunov_v, dimension_scores, pressure, context_seq)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [scopeId, epoch, goalScore, lyapunovV, JSON.stringify(dimensionScores), JSON.stringify(pressure), contextSeq ?? null],
  );

  // ── Dimension step instrumentation (Assumption #1: discretization) ──
  // Enabled by default; set CONVERGENCE_INSTRUMENTATION=0 to disable.
  if (process.env.CONVERGENCE_INSTRUMENTATION !== "0") {
    try {
      const prev = await p.query(
        `SELECT dimension_scores, lyapunov_v, epoch FROM convergence_history
         WHERE scope_id = $1 AND id < (SELECT MAX(id) FROM convergence_history WHERE scope_id = $1)
         ORDER BY id DESC LIMIT 1`,
        [scopeId],
      );
      if (prev.rows.length > 0) {
        const prevScores = prev.rows[0].dimension_scores as Record<string, number>;
        const prevV = Number(prev.rows[0].lyapunov_v);
        const deltas: Record<string, number> = {};
        const absDelta: Record<string, number> = {};
        for (const dim of Object.keys(dimensionScores)) {
          const d = dimensionScores[dim] - (prevScores[dim] ?? 0);
          deltas[dim] = d;
          absDelta[dim] = Math.abs(d);
        }
        const vDelta = lyapunovV - prevV;
        logger.info("convergence:step", {
          scope_id: scopeId,
          epoch,
          context_seq: contextSeq ?? null,
          goal_score: goalScore,
          lyapunov_v: lyapunovV,
          v_delta: vDelta,
          dimensions: dimensionScores,
          deltas,
          abs_deltas: absDelta,
          min_nonzero_step: Math.min(
            ...Object.values(absDelta).filter((v) => v > 0),
            Infinity,
          ),
        });
      } else {
        logger.info("convergence:step", {
          scope_id: scopeId,
          epoch,
          context_seq: contextSeq ?? null,
          goal_score: goalScore,
          lyapunov_v: lyapunovV,
          dimensions: dimensionScores,
          note: "first_point",
        });
      }
    } catch {
      // Instrumentation must never break the critical path
    }
  }
}

/**
 * Update the most recent convergence row with gate state (Exp 1, Exp 3).
 * Call after getConvergenceState when gate values are known.
 */
export async function updateConvergenceGateState(
  scopeId: string,
  epoch: number,
  gates: ConvergenceGateState,
  pool?: pg.Pool,
): Promise<void> {
  const p = pool ?? getPool();
  await p.query(
    `UPDATE convergence_history SET
       gate_a_monotonic = COALESCE($3, gate_a_monotonic),
       gate_b_evidence = COALESCE($4, gate_b_evidence),
       gate_c_trajectory_ok = COALESCE($5, gate_c_trajectory_ok),
       gate_d_quiescent = COALESCE($6, gate_d_quiescent),
       gate_e_has_content = COALESCE($7, gate_e_has_content),
       finality_state = COALESCE($8, finality_state),
       unresolved_contradictions = COALESCE($9, unresolved_contradictions),
       trajectory_quality = COALESCE($10, trajectory_quality)
     WHERE scope_id = $1 AND epoch = $2
       AND id = (SELECT id FROM convergence_history WHERE scope_id = $1 AND epoch = $2 ORDER BY created_at DESC LIMIT 1)`,
    [
      scopeId,
      epoch,
      gates.gate_a_monotonic ?? null,
      gates.gate_b_evidence ?? null,
      gates.gate_c_trajectory_ok ?? null,
      gates.gate_d_quiescent ?? null,
      gates.gate_e_has_content ?? null,
      gates.finality_state ?? null,
      gates.unresolved_contradictions ?? null,
      gates.trajectory_quality ?? null,
    ],
  );
}

/**
 * Load recent convergence history for a scope, oldest-first.
 */
export async function loadConvergenceHistory(
  scopeId: string,
  depth: number = 20,
  pool?: pg.Pool,
): Promise<ConvergencePoint[]> {
  const p = pool ?? getPool();
  const res = await p.query(
    `SELECT epoch, goal_score, lyapunov_v, dimension_scores, pressure, created_at, context_seq
     FROM convergence_history
     WHERE scope_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [scopeId, depth],
  );
  // Reverse so oldest is first
  return res.rows.reverse().map((r) => ({
    epoch: Number(r.epoch),
    goal_score: Number(r.goal_score),
    lyapunov_v: Number(r.lyapunov_v),
    dimension_scores: (r.dimension_scores as Record<string, number>) ?? {},
    pressure: (r.pressure as Record<string, number>) ?? {},
    created_at: String(r.created_at),
    context_seq: r.context_seq != null ? Number(r.context_seq) : null,
  }));
}

/**
 * Convenience: load history + analyze. Returns full convergence state.
 */
export async function getConvergenceState(
  scopeId: string,
  config?: Partial<ConvergenceConfig>,
  autoThreshold?: number,
  pool?: pg.Pool,
): Promise<ConvergenceState> {
  const fullConfig: ConvergenceConfig = { ...DEFAULT_CONVERGENCE_CONFIG, ...config };
  const history = await loadConvergenceHistory(scopeId, fullConfig.history_depth, pool);
  return analyzeConvergence(history, fullConfig, autoThreshold ?? 0.92);
}
