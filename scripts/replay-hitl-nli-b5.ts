#!/usr/bin/env npx tsx
/**
 * B5 lightweight replay: run HITL seed contradiction/resolution claim pairs through
 * the live facts-worker NLI gate (Issue 06 adapter). Compare two worker URLs when
 * BASELINE_WORKER_URL is set (e.g. CrossEncoder vs Liquid v3).
 *
 * Full swarm finality replay (pnpm run seed:hitl + governance) is documented in
 * Issue 07; this script validates the NLI layer on the seeded contradiction pairs.
 *
 * Usage:
 *   FACTS_WORKER_URL=http://127.0.0.1:8017 npx tsx scripts/replay-hitl-nli-b5.ts
 *   FACTS_WORKER_URL=http://127.0.0.1:8017 BASELINE_WORKER_URL=http://127.0.0.1:8010 \
 *     npx tsx scripts/replay-hitl-nli-b5.ts --out=model_evals/liquidai-encoders/b5-hitl-nli-replay.json
 */

import { writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
  CLAIMS,
  CONTRADICTION_EDGES,
  RESOLUTION_EDGES,
} from "../src/seed-data/hitl-scenario.js";
import { nliEntailment } from "../src/nliGate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

interface PairSpec {
  id: string;
  kind: "contradiction" | "resolution";
  a: string;
  b: string;
  note: string;
}

function buildPairs(): PairSpec[] {
  const out: PairSpec[] = [];
  for (const e of CONTRADICTION_EDGES) {
    out.push({
      id: `hitl-contradiction-${e.sourceIndex}-${e.targetIndex}`,
      kind: "contradiction",
      a: CLAIMS[e.sourceIndex],
      b: CLAIMS[e.targetIndex],
      note: e.raw,
    });
  }
  for (const e of RESOLUTION_EDGES) {
    out.push({
      id: `hitl-resolution-${e.sourceIndex}-${e.targetIndex}`,
      kind: "resolution",
      a: CLAIMS[e.sourceIndex],
      b: CLAIMS[e.targetIndex],
      note: e.note,
    });
  }
  return out;
}

function parseArgs(): { outPath: string } {
  let outPath = "model_evals/liquidai-encoders/b5-hitl-nli-replay.json";
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--out=")) outPath = arg.slice("--out=".length);
  }
  return { outPath: resolve(ROOT, outPath) };
}

async function runBackend(
  label: string,
  workerUrl: string | undefined,
  pairs: PairSpec[],
): Promise<Array<PairSpec & { label: string; confidence: number; available: boolean }>> {
  const rows = [];
  for (const p of pairs) {
    const v = await nliEntailment(p.a, p.b, { workerUrl, timeoutMs: 60_000 });
    rows.push({ ...p, label: v.label, confidence: v.confidence, available: v.available });
    console.log(
      `[${label}] ${p.id}: ${v.available ? `${v.label}@${v.confidence.toFixed(3)}` : "unavailable"}`,
    );
  }
  return rows;
}

async function main(): Promise<void> {
  const { outPath } = parseArgs();
  const pairs = buildPairs();
  const challengerUrl = process.env.FACTS_WORKER_URL?.trim();
  const baselineUrl = process.env.BASELINE_WORKER_URL?.trim();

  if (!challengerUrl) {
    console.error("FACTS_WORKER_URL unset. Start Liquid v3 worker first.");
    process.exit(1);
  }

  console.log("B5 HITL NLI replay — pairs:", pairs.length);
  console.log("Challenger:", challengerUrl);
  if (baselineUrl) console.log("Baseline:", baselineUrl);
  console.log("");

  const challenger = await runBackend("liquid", challengerUrl, pairs);
  const baseline = baselineUrl ? await runBackend("baseline", baselineUrl, pairs) : null;

  const diffs =
    baseline?.map((b, i) => {
      const c = challenger[i];
      return {
        id: b.id,
        baseline: { label: b.label, confidence: b.confidence, available: b.available },
        challenger: { label: c.label, confidence: c.confidence, available: c.available },
        labelMatch: b.label === c.label,
      };
    }) ?? [];

  const report = {
    schemaVersion: "1",
    issue: "liquidai-07-b5-hitl-nli-replay",
    generatedAt: new Date().toISOString(),
    challengerWorkerUrl: challengerUrl,
    baselineWorkerUrl: baselineUrl ?? null,
    pairs: challenger,
    baselinePairs: baseline,
    diffs,
    summary: {
      pairCount: pairs.length,
      challengerUnavailable: challenger.filter((r) => !r.available).length,
      baselineUnavailable: baseline?.filter((r) => !r.available).length ?? null,
      labelDiffCount: diffs.filter((d) => !d.labelMatch).length,
    },
  };

  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log("\nWrote", outPath);
  console.log("Summary:", report.summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
