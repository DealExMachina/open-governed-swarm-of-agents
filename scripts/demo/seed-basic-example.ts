/**
 * Seed the Basic Example scope (default) with Acme Widgets tutorial docs.
 *
 * Usage: pnpm run seed:basic-example
 */
import "dotenv/config";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { appendEvent } from "../../src/contextWal.js";
import { createSwarmEvent } from "../../src/events.js";
import { makeEventBus } from "../../src/eventBus.js";
import { getPool } from "../../src/db.js";
import {
  BASIC_EXAMPLE_SCOPE,
  DEFAULT_CUSTOM_SCOPE_ID,
} from "../../src/scenarioScopes.js";
import { resetScopeAndReinit } from "../../src/scopeReset.js";
import { makeS3 } from "../../src/s3.js";
import { scopeStoragePrefix } from "../../src/scopeStorage.js";
import { ensureScenarioCatalogScope } from "../../src/studioCatalog.js";
import { requestRuntimeControl } from "../../src/runtimeControlRpc.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(__dirname, "..", "..", "demo", "scenario", "docs-basic-example");
const DELAY_MS = parseInt(process.env.DEMO_DELAY_MS ?? "8000", 10);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const scopeId = DEFAULT_CUSTOM_SCOPE_ID;
  const pool = getPool();

  await ensureScenarioCatalogScope({
    id: BASIC_EXAMPLE_SCOPE.scopeId,
    name: BASIC_EXAMPLE_SCOPE.name,
    tag: BASIC_EXAMPLE_SCOPE.tag,
  });
  console.log(`Resetting ${scopeId} (${BASIC_EXAMPLE_SCOPE.name})...`);
  const bucket = process.env.S3_BUCKET;
  await resetScopeAndReinit(pool, scopeId, {
    s3: bucket && process.env.S3_ENDPOINT ? makeS3() : undefined,
    bucket: bucket ?? undefined,
    storagePrefix: scopeStoragePrefix(scopeId),
  });

  const rpc = await requestRuntimeControl({
    action: "start",
    scope_id: scopeId,
    tenant_id: null,
  });
  if (!rpc.ok) {
    console.warn("Hatchery rebind skipped:", rpc.error);
  }

  const files = readdirSync(DOCS_DIR)
    .filter((f) => f.endsWith(".txt"))
    .sort();
  if (files.length === 0) {
    console.error(`No docs in ${DOCS_DIR}`);
    process.exit(1);
  }

  const bus = await makeEventBus();
  console.log(`\nBasic Example — seeding ${files.length} document(s) into ${scopeId}\n`);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const text = readFileSync(join(DOCS_DIR, file), "utf-8");
    const title = file.replace(".txt", "").replace(/-/g, " ").replace(/^\d+ /, "");
    const event = createSwarmEvent(
      "context_doc",
      { text, title, filename: file, source: "basic-example-seed", scope_id: scopeId },
      { source: "seed-basic-example" },
    );
    const seq = await appendEvent(event as unknown as Record<string, unknown>);
    await bus.publish("swarm.context", { seq, ...event });
    console.log(`  [${i + 1}/${files.length}] ${file} (seq ${seq})`);
    if (i < files.length - 1) await delay(DELAY_MS);
  }

  console.log("\nDone. Open Studio: http://localhost:3002/studio?scope_id=default");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
