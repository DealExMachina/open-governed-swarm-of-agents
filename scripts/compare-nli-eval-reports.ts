#!/usr/bin/env npx tsx
/**
 * Compare two NLI gold-set eval JSON reports (baseline vs challenger).
 *
 * Usage:
 *   npx tsx scripts/compare-nli-eval-reports.ts \
 *     model_evals/liquidai-encoders/baseline-deberta-v3-large-gold.json \
 *     model_evals/liquidai-encoders/phase1-lfm-zero-shot-gold.json \
 *     --out=model_evals/liquidai-encoders/phase1-zero-shot-vs-deberta.md
 */

import { readFileSync, writeFileSync } from "fs";

interface Report {
  total: number;
  accuracy: number;
  falseMergeRate: number;
  missedMergeRate: number;
  hitlRoutingAccuracy: number;
  accrualOverBlockRate: number;
  blockRecall: number;
}

function load(path: string): Report {
  return JSON.parse(readFileSync(path, "utf-8")) as Report;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function delta(a: number, b: number): string {
  const d = (b - a) * 100;
  const sign = d > 0 ? "+" : "";
  return `${sign}${d.toFixed(1)} pp`;
}

function main(): void {
  const args = process.argv.slice(2);
  let outPath: string | undefined;
  const paths: string[] = [];
  for (const a of args) {
    if (a.startsWith("--out=")) outPath = a.slice(6);
    else paths.push(a);
  }
  if (paths.length < 2) {
    console.error("Usage: compare-nli-eval-reports.ts <baseline.json> <challenger.json> [--out=report.md]");
    process.exit(1);
  }

  const baseline = load(paths[0]);
  const challenger = load(paths[1]);
  const baselineLabel = paths[0].includes("deberta") ? "DeBERTa v3 large" : paths[0];
  const challengerLabel = paths[1].includes("lfm") ? "LFM2.5-Encoder-230M (zero-shot)" : paths[1];

  const rows: Array<[string, string, string, string, string]> = [
    ["Metric", "Gate", baselineLabel, challengerLabel, "Δ"],
    ["False-merge rate", "must = 0%", pct(baseline.falseMergeRate), pct(challenger.falseMergeRate), delta(baseline.falseMergeRate, challenger.falseMergeRate)],
    ["Block recall", "no regression", pct(baseline.blockRecall), pct(challenger.blockRecall), delta(baseline.blockRecall, challenger.blockRecall)],
    ["Routing accuracy", "info", pct(baseline.accuracy), pct(challenger.accuracy), delta(baseline.accuracy, challenger.accuracy)],
    ["Missed-merge (paraphrase)", "info", pct(baseline.missedMergeRate), pct(challenger.missedMergeRate), delta(baseline.missedMergeRate, challenger.missedMergeRate)],
    ["HITL routing accuracy", "info", pct(baseline.hitlRoutingAccuracy), pct(challenger.hitlRoutingAccuracy), delta(baseline.hitlRoutingAccuracy, challenger.hitlRoutingAccuracy)],
    ["Accrual over-block rate", "info", pct(baseline.accrualOverBlockRate), pct(challenger.accrualOverBlockRate), delta(baseline.accrualOverBlockRate, challenger.accrualOverBlockRate)],
  ];

  const md = [
    "# NLI eval comparison",
    "",
    `**Baseline:** \`${paths[0]}\`  `,
    `**Challenger:** \`${paths[1]}\`  `,
    `**Harness:** \`scripts/eval-nli-gold-set.ts\` · 57 gold pairs · minConfidence 0.7`,
    "",
    "| " + rows[0].join(" | ") + " |",
    "| " + rows[0].map(() => "---").join(" | ") + " |",
    ...rows.slice(1).map((r) => "| " + r.join(" | ") + " |"),
    "",
    "## Interpretation",
    "",
    "- **False-merge rate = 0%** is the hard safety gate for SGRS equivalence.",
    "- Zero-shot LFM encoder probe is expected to underperform DeBERTa on routing accuracy; the point is a **reproducible harness** and baseline delta before domain fine-tune.",
    "",
  ].join("\n");

  console.log(md);
  if (outPath) {
    writeFileSync(outPath, md);
    console.error(`Wrote ${outPath}`);
  }
}

main();
