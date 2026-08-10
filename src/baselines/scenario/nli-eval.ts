/**
 * NLI gold-set evaluation — quantifies runtime value of the cross-encoder gate.
 *
 * Loads labeled claim pairs (test/fixtures/nli-gold-set.yaml), runs each through
 * the production pipeline (nliEntailment → shouldProposeEquivalence →
 * decideEquivalence) and reports precision/recall per category.
 *
 * Categories map to governance outcomes:
 *   paraphrase          → auto_merge
 *   false_positive_trap → no_merge
 *   contradiction       → block_contradiction
 *   refutation          → block_refutation
 *   ambiguous_hitl      → hitl
 */

import { readFileSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import type { NliVerdict } from "../../nliGate.js";
import {
  decideEquivalence,
  shouldProposeEquivalence,
  type EquivalencePayload,
} from "../../equivalenceGate.js";
import { loadDimensionSchemaMap } from "../../dimensionSchemaRegistry.js";
import { resolveGenericEquivalenceRouting } from "../../equivalenceRoutingPolicy.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GoldCategory =
  | "paraphrase"
  | "false_positive_trap"
  | "contradiction"
  | "refutation"
  | "ambiguous_hitl";

/** Expected governance routing for a gold pair. */
export type ExpectedAction =
  | "auto_merge"
  | "no_merge"
  | "block_contradiction"
  | "block_refutation"
  | "hitl";

export type HitlSubtype = "accrual" | "refinement" | "neutral_only";

export interface NliGoldPair {
  id: string;
  scenario: string;
  dimension: string;
  category: GoldCategory;
  prior: string;
  next: string;
  notes?: string;
  /** For ambiguous_hitl: accrual/refinement must NOT be classified as contradiction. */
  hitlSubtype?: HitlSubtype;
}

export interface NliGoldSet {
  schemaVersion: string;
  minConfidenceDefault: number;
  pairs: NliGoldPair[];
}

/** Resolved action from the full NLI + governance pipeline. */
export type ResolvedAction =
  | "auto_merge"
  | "no_merge"
  | "block_contradiction"
  | "hitl"
  | "unavailable";

export interface PairEvalResult {
  id: string;
  scenario: string;
  dimension: string;
  category: GoldCategory;
  hitlSubtype?: HitlSubtype;
  expected: ExpectedAction;
  resolved: ResolvedAction;
  correct: boolean;
  nli: NliVerdict;
  governanceReason?: string;
}

export interface CategoryMetrics {
  category: GoldCategory;
  count: number;
  correct: number;
  accuracy: number;
}

export interface NliEvalReport {
  total: number;
  correct: number;
  accuracy: number;
  /** Auto-merge proposed when category forbids it (FP + contradiction + refutation + hitl). */
  falseMergeRate: number;
  /** Auto-merge missed when paraphrase expected. */
  missedMergeRate: number;
  /** HITL pairs correctly routed to human (not auto-merged). */
  hitlRoutingAccuracy: number;
  /** Accrual/refinement pairs wrongly classified as contradiction by NLI. */
  accrualOverBlockRate: number;
  /** Contradiction/refutation pairs where NLI returned contradiction. */
  blockRecall: number;
  byCategory: CategoryMetrics[];
  byScenario: Array<{
    scenario: string;
    count: number;
    correct: number;
    accuracy: number;
  }>;
  results: PairEvalResult[];
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

const DEFAULT_GOLD_PATH = join(
  process.cwd(),
  "test/fixtures/nli-gold-set.yaml",
);

export function categoryToExpectedAction(
  category: GoldCategory,
): ExpectedAction {
  switch (category) {
    case "paraphrase":
      return "auto_merge";
    case "false_positive_trap":
      return "no_merge";
    case "contradiction":
      return "block_contradiction";
    case "refutation":
      return "block_refutation";
    case "ambiguous_hitl":
      return "hitl";
  }
}

export function loadNliGoldSet(path = DEFAULT_GOLD_PATH): NliGoldSet {
  const raw = parseYaml(readFileSync(path, "utf-8")) as NliGoldSet;
  if (!raw?.pairs?.length)
    throw new Error(`Invalid or empty gold set: ${path}`);
  return raw;
}

// ---------------------------------------------------------------------------
// Pipeline resolution
// ---------------------------------------------------------------------------

/**
 * Map an NLI verdict + governance decision to a resolved action.
 * Mirrors runtime: agentLoop → governanceAgent → actionExecutor.
 */
export function resolveActionFromVerdict(
  verdict: NliVerdict,
  minConfidence: number,
  prior?: string,
  next?: string,
  dimension?: string,
): { action: ResolvedAction; reason?: string } {
  if (!verdict.available) return { action: "unavailable" };

  if (prior !== undefined && next !== undefined) {
    const schemaMap = loadDimensionSchemaMap();
    const routing = resolveGenericEquivalenceRouting(prior, next, verdict, {
      dimension,
      schemaMap,
    });
    if (!routing.propose && routing.reason === "canonical_equal_skip") {
      return { action: "auto_merge", reason: routing.reason };
    }
    if (routing.reason === "nli_contradiction_block") {
      return {
        action: "block_contradiction",
        reason: `nli_contradiction:${verdict.confidence.toFixed(2)}`,
      };
    }
    if (
      routing.reason === "typed_diff_hitl" ||
      routing.reason === "free_text_hitl"
    ) {
      return { action: "hitl", reason: routing.reason };
    }
    if (routing.reason === "accrual_prefilter_hitl") {
      return { action: "hitl", reason: "accrual_prefilter:hitl" };
    }
  }

  if (verdict.label === "contradiction") {
    return {
      action: "block_contradiction",
      reason: `nli_contradiction:${verdict.confidence.toFixed(2)}`,
    };
  }

  if (!shouldProposeEquivalence(verdict)) {
    return { action: "no_merge", reason: "not_proposed" };
  }

  const payload: EquivalencePayload = {
    scope_id: "eval",
    node_type: "claim",
    existing_node_id: "eval-node",
    a: "",
    b: "",
    nli_label: verdict.label,
    nli_confidence: verdict.confidence,
  };
  const decision = decideEquivalence(payload, { minConfidence });

  if (decision.outcome === "approve") {
    return { action: "auto_merge", reason: decision.reason };
  }

  // Rejected equivalence proposal: neutral → no_merge; low-conf equivalent → hitl
  if (verdict.label === "equivalent" && verdict.confidence < minConfidence) {
    return { action: "hitl", reason: decision.reason };
  }
  if (verdict.label === "neutral") {
    return { action: "hitl", reason: decision.reason };
  }
  return { action: "no_merge", reason: decision.reason };
}

/** Whether resolved action matches gold expectation (with category-specific rules). */
export function isCorrectRouting(
  expected: ExpectedAction,
  resolved: ResolvedAction,
  pair?: Pick<NliGoldPair, "category" | "hitlSubtype">,
): boolean {
  if (resolved === "unavailable") return false;

  switch (expected) {
    case "auto_merge":
      return resolved === "auto_merge";
    case "no_merge":
      return (
        resolved === "no_merge" ||
        resolved === "hitl" ||
        resolved === "block_contradiction"
      );
    case "block_contradiction":
      return resolved === "block_contradiction";
    case "block_refutation":
      // Refutation must not auto-merge; hitl is acceptable (human adjudicates evidence)
      return (
        resolved === "block_contradiction" ||
        resolved === "no_merge" ||
        resolved === "hitl"
      );
    case "hitl":
      if (
        pair?.hitlSubtype === "accrual" ||
        pair?.hitlSubtype === "refinement"
      ) {
        // Accrual/refinement: human must confirm growth — never contradiction or silent merge
        return resolved === "hitl" || resolved === "no_merge";
      }
      return resolved === "hitl" || resolved === "no_merge";
  }
}

export function evaluatePair(
  pair: NliGoldPair,
  verdict: NliVerdict,
  minConfidence: number,
): PairEvalResult {
  const expected = categoryToExpectedAction(pair.category);
  const { action: resolved, reason } = resolveActionFromVerdict(
    verdict,
    minConfidence,
    pair.prior,
    pair.next,
    pair.dimension,
  );
  return {
    id: pair.id,
    scenario: pair.scenario,
    dimension: pair.dimension,
    category: pair.category,
    hitlSubtype: pair.hitlSubtype,
    expected,
    resolved,
    correct: isCorrectRouting(expected, resolved, pair),
    nli: verdict,
    governanceReason: reason,
  };
}

export function evaluatePairsFromVerdicts(
  pairs: NliGoldPair[],
  verdicts: NliVerdict[],
  minConfidence: number,
): PairEvalResult[] {
  if (pairs.length !== verdicts.length) {
    throw new Error(
      `pairs/verdicts length mismatch: ${pairs.length} vs ${verdicts.length}`,
    );
  }
  return pairs.map((pair, i) => evaluatePair(pair, verdicts[i], minConfidence));
}

export interface ConfidenceSweepRow {
  minConfidence: number;
  accuracy: number;
  falseMergeRate: number;
  missedMergeRate: number;
  hitlRoutingAccuracy: number;
  accrualOverBlockRate: number;
  blockRecall: number;
}

/** Re-score cached NLI verdicts at multiple governance confidence thresholds. */
export function sweepConfidenceThresholds(
  pairs: NliGoldPair[],
  verdicts: NliVerdict[],
  thresholds: number[],
): ConfidenceSweepRow[] {
  return thresholds.map((minConfidence) => {
    const report = buildEvalReport(
      evaluatePairsFromVerdicts(pairs, verdicts, minConfidence),
    );
    return {
      minConfidence,
      accuracy: report.accuracy,
      falseMergeRate: report.falseMergeRate,
      missedMergeRate: report.missedMergeRate,
      hitlRoutingAccuracy: report.hitlRoutingAccuracy,
      accrualOverBlockRate: report.accrualOverBlockRate,
      blockRecall: report.blockRecall,
    };
  });
}

export function formatConfidenceSweep(rows: ConfidenceSweepRow[]): string {
  const header =
    "minConf  accuracy  falseMerge  missedMerge  hitlRoute  accrualOB  blockRecall";
  const lines = rows.map(
    (r) =>
      `${r.minConfidence.toFixed(2).padStart(6)}  ` +
      `${(r.accuracy * 100).toFixed(1).padStart(7)}%  ` +
      `${(r.falseMergeRate * 100).toFixed(1).padStart(9)}%  ` +
      `${(r.missedMergeRate * 100).toFixed(1).padStart(10)}%  ` +
      `${(r.hitlRoutingAccuracy * 100).toFixed(1).padStart(8)}%  ` +
      `${(r.accrualOverBlockRate * 100).toFixed(1).padStart(8)}%  ` +
      `${(r.blockRecall * 100).toFixed(1).padStart(10)}%`,
  );
  return [header, ...lines].join("\n");
}

function tallyByKey<T extends { correct: boolean }>(
  items: T[],
  keyFn: (item: T) => string,
): Array<{ key: string; count: number; correct: number; accuracy: number }> {
  const map = new Map<string, { count: number; correct: number }>();
  for (const item of items) {
    const k = keyFn(item);
    const cur = map.get(k) ?? { count: 0, correct: 0 };
    cur.count += 1;
    if (item.correct) cur.correct += 1;
    map.set(k, cur);
  }
  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      count: v.count,
      correct: v.correct,
      accuracy: v.count ? v.correct / v.count : 0,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function buildEvalReport(results: PairEvalResult[]): NliEvalReport {
  const total = results.length;
  const correct = results.filter((r) => r.correct).length;

  const nonMergeCategories = new Set<GoldCategory>([
    "false_positive_trap",
    "contradiction",
    "refutation",
    "ambiguous_hitl",
  ]);
  const nonMergePairs = results.filter((r) =>
    nonMergeCategories.has(r.category),
  );
  const falseMerges = nonMergePairs.filter(
    (r) => r.resolved === "auto_merge",
  ).length;

  const paraphrasePairs = results.filter((r) => r.category === "paraphrase");
  const missedMerges = paraphrasePairs.filter(
    (r) => r.resolved !== "auto_merge",
  ).length;

  const hitlPairs = results.filter((r) => r.category === "ambiguous_hitl");
  const hitlCorrect = hitlPairs.filter((r) => r.correct).length;

  const accrualPairs = results.filter(
    (r) =>
      r.category === "ambiguous_hitl" &&
      (r.hitlSubtype === "accrual" || r.hitlSubtype === "refinement"),
  );
  const accrualOverBlocked = accrualPairs.filter(
    (r) => r.resolved === "block_contradiction",
  ).length;

  const blockPairs = results.filter(
    (r) => r.category === "contradiction" || r.category === "refutation",
  );
  const blockDetected = blockPairs.filter(
    (r) => r.nli.label === "contradiction",
  ).length;

  const categories: GoldCategory[] = [
    "paraphrase",
    "false_positive_trap",
    "contradiction",
    "refutation",
    "ambiguous_hitl",
  ];
  const byCategory: CategoryMetrics[] = categories.map((category) => {
    const subset = results.filter((r) => r.category === category);
    const catCorrect = subset.filter((r) => r.correct).length;
    return {
      category,
      count: subset.length,
      correct: catCorrect,
      accuracy: subset.length ? catCorrect / subset.length : 0,
    };
  });

  const byScenario = tallyByKey(results, (r) => r.scenario).map((row) => ({
    scenario: row.key,
    count: row.count,
    correct: row.correct,
    accuracy: row.accuracy,
  }));

  return {
    total,
    correct,
    accuracy: total ? correct / total : 0,
    falseMergeRate: nonMergePairs.length
      ? falseMerges / nonMergePairs.length
      : 0,
    missedMergeRate: paraphrasePairs.length
      ? missedMerges / paraphrasePairs.length
      : 0,
    hitlRoutingAccuracy: hitlPairs.length ? hitlCorrect / hitlPairs.length : 0,
    accrualOverBlockRate: accrualPairs.length
      ? accrualOverBlocked / accrualPairs.length
      : 0,
    blockRecall: blockPairs.length ? blockDetected / blockPairs.length : 0,
    byCategory,
    byScenario,
    results,
  };
}

export function formatEvalReport(report: NliEvalReport): string {
  const lines: string[] = [
    "NLI Gold-Set Evaluation Report",
    "=".repeat(60),
    `Total pairs: ${report.total}  Correct: ${report.correct}  Accuracy: ${(report.accuracy * 100).toFixed(1)}%`,
    `False-merge rate (on non-merge categories): ${(report.falseMergeRate * 100).toFixed(1)}%`,
    `Missed-merge rate (paraphrase): ${(report.missedMergeRate * 100).toFixed(1)}%`,
    `HITL routing accuracy: ${(report.hitlRoutingAccuracy * 100).toFixed(1)}%`,
    `Accrual over-block rate (accrual/refinement → contradiction): ${(report.accrualOverBlockRate * 100).toFixed(1)}%`,
    `Block recall (contradiction/refutation → NLI contradiction): ${(report.blockRecall * 100).toFixed(1)}%`,
    "",
    "By category:",
  ];
  for (const c of report.byCategory) {
    if (c.count === 0) continue;
    lines.push(
      `  ${c.category.padEnd(22)} ${c.correct}/${c.count}  ${(c.accuracy * 100).toFixed(0)}%`,
    );
  }
  lines.push("", "By scenario:");
  for (const s of report.byScenario) {
    lines.push(
      `  ${s.scenario.padEnd(10)} ${s.correct}/${s.count}  ${(s.accuracy * 100).toFixed(0)}%`,
    );
  }
  const failures = report.results.filter((r) => !r.correct);
  if (failures.length > 0) {
    lines.push("", `Failures (${failures.length}):`);
    for (const f of failures) {
      lines.push(
        `  ${f.id}: expected=${f.expected} resolved=${f.resolved} nli=${f.nli.label}@${f.nli.confidence.toFixed(2)}`,
      );
    }
  }
  return lines.join("\n");
}
