/**
 * Swarm observability metrics via OpenTelemetry.
 * Requires initTelemetry() to have been called (NodeSDK sets global meter provider from env).
 */
import { getMeter } from "./telemetry.js";

let proposalCount: ReturnType<ReturnType<typeof getMeter>["createCounter"]> | null = null;
let policyViolationCount: ReturnType<ReturnType<typeof getMeter>["createCounter"]> | null = null;
let agentLatencyHistogram: ReturnType<ReturnType<typeof getMeter>["createHistogram"]> | null = null;
let agentErrorCount: ReturnType<ReturnType<typeof getMeter>["createCounter"]> | null = null;
let governanceLoopHistogram: ReturnType<ReturnType<typeof getMeter>["createHistogram"]> | null = null;
let llmTokensCounter: ReturnType<ReturnType<typeof getMeter>["createCounter"]> | null = null;
let semanticGraphQueryHistogram: ReturnType<ReturnType<typeof getMeter>["createHistogram"]> | null = null;
let pressureDirectedCounter: ReturnType<ReturnType<typeof getMeter>["createCounter"]> | null = null;
let sgrsCallHistogram: ReturnType<ReturnType<typeof getMeter>["createHistogram"]> | null = null;

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

/** Record LLM token usage for Exp 2, Exp 4. */
export function recordLLMTokens(role: string, direction: "input" | "output", count: number, model?: string): void {
  try {
    ensureInstruments();
    llmTokensCounter?.add(count, { role, direction, model: model ?? "default" });
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

/** Reset instruments (for tests). */
export function _resetSwarmMetrics(): void {
  proposalCount = null;
  policyViolationCount = null;
  agentLatencyHistogram = null;
  agentErrorCount = null;
  governanceLoopHistogram = null;
  llmTokensCounter = null;
  semanticGraphQueryHistogram = null;
  pressureDirectedCounter = null;
  sgrsCallHistogram = null;
}
