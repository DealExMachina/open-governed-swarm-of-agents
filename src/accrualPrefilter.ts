/**
 * Accrual pre-filter for the NLI equivalence gate (runtime Couche 3).
 *
 * FROZEN — optional legacy net only. Do not extend with new heuristics.
 * Generic routing lives in equivalenceRoutingPolicy.ts (Couche 0 → HITL).
 *
 * Enable explicitly: EQUIVAL_ACCRUAL_PREFILTER=1
 *
 * Cross-encoders often label strict token-superset pairs as `contradiction`.
 * When enabled, token-superset accrual routes to HITL before NLI.
 *
 * Pure module — no I/O.
 */

import type { NliVerdict } from "./nliGate.js";

export type AccrualPrefilterKind = "accrual";

/** Synthetic verdict: forces governance review, never auto-merge. */
export const ACCRUAL_HITL_VERDICT: NliVerdict = {
  label: "neutral",
  confidence: 0,
  available: true,
};

export interface AccrualPrefilterContext {
  dimension?: string;
}

function tokenSet(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
}

function isTokenSubset(sub: Set<string>, sup: Set<string>): boolean {
  for (const t of sub) if (!sup.has(t)) return false;
  return true;
}

/**
 * True when `next` extends `prior` with additional detail (token superset, strictly
 * larger). These pairs must not be treated as NLI contradictions.
 */
export function detectContentAccrual(prior: string, next: string): boolean {
  if (!prior?.trim() || !next?.trim()) return false;
  const priorTokens = tokenSet(prior);
  const nextTokens = tokenSet(next);
  return (
    isTokenSubset(priorTokens, nextTokens) && nextTokens.size > priorTokens.size
  );
}

export function accrualPrefilterEnabled(): boolean {
  const v = process.env.EQUIVAL_ACCRUAL_PREFILTER?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Classify accrual when explicitly enabled; otherwise null. Token-superset only. */
export function classifyAccrualPrefilter(
  prior: string,
  next: string,
  _ctx?: AccrualPrefilterContext,
): AccrualPrefilterKind | null {
  if (!accrualPrefilterEnabled()) return null;
  return detectContentAccrual(prior, next) ? "accrual" : null;
}
