#!/usr/bin/env npx tsx
/**
 * Score offline NLI verdicts against the frozen gold set (SGRS governance routing).
 *
 * Usage:
 *   pnpm run nli:smoke -- --verdicts=model_evals/nli/verdicts-deberta.json
 *   pnpm run nli:smoke -- --verdicts=model_evals/nli/verdicts-lfm-cosine.json --compare=model_evals/nli/verdicts-deberta.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, basename } from "path";
import {
  buildEvalReport,
  evaluatePairsFromVerdicts,
  formatConfidenceSweep,
  formatEvalReport,
  loadNliGoldSet,
  sweepConfidenceThresholds,
  type NliEvalReport,
} from "../../src/baselines/scenario/nli-eval.js";
import type { NliVerdict } from "../../src/nliGate.js";

interface VerdictFile {
  backend: string;
  model: string;
  pair_count: number;
  latency_ms?: { mean: number; p50: number; max: number };
  verdicts: Array<{
    id: string;
    label: string;
    confidence: number;
    available: boolean;
    latency_ms?: number;
  }>;
}

function loadVerdicts(path: string): VerdictFile {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as VerdictFile;
  if (!raw?.verdicts?.length) {
    throw new Error(`Invalid verdict file (empty): ${path}`);
  }
  return raw;
}

function toNliVerdicts(file: VerdictFile): NliVerdict[] {
  return file.verdicts.map((v) => ({
    label:
      v.label === "equivalent" || v.label === "contradiction"
        ? v.label
        : "neutral",
    confidence: v.confidence ?? 0,
    available: v.available !== false,
  }));
}

function compareReports(
  baseline: NliEvalReport,
  candidate: NliEvalReport,
): string[] {
  const lines = [
    "Comparison vs baseline",
    "-".repeat(40),
    `accuracy:        ${(baseline.accuracy * 100).toFixed(1)}% -> ${(candidate.accuracy * 100).toFixed(1)}%`,
    `falseMergeRate:  ${(baseline.falseMergeRate * 100).toFixed(1)}% -> ${(candidate.falseMergeRate * 100).toFixed(1)}% ${candidate.falseMergeRate <= baseline.falseMergeRate ? "OK" : "REGRESSION"}`,
    `blockRecall:     ${(baseline.blockRecall * 100).toFixed(1)}% -> ${(candidate.blockRecall * 100).toFixed(1)}% ${candidate.blockRecall >= baseline.blockRecall ? "OK" : "REGRESSION"}`,
    `accrualOverBlock:${(baseline.accrualOverBlockRate * 100).toFixed(1)}% -> ${(candidate.accrualOverBlockRate * 100).toFixed(1)}% ${candidate.accrualOverBlockRate <= baseline.accrualOverBlockRate ? "OK" : "REGRESSION"}`,
    `missedMerge:     ${(baseline.missedMergeRate * 100).toFixed(1)}% -> ${(candidate.missedMergeRate * 100).toFixed(1)}%`,
    `hitlRouting:     ${(baseline.hitlRoutingAccuracy * 100).toFixed(1)}% -> ${(candidate.hitlRoutingAccuracy * 100).toFixed(1)}%`,
  ];
  return lines;
}

function parseArgs(): {
  verdictsPath: string;
  comparePath?: string;
  minConfidence: number;
  outDir: string;
} {
  const args = process.argv.slice(2);
  let verdictsPath = join(process.cwd(), "model_evals/nli/verdicts-deberta.json");
  let comparePath: string | undefined;
  let minConfidence = 0.7;
  let outDir = join(process.cwd(), "model_evals/nli");

  for (const arg of args) {
    if (arg.startsWith("--verdicts=")) {
      verdictsPath = arg.slice("--verdicts=".length);
    } else if (arg.startsWith("--compare=")) {
      comparePath = arg.slice("--compare=".length);
    } else if (arg.startsWith("--min-confidence=")) {
      minConfidence = Number(arg.slice("--min-confidence=".length));
    } else if (arg.startsWith("--out-dir=")) {
      outDir = arg.slice("--out-dir=".length);
    }
  }
  return { verdictsPath, comparePath, minConfidence, outDir };
}

function main() {
  const { verdictsPath, comparePath, minConfidence, outDir } = parseArgs();
  const gold = loadNliGoldSet();
  const file = loadVerdicts(verdictsPath);

  if (file.verdicts.length !== gold.pairs.length) {
    throw new Error(
      `Pair count mismatch: gold=${gold.pairs.length} verdicts=${file.verdicts.length}`,
    );
  }

  const ids = new Set(gold.pairs.map((p) => p.id));
  for (const v of file.verdicts) {
    if (!ids.has(v.id)) {
      throw new Error(`Unknown pair id in verdicts: ${v.id}`);
    }
  }

  const verdicts = toNliVerdicts(file);
  const pairResults = evaluatePairsFromVerdicts(
    gold.pairs,
    verdicts,
    minConfidence,
  );
  const report = buildEvalReport(pairResults);
  const sweep = sweepConfidenceThresholds(
    gold.pairs,
    verdicts,
    [0.5, 0.6, 0.7, 0.8, 0.9],
  );

  const sections: string[] = [
    `NLI Model Smoke — ${file.backend} (${file.model})`,
    "=".repeat(60),
    `Verdicts: ${verdictsPath}`,
    `Pairs: ${file.pair_count}`,
  ];
  if (file.latency_ms) {
    sections.push(
      `Latency ms: mean=${file.latency_ms.mean} p50=${file.latency_ms.p50} max=${file.latency_ms.max}`,
    );
  }
  sections.push("", formatEvalReport(report), "", "Confidence sweep:", formatConfidenceSweep(sweep));

  let baselineReport: NliEvalReport | undefined;
  if (comparePath) {
    const baselineFile = loadVerdicts(comparePath);
    const baselineVerdicts = toNliVerdicts(baselineFile);
    baselineReport = buildEvalReport(
      evaluatePairsFromVerdicts(gold.pairs, baselineVerdicts, minConfidence),
    );
    sections.push("", ...compareReports(baselineReport, report));
  }

  const text = sections.join("\n");
  console.log(text);

  mkdirSync(outDir, { recursive: true });
  const stem = basename(verdictsPath, ".json").replace(/^verdicts-/, "");
  const reportPath = join(outDir, `report-${stem}.json`);
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        backend: file.backend,
        model: file.model,
        minConfidence,
        latency_ms: file.latency_ms,
        report,
        confidenceSweep: sweep,
        baselineComparison: baselineReport
          ? {
              falseMergeDelta:
                report.falseMergeRate - baselineReport.falseMergeRate,
              blockRecallDelta:
                report.blockRecall - baselineReport.blockRecall,
              accrualOverBlockDelta:
                report.accrualOverBlockRate -
                baselineReport.accrualOverBlockRate,
            }
          : undefined,
      },
      null,
      2,
    ),
  );
  console.log(`\nWrote ${reportPath}`);
}

main();
