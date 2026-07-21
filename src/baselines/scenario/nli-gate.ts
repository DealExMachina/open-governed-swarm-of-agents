/**
 * Scenario-local NLI gate wrappers (Couche 3) for dimension-schema async equivalence.
 *
 * Thin adapters over the production nliEntailment gate so benchmark code can resolve
 * embedding gray zones and standalone NLI checks without importing feed/runtime wiring.
 */

import { nliEntailment, type NliVerdict } from "../../nliGate.js";

export interface ScenarioNliGateOptions {
  enabled?: boolean;
  workerUrl?: string;
  timeoutMs?: number;
}

const DISABLED: NliVerdict = {
  label: "neutral",
  confidence: 0,
  available: false,
};

/**
 * Bidirectional NLI equivalence check between two claim strings.
 */
export async function nliGateEquivalent(
  a: string,
  b: string,
  options: ScenarioNliGateOptions = {},
): Promise<NliVerdict> {
  if (!options.enabled) return DISABLED;
  return nliEntailment(a, b, {
    workerUrl: options.workerUrl,
    timeoutMs: options.timeoutMs,
  });
}

/**
 * Resolve embedding gray-zone scores: below `lowThreshold` → not equivalent;
 * at/above `highThreshold` should be handled by the caller; in between → NLI decides.
 */
export async function resolveAmbiguousEquivalence(
  a: string,
  b: string,
  embeddingScore: number,
  lowThreshold: number,
  highThreshold: number,
  options: ScenarioNliGateOptions = {},
): Promise<boolean> {
  if (embeddingScore >= highThreshold) return true;
  if (embeddingScore < lowThreshold) return false;
  if (!options.enabled) return false;

  const verdict = await nliGateEquivalent(a, b, options);
  if (!verdict.available) return false;
  if (verdict.label === "contradiction") return false;
  return verdict.label === "equivalent";
}
