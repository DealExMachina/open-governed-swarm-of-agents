import { describe, it, expect, beforeEach } from "vitest";
import {
  recordProposal,
  recordPolicyViolation,
  recordAgentLatency,
  recordAgentError,
  recordGovernanceLoopMs,
  recordPressureDirectedActivation,
  recordSemanticGraphQueryMs,
  recordSgrsCall,
  _resetSwarmMetrics,
} from "../../src/metrics.js";
import { initTelemetry } from "../../src/telemetry.js";

describe("metrics", () => {
  beforeEach(() => {
    process.env.OTEL_SDK_DISABLED = "true";
    initTelemetry();
    _resetSwarmMetrics();
  });

  it("recordProposal does not throw", () => {
    expect(() => recordProposal("advance_state", "approved")).not.toThrow();
    expect(() => recordProposal("advance_state", "rejected")).not.toThrow();
    expect(() => recordProposal("advance_state", "pending")).not.toThrow();
  });

  it("recordPolicyViolation does not throw", () => {
    expect(() => recordPolicyViolation()).not.toThrow();
  });

  it("recordAgentLatency does not throw", () => {
    expect(() => recordAgentLatency("facts", 100)).not.toThrow();
    expect(() => recordAgentLatency("governance", 50)).not.toThrow();
  });

  it("recordAgentError does not throw", () => {
    expect(() => recordAgentError("facts")).not.toThrow();
  });

  it("recordGovernanceLoopMs does not throw", () => {
    expect(() => recordGovernanceLoopMs(150)).not.toThrow();
  });

  it("recordPressureDirectedActivation does not throw", () => {
    expect(() => recordPressureDirectedActivation("facts", true, "claim_confidence")).not.toThrow();
    expect(() => recordPressureDirectedActivation("drift", false, "unknown")).not.toThrow();
  });

  it("recordSemanticGraphQueryMs does not throw", () => {
    expect(() => recordSemanticGraphQueryMs("loadFinalitySnapshot", 42)).not.toThrow();
  });

  it("recordSgrsCall does not throw", () => {
    expect(() => recordSgrsCall("analyze_convergence", 2.5)).not.toThrow();
    expect(() => recordSgrsCall("kernel", 0.1)).not.toThrow();
  });
});
