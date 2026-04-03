/**
 * Swarm observability metrics via OpenTelemetry.
 * Requires initTelemetry() to have been called (NodeSDK sets global meter provider from env).
 */
import { getMeter } from "./telemetry.js";
import type { ConvergenceState } from "./convergenceTracker.js";
import type { PropagationMetrics } from "./evidenceStateManager.js";

type OtelCounter = ReturnType<ReturnType<typeof getMeter>["createCounter"]>;
type OtelHistogram = ReturnType<ReturnType<typeof getMeter>["createHistogram"]>;
type OtelGauge = ReturnType<ReturnType<typeof getMeter>["createGauge"]>;

// --- Core swarm process metrics ---
let proposalCount: OtelCounter | null = null;
let policyViolationCount: OtelCounter | null = null;
let agentLatencyHistogram: OtelHistogram | null = null;
let agentErrorCount: OtelCounter | null = null;
let governanceLoopHistogram: OtelHistogram | null = null;
let llmTokensCounter: OtelCounter | null = null;
let llmCallsCounter: OtelCounter | null = null;
let governanceModeGauge: OtelGauge | null = null;
let governancePathCounter: OtelCounter | null = null;
let stateTransitionCounter: OtelCounter | null = null;
let semanticGraphQueryHistogram: OtelHistogram | null = null;
let pressureDirectedCounter: OtelCounter | null = null;
let sgrsCallHistogram: OtelHistogram | null = null;

// Convergence and propagation gauges
let convergenceGoalScore: OtelGauge | null = null;
let convergenceLyapunovV: OtelGauge | null = null;
let convergenceRate: OtelGauge | null = null;
let convergenceTrajectoryQuality: OtelGauge | null = null;
let convergenceEpoch: OtelGauge | null = null;
let convergenceEstimatedRounds: OtelGauge | null = null;
let propagationContractionRatio: OtelGauge | null = null;
let propagationDisagreementAfter: OtelGauge | null = null;
let propagationPerturbationNorm: OtelGauge | null = null;
let e17EpsilonL2: OtelGauge | null = null;
let e17EpsilonLinf: OtelGauge | null = null;
let propagationStepsTotal: OtelCounter | null = null;
let progressActivationsTotal: OtelCounter | null = null;

function ensureInstruments() {
  const meter = getMeter();
  if (proposalCount == null) {
    proposalCount = meter.createCounter("swarm.proposal.count", {
      description: "Proposals by type and result",
      unit: "1",
    });
  }
  if (policyViolationCount == null) {
    policyViolationCount = meter.createCounter("swarm.policy.violation_count", {
      description: "Proposals rejected due to policy",
      unit: "1",
    });
  }
  if (agentLatencyHistogram == null) {
    agentLatencyHistogram = meter.createHistogram("swarm.agent.latency_ms", {
      description: "Agent run latency in milliseconds",
      unit: "ms",
    });
  }
  if (agentErrorCount == null) {
    agentErrorCount = meter.createCounter("swarm.agent.error_count", {
      description: "Agent errors by role",
      unit: "1",
    });
  }
  if (governanceLoopHistogram == null) {
    governanceLoopHistogram = meter.createHistogram("swarm.governance.loop_ms", {
      description: "Governance proposal handling latency",
      unit: "ms",
    });
  }
  if (llmTokensCounter == null) {
    llmTokensCounter = meter.createCounter("swarm.llm.tokens", {
      description: "LLM token consumption by role and direction",
      unit: "1",
    });
  }
  if (llmCallsCounter == null) {
    llmCallsCounter = meter.createCounter("swarm.llm.calls", {
      description: "Number of LLM invocations by role and model",
      unit: "1",
    });
  }
  if (governanceModeGauge == null) {
    governanceModeGauge = meter.createGauge("swarm.governance.mode_active", {
      description: "Active governance mode per scope (1 = active); labels: scope_id, mode",
      unit: "1",
    });
  }
  if (governancePathCounter == null) {
    governancePathCounter = meter.createCounter("swarm.governance.path", {
      description: "Governance decision path distribution",
      unit: "1",
    });
  }
  if (stateTransitionCounter == null) {
    stateTransitionCounter = meter.createCounter("swarm.state.transition", {
      description: "State graph transitions by from/to node",
      unit: "1",
    });
  }
  if (semanticGraphQueryHistogram == null) {
    semanticGraphQueryHistogram = meter.createHistogram("swarm.semantic_graph.query_ms", {
      description: "Semantic graph query latency in milliseconds",
      unit: "ms",
    });
  }
  if (pressureDirectedCounter == null) {
    pressureDirectedCounter = meter.createCounter("swarm.pressure_directed.activation", {
      description: "Pressure-directed activation filter evaluations by role, hit, and highest dimension",
      unit: "1",
    });
  }
  if (sgrsCallHistogram == null) {
    sgrsCallHistogram = meter.createHistogram("swarm.sgrs.call_ms", {
      description: "sgrs-core (Rust native) call latency in milliseconds, by operation",
      unit: "ms",
    });
  }
  if (convergenceGoalScore == null) {
    convergenceGoalScore = meter.createGauge("swarm.convergence.goal_score", {
      description: "Current goal score (0-1) toward finality",
      unit: "1",
    });
  }
  if (convergenceLyapunovV == null) {
    convergenceLyapunovV = meter.createGauge("swarm.convergence.lyapunov_v", {
      description: "Lyapunov disagreement function V(t)",
      unit: "1",
    });
  }
  if (convergenceRate == null) {
    convergenceRate = meter.createGauge("swarm.convergence.rate", {
      description: "Convergence rate alpha (>0 converging, <0 diverging)",
      unit: "1",
    });
  }
  if (convergenceTrajectoryQuality == null) {
    convergenceTrajectoryQuality = meter.createGauge("swarm.convergence.trajectory_quality", {
      description: "Trajectory quality 0-1 (1 = monotonic improvement)",
      unit: "1",
    });
  }
  if (convergenceEpoch == null) {
    convergenceEpoch = meter.createGauge("swarm.convergence.epoch", {
      description: "Latest convergence epoch",
      unit: "1",
    });
  }
  if (convergenceEstimatedRounds == null) {
    convergenceEstimatedRounds = meter.createGauge("swarm.convergence.estimated_rounds", {
      description: "Estimated rounds to reach auto-finality threshold",
      unit: "1",
    });
  }
  if (propagationContractionRatio == null) {
    propagationContractionRatio = meter.createGauge("swarm.propagation.contraction_ratio", {
      description: "Evidence propagation contraction ratio (after/before disagreement)",
      unit: "1",
    });
  }
  if (propagationDisagreementAfter == null) {
    propagationDisagreementAfter = meter.createGauge("swarm.propagation.disagreement_after", {
      description: "Disagreement after propagation step",
      unit: "1",
    });
  }
  if (propagationPerturbationNorm == null) {
    propagationPerturbationNorm = meter.createGauge("swarm.propagation.perturbation_norm", {
      description: "ISS perturbation norm for sheaf propagation stability",
      unit: "1",
    });
  }
  if (propagationStepsTotal == null) {
    propagationStepsTotal = meter.createCounter("swarm.propagation.steps_total", {
      description: "Total evidence propagation steps",
      unit: "1",
    });
  }
  if (e17EpsilonL2 == null) {
    e17EpsilonL2 = meter.createGauge("swarm.e17.epsilon_l2", {
      description: "E17 profiling perturbation L2 norm",
      unit: "1",
    });
  }
  if (e17EpsilonLinf == null) {
    e17EpsilonLinf = meter.createGauge("swarm.e17.epsilon_linf", {
      description: "E17 profiling perturbation Linf norm",
      unit: "1",
    });
  }
  if (progressActivationsTotal == null) {
    progressActivationsTotal = meter.createCounter("swarm.progress.activations_total", {
      description: "Agent activations by role and productive/wasted",
      unit: "1",
    });
  }
}

/** Record pressure-directed activation filter outcome for Exp 1, Exp 4. */
export function recordPressureDirectedActivation(
  role: string,
  hit: boolean,
  highestPressureDimension: string,
): void {
  try {
    ensureInstruments();
    pressureDirectedCounter?.add(1, {
      role,
      hit: String(hit),
      highest_pressure_dimension: highestPressureDimension,
    });
  } catch {
    // no-op
  }
}

/** Record semantic graph query latency for Exp 2. */
export function recordSemanticGraphQueryMs(queryType: string, ms: number): void {
  try {
    ensureInstruments();
    semanticGraphQueryHistogram?.record(ms, { query_type: queryType });
  } catch {
    // no-op
  }
}

/** Record LLM token usage by role, direction (input/output), and model. */
export function recordLLMTokens(role: string, direction: "input" | "output", count: number, model?: string): void {
  try {
    ensureInstruments();
    llmTokensCounter?.add(count, { role, direction, model: model ?? "default" });
  } catch {
    // no-op
  }
}

/** Record a single LLM invocation (call count, not tokens). */
export function recordLLMCall(role: string, model?: string): void {
  try {
    ensureInstruments();
    llmCallsCounter?.add(1, { role, model: model ?? "default" });
  } catch {
    // no-op
  }
}

/**
 * Record the active governance mode for a scope.
 * Emits 1 for the active mode, 0 for inactive modes, so Grafana can show
 * the current mode via label filtering.
 */
export function recordGovernanceMode(scopeId: string, mode: "YOLO" | "MITL" | "MASTER"): void {
  try {
    ensureInstruments();
    for (const m of ["YOLO", "MITL", "MASTER"] as const) {
      governanceModeGauge?.record(m === mode ? 1 : 0, { scope_id: scopeId, mode: m });
    }
  } catch {
    // no-op
  }
}

/** Record which governance decision path was taken. */
export function recordGovernancePath(path: string): void {
  try {
    ensureInstruments();
    governancePathCounter?.add(1, { path });
  } catch {
    // no-op
  }
}

/** Record a state graph transition. */
export function recordStateTransition(from: string, to: string): void {
  try {
    ensureInstruments();
    stateTransitionCounter?.add(1, { from_state: from, to_state: to });
  } catch {
    // no-op
  }
}

export function recordProposal(type: string, result: "approved" | "rejected" | "pending"): void {
  try {
    ensureInstruments();
    proposalCount?.add(1, { type, result });
  } catch {
    // no-op if meter provider not set
  }
}

export function recordPolicyViolation(): void {
  try {
    ensureInstruments();
    policyViolationCount?.add(1);
  } catch {
    // no-op
  }
}

export function recordAgentLatency(role: string, latencyMs: number): void {
  try {
    ensureInstruments();
    agentLatencyHistogram?.record(latencyMs, { role });
  } catch {
    // no-op
  }
}

export function recordAgentError(role: string): void {
  try {
    ensureInstruments();
    agentErrorCount?.add(1, { role });
  } catch {
    // no-op
  }
}

export function recordGovernanceLoopMs(latencyMs: number): void {
  try {
    ensureInstruments();
    governanceLoopHistogram?.record(latencyMs);
  } catch {
    // no-op
  }
}

/** Record sgrs-core (Rust native addon) call latency for scalability observability. */
export function recordSgrsCall(operation: string, durationMs: number): void {
  try {
    ensureInstruments();
    sgrsCallHistogram?.record(durationMs, { operation });
  } catch {
    // no-op
  }
}

/** Record convergence state for demo telemetry (goal score, Lyapunov V, rate, trajectory quality). */
export function recordConvergenceStateMetrics(scopeId: string, state: ConvergenceState): void {
  try {
    ensureInstruments();
    const attrs = { scope_id: scopeId };
    const last = state.history[state.history.length - 1];
    if (last) {
      convergenceGoalScore?.record(last.goal_score, attrs);
      convergenceLyapunovV?.record(last.lyapunov_v, attrs);
      convergenceEpoch?.record(last.epoch, attrs);
    }
    convergenceRate?.record(state.convergence_rate, attrs);
    convergenceTrajectoryQuality?.record(state.trajectory_quality, attrs);
    const estRounds = state.estimated_rounds ?? -1;
    convergenceEstimatedRounds?.record(estRounds >= 0 ? estRounds : 0, attrs);
  } catch {
    // no-op
  }
}

/** Record propagation step metrics for evidence propagation telemetry. */
export function recordPropagationMetrics(scopeId: string, metrics: PropagationMetrics): void {
  try {
    ensureInstruments();
    const attrs = { scope_id: scopeId };
    propagationContractionRatio?.record(metrics.contraction_ratio, attrs);
    propagationDisagreementAfter?.record(metrics.disagreement_after, attrs);
    propagationPerturbationNorm?.record(metrics.perturbation_norm, attrs);
    propagationStepsTotal?.add(1, attrs);
  } catch {
    // no-op
  }
}

export function recordE17ProfileMetrics(
  scopeId: string,
  sample: {
    epsilon_l2: number;
    epsilon_linf: number;
    model_provider?: string;
    model_family?: string;
  },
): void {
  try {
    ensureInstruments();
    const attrs = {
      scope_id: scopeId,
      model_provider: sample.model_provider ?? "unknown",
      model_family: sample.model_family ?? "unknown",
    };
    e17EpsilonL2?.record(sample.epsilon_l2, attrs);
    e17EpsilonLinf?.record(sample.epsilon_linf, attrs);
  } catch {
    // no-op
  }
}

/** Record agent activation for progress telemetry (productive vs wasted). */
export function recordProgressMetrics(role: string, productive: boolean): void {
  try {
    ensureInstruments();
    progressActivationsTotal?.add(1, { role, productive: String(productive) });
  } catch {
    // no-op
  }
}

/** Reset instruments (for tests). */
export function _resetSwarmMetrics(): void {
  proposalCount = null;
  policyViolationCount = null;
  agentLatencyHistogram = null;
  agentErrorCount = null;
  governanceLoopHistogram = null;
  llmTokensCounter = null;
  llmCallsCounter = null;
  governanceModeGauge = null;
  governancePathCounter = null;
  stateTransitionCounter = null;
  semanticGraphQueryHistogram = null;
  pressureDirectedCounter = null;
  sgrsCallHistogram = null;
  convergenceGoalScore = null;
  convergenceLyapunovV = null;
  convergenceRate = null;
  convergenceTrajectoryQuality = null;
  convergenceEpoch = null;
  convergenceEstimatedRounds = null;
  propagationContractionRatio = null;
  propagationDisagreementAfter = null;
  propagationPerturbationNorm = null;
  e17EpsilonL2 = null;
  e17EpsilonLinf = null;
  propagationStepsTotal = null;
  progressActivationsTotal = null;
}
