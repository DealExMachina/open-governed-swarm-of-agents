#!/usr/bin/env tsx
/**
 * Load generator: inject context documents at configurable rate.
 *
 * Used for load and variational experiments to stress state graph, progression,
 * and finality. Supports:
 *   - Rate-controlled: delay between docs (baseline=20s, stress=2s)
 *   - Burst: all docs at once
 *   - Repeat: inject N batches for sustained load
 *
 * Usage:
 *   LOAD_INJECT_DELAY_MS=2000 pnpm tsx scripts/loadgen-inject.ts
 *   LOAD_BURST=1 pnpm tsx scripts/loadgen-inject.ts
 *   LOAD_REPEAT=3 pnpm tsx scripts/loadgen-inject.ts
 *
 * Run after swarm is up. Documents go to context WAL and NATS.
 */
import "dotenv/config";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { appendEvent } from "../src/contextWal.js";
import { createSwarmEvent } from "../src/events.js";
import { makeEventBus } from "../src/eventBus.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_DOCS_DIR = join(__dirname, "..", "demo", "scenario", "docs");

const DELAY_MS = parseInt(process.env.LOAD_INJECT_DELAY_MS ?? "20000", 10);
const BURST = process.env.LOAD_BURST === "1" || process.env.LOAD_BURST === "true";
const REPEAT = Math.max(1, parseInt(process.env.LOAD_REPEAT ?? "1", 10));
const DOC_PREFIX = process.env.LOAD_DOC_PREFIX ?? "";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadDocs(): Array<{ text: string; title: string; filename: string }> {
  const allFiles = readdirSync(DEMO_DOCS_DIR)
    .filter((f) => f.endsWith(".txt"))
    .sort();

  const files = DOC_PREFIX
    ? allFiles.filter((f) => f.startsWith(DOC_PREFIX))
    : allFiles;

  if (files.length === 0) {
    throw new Error(`No matching .txt files in ${DEMO_DOCS_DIR} (filter: "${DOC_PREFIX || "*"}")`);
  }

  return files.map((file) => {
    const filePath = join(DEMO_DOCS_DIR, file);
    const text = readFileSync(filePath, "utf-8");
    const title = file.replace(".txt", "").replace(/-/g, " ").replace(/^\d+ /, "");
    return { text, title, filename: file };
  });
}

async function injectBatch(
  bus: Awaited<ReturnType<typeof makeEventBus>>,
  docs: Array<{ text: string; title: string; filename: string }>,
  batchIndex: number,
): Promise<number[]> {
  const seqs: number[] = [];
  for (let i = 0; i < docs.length; i++) {
    const { text, title, filename } = docs[i];
    const suffix = REPEAT > 1 ? `-b${batchIndex}` : "";
    const event = createSwarmEvent(
      "context_doc",
      { text, title, filename: `${filename}${suffix}`, source: "loadgen" },
      { source: "loadgen-inject" },
    );

    const seq = await appendEvent(event as unknown as Record<string, unknown>);
    await bus.publishEvent(event);
    seqs.push(seq);

    if (BURST) continue;
    if (i < docs.length - 1) await delay(DELAY_MS);
  }
  return seqs;
}

async function main(): Promise<void> {
  const docs = loadDocs();
  const bus = await makeEventBus();

  console.log("\nLoad generator — context injection");
  console.log(`Mode: ${BURST ? "BURST" : `rate-controlled (${DELAY_MS}ms delay)`}`);
  console.log(`Docs per batch: ${docs.length}, batches: ${REPEAT}`);
  console.log(`Total docs: ${docs.length * REPEAT}\n`);

  const start = Date.now();
  const allSeqs: number[][] = [];

  for (let b = 0; b < REPEAT; b++) {
    if (REPEAT > 1) console.log(`Batch ${b + 1}/${REPEAT}...`);
    const seqs = await injectBatch(bus, docs, b);
    allSeqs.push(seqs);
    if (b < REPEAT - 1 && !BURST) await delay(DELAY_MS);
  }

  await bus.close();

  const elapsed = (Date.now() - start) / 1000;
  const totalDocs = docs.length * REPEAT;
  const rate = totalDocs / elapsed;

  console.log(`\nInjected ${totalDocs} docs in ${elapsed.toFixed(1)}s (${rate.toFixed(1)} docs/s)`);
  console.log(`First seq: ${allSeqs[0][0]}, last seq: ${allSeqs[allSeqs.length - 1][allSeqs[allSeqs.length - 1].length - 1]}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
