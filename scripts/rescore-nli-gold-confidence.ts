#!/usr/bin/env npx tsx
/**
 * Offline minConfidence sweep from a cached gold eval JSON (no worker calls).
 *
 * Usage:
 *   npx tsx scripts/rescore-nli-gold-confidence.ts \
 *     --from=model_evals/liquidai-encoders/phase2g-refine-v3-gold-minconf077.json \
 *     --thresholds=0.75,0.78,0.80,0.82,0.85
 */

import { readFileSync, writeFileSync } from "fs";
import {
  buildEvalReport,
  evaluatePairsFromVerdicts,
  formatConfidenceSweep,
  formatEvalReport,
  loadNliGoldSet,
  sweepConfidenceThresholds,
  type NliGoldPair,
} from "../src/baselines/scenario/nli-eval.js";
import type { NliVerdict } from "../src/nliGate.js";

interface CachedGoldEval {
  results: Array<{
    id: string;
    nli?: { label: string; confidence: number; available?: boolean };
  }>;
}

function parseArgs(): {
  fromPath: string;
  goldPath?: string;
  outPath?: string;
  thresholds: number[];
} {
  const args = process.argv.slice(2);
  let fromPath = "model_evals/liquidai-encoders/phase2g-refine-v3-gold-minconf077.json";
  let goldPath: string | undefined;
  let outPath: string | undefined;
  let thresholds = [0.75, 0.76, 0.77, 0.78, 0.79, 0.8, 0.81, 0.82, 0.83, 0.84, 0.85];

  for (const a of args) {
    if (a.startsWith("--from=")) fromPath = a.slice(7);
    else if (a.startsWith("--gold=")) goldPath = a.slice(7);
    else if (a.startsWith("--out=")) outPath = a.slice(6);
    else if (a.startsWith("--thresholds=")) {
      thresholds = a
        .slice(13)
        .split(",")
        .map((s) => parseFloat(s.trim()))
        .filter((n) => Number.isFinite(n));
    }
  }

  return { fromPath, goldPath, outPath, thresholds };
}

function loadVerdictsFromCache(
  pairs: NliGoldPair[],
  cached: CachedGoldEval,
): NliVerdict[] {
  const byId = new Map(cached.results.map((r) => [r.id, r]));
  return pairs.map((pair) => {
    const row = byId.get(pair.id);
    if (!row?.nli) {
      throw new Error(`Missing NLI verdict for pair ${pair.id} in cached JSON`);
    }
    return {
      label: row.nli.label as NliVerdict["label"],
      confidence: row.nli.confidence,
      available: row.nli.available ?? true,
    };
  });
}

function main(): void {
  const opts = parseArgs();
  const gold = loadNliGoldSet(opts.goldPath);
  const pairs = gold.pairs;
  const cached = JSON.parse(readFileSync(opts.fromPath, "utf-8")) as CachedGoldEval;
  const verdicts = loadVerdictsFromCache(pairs, cached);
  const sweep = sweepConfidenceThresholds(pairs, verdicts, opts.thresholds);

  console.log(`Offline confidence sweep — ${pairs.length} pairs from ${opts.fromPath}`);
  console.log(`Thresholds: [${opts.thresholds.join(", ")}]\n`);
  console.log(formatConfidenceSweep(sweep));

  const bestSafety = sweep.reduce((best, row) => {
    if (row.falseMergeRate > 0) return best;
    if (!best || row.blockRecall > best.blockRecall) return row;
    return best;
  }, null as (typeof sweep)[number] | null);

  if (bestSafety) {
    console.log(
      `\nBest zero-false-merge threshold: minConfidence=${bestSafety.minConfidence} ` +
        `(blockRecall=${(bestSafety.blockRecall * 100).toFixed(1)}%, accuracy=${(bestSafety.accuracy * 100).toFixed(1)}%)`,
    );
  } else {
    console.log("\nNo threshold in sweep achieved 0% false-merge rate.");
  }

  const defaultRow = sweep.find((r) => r.minConfidence === 0.7);
  const row080 = sweep.find((r) => r.minConfidence === 0.8);
  if (defaultRow && row080) {
    console.log("\nCompare 0.70 vs 0.80:");
    console.log(formatEvalReport(buildEvalReport(evaluatePairsFromVerdicts(pairs, verdicts, 0.7))));
    console.log(formatEvalReport(buildEvalReport(evaluatePairsFromVerdicts(pairs, verdicts, 0.8))));
  }

  if (opts.outPath) {
    writeFileSync(
      opts.outPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          sourceEval: opts.fromPath,
          pairCount: pairs.length,
          thresholds: opts.thresholds,
          confidenceSweep: sweep,
          bestZeroFalseMerge: bestSafety,
        },
        null,
        2,
      ),
    );
    console.log(`\nWrote ${opts.outPath}`);
  }
}

main();
