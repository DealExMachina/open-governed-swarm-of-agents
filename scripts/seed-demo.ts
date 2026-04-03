/**
 * Seed the context WAL with the Project Horizon M&A demo documents.
 *
 * Feeds documents one at a time with a configurable delay between each,
 * so the swarm can process each document before the next arrives. This
 * produces observable governance events, drift transitions, and finality
 * progression in sequence — useful for live demos.
 *
 * Usage:
 *   DEMO_SCOPE_ID=default pnpm run seed:demo                        # all docs in scenario/docs, 20s gap
 *   DEMO_SCOPE_ID=default DEMO_DELAY_MS=5000 pnpm run seed:demo     # faster (5s gap, less visible processing)
 *   DEMO_SCOPE_ID=default DEMO_DOC=01 pnpm run seed:demo            # single doc by prefix
 *
 * After seeding, check the feed at http://localhost:3002 or GET /summary.
 */
import "dotenv/config";
import { execSync } from "child_process";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { appendEvent } from "../src/contextWal.js";
import { createSwarmEvent } from "../src/events.js";
import { makeEventBus } from "../src/eventBus.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const DEMO_DOCS_DIR = join(__dirname, "..", "demo", "scenario", "docs");
const DELAY_MS = parseInt(process.env.DEMO_DELAY_MS ?? "20000", 10);
const SINGLE_DOC = process.env.DEMO_DOC ?? "";
const RESET_BEFORE_SEED = process.env.DEMO_RESET_BEFORE_SEED ?? "1";
const DEMO_SCOPE_ID = process.env.DEMO_SCOPE_ID ?? "";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  if (!DEMO_SCOPE_ID) {
    console.error("DEMO_SCOPE_ID is required (strict scope isolation).");
    process.exit(1);
  }
  if (RESET_BEFORE_SEED === "1") {
    console.log("Resetting demo state before seeding (DEMO_RESET_BEFORE_SEED=1)...");
    execSync("pnpm run reset-e2e", { cwd: REPO_ROOT, stdio: "inherit" });
  } else {
    console.log(`Skipping reset before seeding (DEMO_RESET_BEFORE_SEED=${RESET_BEFORE_SEED}).`);
  }

  const allFiles = readdirSync(DEMO_DOCS_DIR)
    .filter((f) => f.endsWith(".txt"))
    .sort();

  const files = SINGLE_DOC
    ? allFiles.filter((f) => f.startsWith(SINGLE_DOC))
    : allFiles;

  if (files.length === 0) {
    console.error(`No matching .txt files in ${DEMO_DOCS_DIR} (filter: "${SINGLE_DOC || "*"}")`);
    process.exit(1);
  }

  const bus = await makeEventBus();

  console.log(`\nProject Horizon — M&A Demo Seed`);
  console.log(`Feeding ${files.length} document(s) from ${DEMO_DOCS_DIR}`);
  console.log(`Delay between documents: ${DELAY_MS}ms\n`);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = join(DEMO_DOCS_DIR, file);
    const text = readFileSync(filePath, "utf-8");
    const title = file.replace(".txt", "").replace(/-/g, " ").replace(/^\d+ /, "");

    const event = createSwarmEvent(
      "context_doc",
      { text, title, filename: file, source: "demo-seed", scope_id: DEMO_SCOPE_ID },
      { source: "seed-demo" },
    );

    const seq = await appendEvent(event as unknown as Record<string, unknown>);
    await bus.publishEvent(event);

    console.log(`[${i + 1}/${files.length}] ${file}`);
    console.log(`       title : ${title}`);
    console.log(`       seq   : ${seq}`);
    console.log(`       chars : ${text.length}`);
    console.log(`       time  : ${new Date().toISOString()}`);

    if (i < files.length - 1) {
      console.log(`\n  Waiting ${DELAY_MS / 1000}s before next document (let agents process)...\n`);
      await delay(DELAY_MS);
    }
  }

  await bus.close();

  console.log(`\nAll documents seeded.`);
  console.log(`Check http://localhost:3002 for live events and summary.`);
  console.log(`Check http://localhost:3001/pending for pending HITL reviews.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
