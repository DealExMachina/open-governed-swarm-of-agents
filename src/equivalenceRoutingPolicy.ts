/**
 * Generic equivalence routing policy (Couche 0 → HITL).
 *
 * Dimension-aware, schema-driven routing independent of benchmark fixtures.
 * NLI is a safety gate (block contradictions); it does not infer accrual.
 *
 * Optional legacy accrual pre-filter (frozen — do not extend) may override
 * contradiction blocks when EQUIVAL_ACCRUAL_PREFILTER=1.
 */

import type {
  DimensionSchemaMap,
  DimensionSchemaDef,
} from "./baselines/scenario/dimension-schema.js";
import { dimensionValuesEquivalent } from "./baselines/scenario/dimension-schema.js";
import {
  ACCRUAL_HITL_VERDICT,
  classifyAccrualPrefilter,
  type AccrualPrefilterContext,
  type AccrualPrefilterKind,
} from "./accrualPrefilter.js";
import type { NliVerdict } from "./nliGate.js";

function shouldProposeEquivalence(verdict: NliVerdict): boolean {
  return verdict.available && verdict.label !== "contradiction";
}

export type GenericRoutingReason =
  | "canonical_equal_skip"
  | "typed_diff_hitl"
  | "nli_contradiction_block"
  | "nli_equiv_propose"
  | "free_text_hitl"
  | "accrual_prefilter_hitl";

export interface GenericEquivalenceRouting {
  propose: boolean;
  verdict: NliVerdict;
  prefilter?: AccrualPrefilterKind;
  reason: GenericRoutingReason;
  /** When true, caller should not invoke NLI (typed diff → HITL directly). */
  skipNli: boolean;
}

const HITL_VERDICT: NliVerdict = {
  label: "neutral",
  confidence: 0,
  available: true,
};

function schemaFor(
  dimension: string | undefined,
  schemaMap: DimensionSchemaMap | undefined,
): DimensionSchemaDef | undefined {
  if (!dimension?.trim() || !schemaMap) return undefined;
  return schemaMap[dimension];
}

function isTypedDimension(def: DimensionSchemaDef | undefined): boolean {
  return !!def && def.type !== "free_text";
}

export interface GenericRoutingContext extends AccrualPrefilterContext {
  schemaMap?: DimensionSchemaMap;
}

/**
 * Decide routing for an equivalence candidate pair before/after NLI.
 * Call with verdict=null before NLI when skipNli may apply.
 */
export function resolveGenericEquivalenceRouting(
  prior: string,
  next: string,
  verdict: NliVerdict | null,
  ctx?: GenericRoutingContext,
): GenericEquivalenceRouting {
  const dimension = ctx?.dimension?.trim();
  const schemaMap = ctx?.schemaMap;
  const def = schemaFor(dimension, schemaMap);

  if (dimension && schemaMap) {
    if (dimensionValuesEquivalent(dimension, prior, next, schemaMap)) {
      return {
        propose: false,
        verdict: verdict ?? HITL_VERDICT,
        reason: "canonical_equal_skip",
        skipNli: true,
      };
    }
    if (isTypedDimension(def)) {
      return {
        propose: true,
        verdict: HITL_VERDICT,
        reason: "typed_diff_hitl",
        skipNli: true,
      };
    }
  }

  const legacyPrefilter = classifyAccrualPrefilter(prior, next, ctx);
  if (legacyPrefilter) {
    return {
      propose: true,
      verdict: ACCRUAL_HITL_VERDICT,
      prefilter: legacyPrefilter,
      reason: "accrual_prefilter_hitl",
      skipNli: true,
    };
  }

  if (!verdict) {
    return {
      propose: false,
      verdict: { label: "neutral", confidence: 0, available: false },
      reason: "free_text_hitl",
      skipNli: false,
    };
  }

  if (verdict.label === "contradiction") {
    return {
      propose: false,
      verdict,
      reason: "nli_contradiction_block",
      skipNli: false,
    };
  }

  if (shouldProposeEquivalence(verdict)) {
    return {
      propose: true,
      verdict,
      reason:
        verdict.label === "equivalent" ? "nli_equiv_propose" : "free_text_hitl",
      skipNli: false,
    };
  }

  return {
    propose: false,
    verdict,
    reason: "nli_contradiction_block",
    skipNli: false,
  };
}
