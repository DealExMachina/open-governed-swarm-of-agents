/**
 * Equivalence gate: turn an NLI entailment verdict into a *governed proposition*.
 *
 * When ingestion finds a new claim that differs lexically from an existing node
 * (the "value is different" trigger), the runtime NLI gate (see nliGate.ts)
 * classifies the pair. Rather than silently merging, we submit the assertion
 * "A ≡ B" as an `assert_equivalence` proposal to the governance bus. Governance
 * validates it deterministically (this module) and the approved decision is
 * traced in the semantic graph (see equivalenceTrace.ts).
 *
 * Pure module: no DB, no bus, no network — safe to unit-test in isolation.
 */

import { randomUUID } from "crypto";
import type { Proposal } from "./events.js";
import type { DecisionRecord, Obligation } from "./policyEngine.js";
import type { NliLabel, NliVerdict } from "./nliGate.js";
import type { DimensionSchemaMap } from "./baselines/scenario/dimension-schema.js";
import { resolveGenericEquivalenceRouting } from "./equivalenceRoutingPolicy.js";

export const EQUIVALENCE_ACTION = "assert_equivalence";

export type EquivalenceNodeType = "claim" | "goal" | "risk";

/** A lexically-different pair discovered during ingestion (value differs). */
export interface EquivalenceCandidate {
  node_type: EquivalenceNodeType;
  /** Existing graph node that the new content fuzzy-matched. */
  existing_node_id: string;
  /** Content already stored on the existing node. */
  existing_content: string;
  /** Newly extracted content that differs from existing_content. */
  new_content: string;
  /** Benchmark / structured-extraction dimension when known (enables classifyReversion pre-filter). */
  dimension?: string;
}

/** Payload carried on an `assert_equivalence` proposal / action. */
export interface EquivalencePayload extends Record<string, unknown> {
  scope_id: string;
  node_type: EquivalenceNodeType;
  existing_node_id: string;
  /** existing_content (premise). */
  a: string;
  /** new_content (hypothesis). */
  b: string;
  nli_label: NliLabel;
  nli_confidence: number;
  /** Dimension key when structured extraction provided one. */
  dimension?: string;
  /** Set when accrual pre-filter routed the pair to HITL instead of NLI contradiction. */
  prefilter?: AccrualPrefilterKind;
}

export interface EquivalenceDecisionResult {
  outcome: "approve" | "reject";
  result: "allow" | "deny";
  reason: string;
}

export interface DecideEquivalenceOptions {
  /** Minimum NLI confidence to auto-approve an equivalence. Default env EQUIV_MIN_CONFIDENCE or 0.7. */
  minConfidence?: number;
}

function resolveMinConfidence(explicit?: number): number {
  if (typeof explicit === "number") return explicit;
  const env = Number(process.env.EQUIV_MIN_CONFIDENCE);
  return Number.isFinite(env) && env > 0 ? env : 0.7;
}

/**
 * True when a candidate/verdict is worth submitting to governance.
 * Contradictions are surfaced through the dedicated contradiction channel
 * (facts-worker NLI), so we don't double-trace them here. Unavailable verdicts
 * (worker down / NLI off) are skipped so we never govern an unverified guess.
 */
export function shouldProposeEquivalence(verdict: NliVerdict): boolean {
  return verdict.available && verdict.label !== "contradiction";
}

export interface EquivalenceRouting {
  propose: boolean;
  verdict: NliVerdict;
  prefilter?: AccrualPrefilterKind;
}

/**
 * Decide whether to emit an `assert_equivalence` proposal for a candidate pair.
 * Accrual pre-filter takes priority over NLI contradiction (routes to HITL).
 */
export function resolveEquivalenceRouting(
  prior: string,
  next: string,
  verdict: NliVerdict,
  ctx?: AccrualPrefilterContext & { schemaMap?: DimensionSchemaMap },
): EquivalenceRouting {
  const routing = resolveGenericEquivalenceRouting(prior, next, verdict, ctx);
  return {
    propose: routing.propose,
    verdict: routing.verdict,
    prefilter: routing.prefilter,
  };
}

/** Deterministic governance validation of an equivalence proposition. */
export function decideEquivalence(
  payload: EquivalencePayload,
  options: DecideEquivalenceOptions = {},
): EquivalenceDecisionResult {
  const min = resolveMinConfidence(options.minConfidence);
  const conf = payload.nli_confidence.toFixed(2);
  if (payload.nli_label === "equivalent" && payload.nli_confidence >= min) {
    return { outcome: "approve", result: "allow", reason: `nli_equivalent:${conf}` };
  }
  if (payload.prefilter === "accrual") {
    return { outcome: "reject", result: "deny", reason: "accrual_prefilter:hitl" };
  }
  const reason =
    payload.nli_label === "equivalent"
      ? `nli_equivalent_low_confidence:${conf}`
      : `nli_${payload.nli_label}:${conf}`;
  return { outcome: "reject", result: "deny", reason };
}

/** Build an immutable DecisionRecord for an equivalence decision. */
export function buildEquivalenceDecisionRecord(
  decision: EquivalenceDecisionResult,
  policyVersion: string,
): DecisionRecord {
  const obligations: Obligation[] =
    decision.outcome === "approve" ? [{ type: "record_equivalence_edge" }] : [];
  return {
    decision_id: randomUUID(),
    timestamp: new Date().toISOString(),
    policy_version: policyVersion,
    result: decision.result,
    reason: decision.reason,
    obligations,
    binding: "nli-gate",
    suggested_actions: [],
  };
}

/** Build an `assert_equivalence` proposal from a candidate + NLI verdict. */
export function buildEquivalenceProposal(
  candidate: EquivalenceCandidate,
  verdict: NliVerdict,
  opts: { scopeId: string; agent: string; mode: Proposal["mode"] },
  extras?: { prefilter?: AccrualPrefilterKind },
): Proposal {
  const payload: EquivalencePayload = {
    scope_id: opts.scopeId,
    node_type: candidate.node_type,
    existing_node_id: candidate.existing_node_id,
    a: candidate.existing_content,
    b: candidate.new_content,
    nli_label: verdict.label,
    nli_confidence: verdict.confidence,
    ...(candidate.dimension ? { dimension: candidate.dimension } : {}),
    ...(extras?.prefilter ? { prefilter: extras.prefilter } : {}),
  };
  return {
    proposal_id: randomUUID(),
    agent: opts.agent,
    proposed_action: EQUIVALENCE_ACTION,
    target_node: candidate.existing_node_id,
    payload,
    mode: opts.mode,
  };
}
