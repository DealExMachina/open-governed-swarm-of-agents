/**
 * Seed the context WAL with the Project Horizon M&A demo documents.
 *
 * Feeds documents one at a time with a configurable delay between each,
 * so the swarm can process each document before the next arrives. This
 * produces observable governance events, drift transitions, and finality
 * progression in sequence — useful for live demos.
 *
 * Document set comes from the S1 manifest (docs/benchmarks/manifests/s1-project-horizon.yaml),
 * not a directory scan — so a stray .txt file left in demo/scenario/docs/ can never get fed
 * into a "Project Horizon" run without being deliberately added to that manifest first.
 *
 * Usage:
 *   pnpm run seed:demo                                    # deal-horizon, 20s gap
 *   DEMO_SCOPE_ID=default DEMO_DELAY_MS=5000 pnpm run seed:demo
 *   DEMO_DOC=01 pnpm run seed:demo                          # single doc by prefix
 *
 * After seeding, check the feed at http://localhost:3002 or GET /summary.
 */
import "dotenv/config";
import { basename } from "path";
import { S3Client } from "@aws-sdk/client-s3";
import { appendEvent } from "../src/contextWal.js";
import { createSwarmEvent } from "../src/events.js";
import { makeEventBus } from "../src/eventBus.js";
import { getPool } from "../src/db.js";
import { resetScopeAndReinit } from "../src/scopeReset.js";
import { scopeStoragePrefix } from "../src/scopeStorage.js";
import { DEFAULT_DEMO_MA_SCOPE_ID } from "../src/scenarioScopes.js";
import { requestRuntimeControl } from "../src/runtimeControlRpc.js";
import { loadAllDocuments } from "../src/baselines/scenario/ma-scenario.js";

const DELAY_MS = parseInt(process.env.DEMO_DELAY_MS ?? "20000", 10);
const SINGLE_DOC = process.env.DEMO_DOC ?? "";
const RESET_BEFORE_SEED = process.env.DEMO_RESET_BEFORE_SEED ?? "1";
const DEMO_SCOPE_ID = process.env.DEMO_SCOPE_ID ?? DEFAULT_DEMO_MA_SCOPE_ID;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resetDemoScope(scopeId: string): Promise<void> {
  const s3Endpoint = process.env.S3_ENDPOINT;
  const s3Bucket = process.env.S3_BUCKET ?? "swarm";
  let s3: S3Client | undefined;
  if (s3Endpoint) {
    s3 = new S3Client({
      region: process.env.S3_REGION || "us-east-1",
      endpoint: s3Endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? "minioadmin",
        secretAccessKey: process.env.S3_SECRET_KEY ?? "minioadmin",
      },
    });
  }
  try {
    await resetScopeAndReinit(getPool(), scopeId, {
      s3,
      bucket: s3 ? s3Bucket : undefined,
      storagePrefix: scopeStoragePrefix(scopeId),
    });
  } finally {
    s3?.destroy();
  }
}

async function main(): Promise<void> {
  if (!DEMO_SCOPE_ID) {
    console.error("DEMO_SCOPE_ID is required (strict scope isolation).");
    process.exit(1);
  }
  if (RESET_BEFORE_SEED === "1") {
    console.log(
      `Resetting scope "${DEMO_SCOPE_ID}" before seeding (DEMO_RESET_BEFORE_SEED=1)...`,
    );
    await resetDemoScope(DEMO_SCOPE_ID);
  } else {
    console.log(`Skipping reset before seeding (DEMO_RESET_BEFORE_SEED=${RESET_BEFORE_SEED}).`);
  }

  const rpc = await requestRuntimeControl({
    action: "start",
    scope_id: DEMO_SCOPE_ID,
    tenant_id: null,
  });
  if (!rpc.ok) {
    console.warn(
      `Warning: could not bind hatchery to ${DEMO_SCOPE_ID}: ${rpc.error ?? "unknown"}`,
    );
    console.warn("  Start hatchery: pnpm run swarm:start");
  }

  const allDocs = loadAllDocuments(); // S1 manifest, in epoch order

  const docs = SINGLE_DOC
    ? allDocs.filter((d) => basename(d.path).startsWith(SINGLE_DOC))
    : allDocs;

  if (docs.length === 0) {
    console.error(
      `No matching documents in the S1 manifest (filter: "${SINGLE_DOC || "*"}")`,
    );
    process.exit(1);
  }

  const bus = await makeEventBus();

  console.log(`\nProject Horizon — M&A Demo Seed`);
  console.log(`Scope: ${DEMO_SCOPE_ID}`);
  console.log(
    `Feeding ${docs.length} document(s) from the S1 manifest (docs/benchmarks/manifests/s1-project-horizon.yaml)`,
  );
  console.log(`Delay between documents: ${DELAY_MS}ms\n`);

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const file = basename(doc.path);
    const text = doc.text;
    const title = doc.title;

    const event = createSwarmEvent(
      "context_doc",
      { text, title, filename: file, source: "demo-seed", scope_id: DEMO_SCOPE_ID },
      { source: "seed-demo" },
    );

    const seq = await appendEvent(event as unknown as Record<string, unknown>);
    await bus.publishEvent(event);

    console.log(`[${i + 1}/${docs.length}] ${file}`);
    console.log(`       title : ${title}`);
    console.log(`       seq   : ${seq}`);
    console.log(`       chars : ${text.length}`);
    console.log(`       time  : ${new Date().toISOString()}`);

    if (i < docs.length - 1) {
      console.log(`\n  Waiting ${DELAY_MS / 1000}s before next document (let agents process)...\n`);
      await delay(DELAY_MS);
    }
  }

  await bus.close();

  console.log(`\nAll documents seeded.`);
  console.log(`Check http://localhost:3002/summary?scope_id=${DEMO_SCOPE_ID}`);
  console.log(`Check http://localhost:3001/pending?scope_id=${DEMO_SCOPE_ID} for pending HITL reviews.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
