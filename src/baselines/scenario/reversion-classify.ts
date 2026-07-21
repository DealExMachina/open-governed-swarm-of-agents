/**
 * Phase 0 instrumentation: classify a detected cross-epoch value change into
 * signal vs noise, so M3 "excess" can be decomposed before any mitigation is
 * measured. See docs/benchmarks/architecture-decision-idempotent-extraction.md.
 *
 * INSTRUMENTATION ONLY — not a runtime equivalence gate. Production routing uses
 * equivalenceRoutingPolicy.ts (generic HITL policy).
 *
 * Classes:
 *  - "new":        no prior value (first write for the dimension) — not a change.
 *  - "paraphrase": semantically equivalent to prior (canonical/typed or free-text
 *                  fallback) — NOISE (should not count as a reversion).
 *  - "accrual":    genuinely new/more-specific information that extends the prior
 *                  without contradicting it — SIGNAL (legitimate growth).
 *  - "reversion":  a contradictory / genuinely different value — SIGNAL (true M3).
 */

import {
  canonicalise,
  dimensionValuesEquivalent,
  type DimensionSchemaDef,
  type DimensionSchemaMap,
} from "./dimension-schema.js";

export type ReversionClass = "new" | "paraphrase" | "accrual" | "reversion";

export interface ReversionClassification {
  dimension: string;
  class: ReversionClass;
  /** Short human-readable reason for auditability. */
  reason: string;
}

/** Alphanumeric token set of a normalised string (for free-text superset test). */
function tokenSet(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
}

/** True when every token of `sub` is present in `sup`. */
function isTokenSubset(sub: Set<string>, sup: Set<string>): boolean {
  for (const t of sub) if (!sup.has(t)) return false;
  return true;
}

/**
 * Classify the transition prior -> next for a dimension.
 *
 * Typed dimensions (currency/percentage/range/count) that both parse to their
 * type and differ beyond tolerance are always "reversion" (numeric change).
 * Free-text transitions use token-superset logic to separate accrual (added
 * detail) from reversion (genuinely different text).
 */
export function classifyReversion(
  dimension: string,
  priorContent: string | undefined,
  nextContent: string,
  schemaMap: DimensionSchemaMap,
): ReversionClassification {
  if (priorContent === undefined || priorContent.trim() === "") {
    return { dimension, class: "new", reason: "no prior value" };
  }

  if (dimensionValuesEquivalent(dimension, priorContent, nextContent, schemaMap)) {
    return { dimension, class: "paraphrase", reason: "semantically equivalent to prior" };
  }

  const schema: DimensionSchemaDef = schemaMap[dimension] ?? { type: "free_text" };
  const oldC = canonicalise(priorContent, schema);
  const newC = canonicalise(nextContent, schema);

  // Both sides parsed to the same typed (non free_text) form but are not
  // equivalent -> a real numeric/categorical change (instrumentation: reversion).
  if (oldC.type !== "free_text" && newC.type !== "free_text") {
    return { dimension, class: "reversion", reason: `typed ${oldC.type} value changed` };
  }

  // Free-text path: does the new value add to the prior (accrual) or replace it?
  const priorTokens = tokenSet(priorContent);
  const nextTokens = tokenSet(nextContent);
  if (isTokenSubset(priorTokens, nextTokens) && nextTokens.size > priorTokens.size) {
    return { dimension, class: "accrual", reason: "new value extends prior (superset)" };
  }
  if (isTokenSubset(nextTokens, priorTokens)) {
    return { dimension, class: "paraphrase", reason: "new value is a terser restatement (subset)" };
  }
  return { dimension, class: "reversion", reason: "free-text value genuinely differs" };
}

export interface ReversionTally {
  new: number;
  paraphrase: number;
  accrual: number;
  reversion: number;
}

/** Aggregate classifications into counts (paraphrase = noise; reversion+accrual = signal). */
export function tallyReversions(classes: ReversionClassification[]): ReversionTally {
  const tally: ReversionTally = { new: 0, paraphrase: 0, accrual: 0, reversion: 0 };
  for (const c of classes) tally[c.class] += 1;
  return tally;
}
