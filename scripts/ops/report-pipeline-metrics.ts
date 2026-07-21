#!/usr/bin/env npx tsx
/**
 * Report pipeline KPIs separately from the frozen NLI gold regression suite.
 *
 * Usage:
 *   npx tsx scripts/ops/report-pipeline-metrics.ts
 *   npx tsx scripts/ops/report-pipeline-metrics.ts --held-out
 *   FACTS_WORKER_URL=http://127.0.0.1:8011 npx tsx scripts/ops/report-pipeline-metrics.ts --live
 */

import { readFileSync } from "fs";
import { join } from "path";
import { nliEntailment } from "../../src/nliGate.js";
import {
  buildEvalReport,
  evaluatePair,
  formatEvalReport,
  loadNliGoldSet,
  type NliGoldPair,
} from "../../src/baselines/scenario/nli-eval.js";
import { parse as parseYaml } from "yaml";

function loadHeldOut(path = join(process.cwd(), "test/fixtures/nli-held-out.yaml")) {
  const raw = parseYaml(readFileSync(path, "utf-8")) as { pairs: NliGoldPair[]; minConfidenceDefault?: number };
  if (!raw?.pairs?.length) throw new Error(`Invalid held-out fixture: ${path}`);
  return raw;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const live = args.has("--live");
  const heldOutOnly = args.has("--held-out");
  const minConfidence = 0.7;

  const sections: string[] = ["Pipeline Metrics Report", "=".repeat(60), ""];

  if (!heldOutOnly) {
    const gold = loadNliGoldSet();
    sections.push("NLI gold set (FROZEN regression — safety only)");
    if (live) {
      const results = [];
      for (const pair of gold.pairs) {
        const verdict = await nliEntailment(pair.prior, pair.next);
        results.push(evaluatePair(pair, verdict, minConfidence));
      }
      const report = buildEvalReport(results);
      sections.push(formatEvalReport(report));
    } else {
      sections.push(`  pairs: ${gold.pairs.length} (dry-run — use --live for NLI eval)`);
      sections.push("  KPI focus: falseMergeRate=0, blockRecall=100%");
    }
    sections.push("");
  }

  const held = loadHeldOut();
  sections.push("Held-out set (pipeline validation — not used for heuristic design)");
  if (live) {
    const results = [];
    for (const pair of held.pairs) {
      const verdict = await nliEntailment(pair.prior, pair.next);
      results.push(evaluatePair(pair, verdict, minConfidence));
    }
    const report = buildEvalReport(results);
    sections.push(formatEvalReport(report));
  } else {
    sections.push(`  pairs: ${held.pairs.length} (dry-run — use --live for NLI eval)`);
  }
  sections.push("");
  sections.push("Pipeline KPIs (measure via benchmark harness, not gold-set accuracy):");
  sections.push("  - dimension_populated_rate: % structured_claims with dimension");
  sections.push("  - off_contract_rate: M4 schema violations (local format enforced)");
  sections.push("  - m3_excess: measured M3 − ground_truth M3");
  sections.push("  - hitl_proposal_rate: assert_equivalence proposals / dimension changes");

  console.log(sections.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
