/**
 * Shared helpers for governance: build audit records from sgrs kernel output
 * and map verdict to outcome. Used by governanceAgent (evaluateProposalDeterministic,
 * processProposal, and LLM tools) to avoid duplication and keep audit fields consistent.
 */

import { randomUUID } from "crypto";
import type { DecisionRecord, Obligation } from "./policyEngine.js";
import type { KernelOutput } from "./sgrsAdapter.js";

/** Options when building a decision record from kernel output. */
export interface BuildRecordOptions {
  /**
   * When true (YOLO override path), promote suggested_actions to obligations
   * so the oversight agent or downstream can see them.
   */
  promoteSuggestedToObligations?: boolean;
}

/**
 * Build an immutable DecisionRecord from sgrs kernel output.
 * Caller is responsible for persisting and executing obligations.
 */
export function buildDecisionRecordFromKernel(
  kernelOutput: KernelOutput,
  policyVersion: string,
  options: BuildRecordOptions = {},
): DecisionRecord {
  const { promoteSuggestedToObligations = false } = options;
  const isYoloOverride = kernelOutput.reason.startsWith("yolo_override:");
  const promote = promoteSuggestedToObligations || isYoloOverride;
  const obligations: Obligation[] = promote
    ? kernelOutput.suggested_actions.map((a: string) => ({ type: a }))
    : [];

  return {
    decision_id: randomUUID(),
    timestamp: new Date().toISOString(),
    policy_version: policyVersion,
    result: kernelOutput.verdict === "reject" ? "deny" : "allow",
    reason: kernelOutput.reason,
    obligations,
    binding: "sgrs",
    suggested_actions: kernelOutput.suggested_actions,
  };
}
