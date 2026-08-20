#!/usr/bin/env npx tsx
/**
 * Evaluate the NLI cross-encoder gate against the gold-set fixture.
 *
 * Usage:
 *   npx tsx scripts/eval-nli-gold-set.ts              # live worker (FACTS_WORKER_URL)
 *   npx tsx scripts/eval-nli-gold-set.ts --dry-run    # structure check only
 *   npx tsx scripts/eval-nli-gold-set.ts --out=report.json
 *   npx tsx scripts/eval-nli-gold-set.ts --category=paraphrase
 */

import { writeFileSync } from "fs";
import { nliEntailment } from "../src/nliGate.js";
import {
  buildEvalReport,
  formatEvalReport,
  evaluatePair,
  loadNliGoldSet,
  type GoldCategory,
  type NliGoldPair,
} from "../src/baselines/scenario/nli-eval.js";

function parseArgs(): {
  goldPath?: string;
  outPath?: string;
  category?: GoldCategory;
  dryRun: boolean;
  minConfidence: number;
  workerUrl?: string;
} {
  const args = process.argv.slice(2);
  let goldPath: string | undefined;
  let outPath: string | undefined;
  let category: GoldCategory | undefined;
  let dryRun = false;
  let minConfidence = 0.77;
  let workerUrl: string | undefined;

  for (const a of args) {
    if (a === "--dry-run") dryRun = true;
    else if (a.startsWith("--gold=")) goldPath = a.slice(7);
    else if (a.startsWith("--out=")) outPath = a.slice(6);
    else if (a.startsWith("--category=")) category = a.slice(11) as GoldCategory;
    else if (a.startsWith("--min-confidence=")) minConfidence = parseFloat(a.slice(17));
    else if (a.startsWith("--worker=")) workerUrl = a.slice(9);
  }

  const envMin = Number(process.env.EQUIV_MIN_CONFIDENCE);
  if (Number.isFinite(envMin) && envMin > 0 && !args.some((a) => a.startsWith("--min-confidence="))) {
    minConfidence = envMin;
  }

  return { goldPath, outPath, category, dryRun, minConfidence, workerUrl };
}

async function assertWorkerNliReady(workerUrl: string): Promise<void> {
  const base = workerUrl.replace(/\/+$/, "");
  const healthResp = await fetch(`${base}/health`);
  if (!healthResp.ok) {
    throw new Error(`Health check failed: HTTP ${healthResp.status}`);
  }
  const health = (await healthResp.json()) as { capabilities?: string[] };
  if (!health.capabilities?.includes("nli")) {
    throw new Error(
      `Worker is up but NLI is not loaded (capabilities=${JSON.stringify(health.capabilities ?? [])})`,
    );
  }

  const smokeResp = await fetch(`${base}/nli`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      a: "Revenue is fifty million euros",
      b: "Annual revenue of €50M",
    }),
  });
  if (!smokeResp.ok) {
    throw new Error(`NLI smoke test failed: HTTP ${smokeResp.status}`);
  }
  const smoke = (await smokeResp.json()) as { available?: boolean };
  if (smoke.available === false) {
    throw new Error("NLI smoke test returned available:false — inference not working");
  }
}

async function runLiveEval(
  pairs: NliGoldPair[],
  minConfidence: number,
  workerUrl?: string,
): Promise<ReturnType<typeof buildEvalReport>> {
  const results = [];
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    process.stdout.write(`  [${i + 1}/${pairs.length}] ${pair.id}…`);
    const verdict = await nliEntailment(pair.prior, pair.next, { workerUrl });
    results.push(evaluatePair(pair, verdict, minConfidence));
    process.stdout.write(` ${verdict.label}@${verdict.confidence.toFixed(2)} ${results.at(-1)!.correct ? "OK" : "FAIL"}\n`);
  }
  return buildEvalReport(results);
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const gold = loadNliGoldSet(opts.goldPath);
  let pairs = gold.pairs;
  if (opts.category) {
    pairs = pairs.filter((p) => p.category === opts.category);
    console.log(`Filtered to category=${opts.category}: ${pairs.length} pairs`);
  }

  const minConf = opts.minConfidence ?? gold.minConfidenceDefault;
  console.log(`NLI gold-set evaluation — ${pairs.length} pairs, minConfidence=${minConf}`);

  if (opts.dryRun) {
    const byCat = new Map<string, number>();
    const bySc = new Map<string, number>();
    for (const p of pairs) {
      byCat.set(p.category, (byCat.get(p.category) ?? 0) + 1);
      bySc.set(p.scenario, (bySc.get(p.scenario) ?? 0) + 1);
    }
    console.log("Categories:", Object.fromEntries(byCat));
    console.log("Scenarios:", Object.fromEntries(bySc));
    console.log("Dry run OK — fixture valid.");
    return;
  }

  const workerUrl = opts.workerUrl ?? process.env.FACTS_WORKER_URL;
  if (!workerUrl?.trim()) {
    console.error("FACTS_WORKER_URL unset. Start the facts-worker with NLI enabled or pass --worker=URL.");
    process.exit(1);
  }

  console.log(`Worker: ${workerUrl}`);
  await assertWorkerNliReady(workerUrl);

  const report = await runLiveEval(pairs, minConf, workerUrl);
  const availableCount = report.results.filter((r) => r.nli.available).length;
  if (availableCount === 0) {
    console.error(
      `Invalid run: 0/${report.results.length} pairs had NLI available. ` +
        "Worker likely failed to load the model — refusing to write a misleading report.",
    );
    process.exit(1);
  }
  if (availableCount < report.results.length) {
    console.warn(
      `Warning: only ${availableCount}/${report.results.length} pairs had NLI available`,
    );
  }

  const text = formatEvalReport(report);
  console.log("\n" + text);

  if (opts.outPath) {
    writeFileSync(opts.outPath, JSON.stringify(report, null, 2));
    console.log(`\nWrote ${opts.outPath}`);
  }

  process.exit(report.accuracy >= 0.7 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
