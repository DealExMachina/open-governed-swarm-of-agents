/**
 * One-shot cleanup: remove ephemeral E2E scopes and reinit scenario catalog scopes.
 *
 * Usage: pnpm run reinit:scenario-scopes
 */
import "dotenv/config";
import { getPool } from "../../src/db.js";
import {
  ALL_SCENARIO_SCOPE_IDS,
  DEFAULT_CUSTOM_SCOPE_ID,
} from "../../src/scenarioScopes.js";
import { reinitAllScenarioScopes } from "../../src/studioScopeReinit.js";

async function countNodes(scopeId: string): Promise<number> {
  const r = await getPool().query(
    `SELECT count(*)::int AS n FROM nodes WHERE scope_id = $1`,
    [scopeId],
  );
  return Number(r.rows[0]?.n ?? 0);
}

async function main(): Promise<void> {
  const pool = getPool();

  console.log("=== Before ===");
  const before = await pool.query(
    `SELECT scope_id, count(*)::int AS n FROM nodes GROUP BY scope_id ORDER BY scope_id`,
  );
  for (const row of before.rows) {
    console.log(`  ${row.scope_id}: ${row.n} nodes`);
  }

  const { removed_ephemeral, reset_scopes } = await reinitAllScenarioScopes(pool);
  for (const id of removed_ephemeral) {
    console.log(`Removed ephemeral scope ${id}`);
  }
  for (const id of reset_scopes) {
    console.log(`Reinit scope ${id}`);
  }

  console.log("\n=== After ===");
  for (const scopeId of [...ALL_SCENARIO_SCOPE_IDS, DEFAULT_CUSTOM_SCOPE_ID]) {
    const n = await countNodes(scopeId);
    const cat = await pool.query(
      `SELECT state, score FROM studio_catalog_scopes WHERE id = $1`,
      [scopeId],
    );
    const row = cat.rows[0] as { state?: string; score?: number } | undefined;
    console.log(
      `  ${scopeId}: ${n} nodes, catalog state=${row?.state ?? "?"} score=${row?.score ?? "?"}`,
    );
  }

  const leftover = await pool.query(
    `SELECT scope_id, count(*)::int AS n FROM nodes GROUP BY scope_id ORDER BY scope_id`,
  );
  if (leftover.rows.length > 0) {
    console.log("\nRemaining node partitions:");
    for (const row of leftover.rows) {
      console.log(`  ${row.scope_id}: ${row.n}`);
    }
  } else {
    console.log("\nNo node partitions remain.");
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
