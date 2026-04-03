/**
 * Describe the semantic graph and last run state for a scope.
 * Uses SCOPE_ID from env, or the most recently updated scope from swarm_state.
 *
 * Usage: pnpm exec tsx scripts/describe-scope-graph.ts [SCOPE_ID]
 *        SCOPE_ID=my-demo pnpm exec tsx scripts/describe-scope-graph.ts
 */
import "dotenv/config";
import { getPool } from "../src/db.js";
import { getKnowledgeState, getGraphSummary } from "../src/semanticGraph.js";

async function main(): Promise<void> {
  const scopeArg = process.argv[2];
  const scopeId = scopeArg ?? process.env.SCOPE_ID ?? null;

  const pool = getPool();

  let targetScope: string;
  if (scopeId) {
    targetScope = scopeId;
  } else {
    const res = await pool.query(
      `SELECT scope_id FROM swarm_state ORDER BY updated_at DESC NULLS LAST LIMIT 1`
    );
    if (!res.rows.length) {
      console.error("No scope found in swarm_state. Run a scope first or pass SCOPE_ID.");
      process.exit(1);
    }
    targetScope = String(res.rows[0].scope_id);
    console.log(`No SCOPE_ID set; using most recent scope: ${targetScope}\n`);
  }

  const [knowledge, graphSummary, stateRow, convRows, decRows, finRows] = await Promise.all([
    getKnowledgeState(targetScope),
    getGraphSummary(targetScope),
    pool.query(
      "SELECT run_id, last_node, epoch, updated_at FROM swarm_state WHERE scope_id = $1",
      [targetScope]
    ).then((r) => r.rows[0] ?? null),
    pool.query(
      `SELECT epoch, goal_score, lyapunov_v, dimension_scores, pressure, created_at
       FROM convergence_history WHERE scope_id = $1 ORDER BY epoch DESC LIMIT 20`,
      [targetScope]
    ).then((r) => r.rows ?? []),
    pool.query(
      `SELECT decision_id, result, governance_path, scope_mode, timestamp
       FROM decision_records WHERE scope_id = $1 ORDER BY timestamp DESC LIMIT 10`,
      [targetScope]
    ).then((r) => r.rows ?? []),
    pool.query(
      `SELECT option, days, created_at FROM scope_finality_decisions
       WHERE scope_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [targetScope]
    ).then((r) => r.rows ?? []),
  ]);

  console.log("=== Scope:", targetScope, "===\n");

  if (stateRow) {
    console.log("--- Last run state (swarm_state) ---");
    console.log("  run_id:", stateRow.run_id);
    console.log("  last_node:", stateRow.last_node);
    console.log("  epoch:", stateRow.epoch);
    console.log("  updated_at:", stateRow.updated_at);
    console.log();
  }

  console.log("--- Semantic graph summary (nodes / edges by type) ---");
  console.log("  Nodes:", JSON.stringify(graphSummary.nodes, null, 2).replace(/\n/g, "\n  "));
  console.log("  Edges:", JSON.stringify(graphSummary.edges, null, 2).replace(/\n/g, "\n  "));
  console.log();

  console.log("--- Knowledge state (counts) ---");
  console.log("  claims:", knowledge.counts.claims);
  console.log("  goals:", knowledge.counts.goals);
  console.log("  contradictions:", knowledge.counts.contradictions);
  console.log("  contradictions_resolved:", knowledge.counts.contradictions_resolved);
  console.log("  risks:", knowledge.counts.risks);
  console.log();

  if (knowledge.claims.length) {
    console.log("--- Claims (active) ---");
    knowledge.claims.slice(0, 15).forEach((c, i) => console.log(`  ${i + 1}. ${c.slice(0, 120)}${c.length > 120 ? "..." : ""}`));
    if (knowledge.claims.length > 15) console.log(`  ... and ${knowledge.claims.length - 15} more`);
    console.log();
  }
  if (knowledge.goals.length) {
    console.log("--- Goals ---");
    knowledge.goals.forEach((g, i) => console.log(`  ${i + 1}. ${g}`));
    console.log();
  }
  if (knowledge.contradictions.length) {
    console.log("--- Contradictions (open) ---");
    knowledge.contradictions.forEach((c, i) => console.log(`  ${i + 1}. ${c.slice(0, 100)}${c.length > 100 ? "..." : ""}`));
    console.log();
  }
  if (knowledge.risks.length) {
    console.log("--- Risks ---");
    knowledge.risks.slice(0, 10).forEach((r, i) => console.log(`  ${i + 1}. ${r.slice(0, 100)}${r.length > 100 ? "..." : ""}`));
    if (knowledge.risks.length > 10) console.log(`  ... and ${knowledge.risks.length - 10} more`);
    console.log();
  }

  if (convRows.length) {
    console.log("--- Last convergence points (epoch DESC) ---");
    convRows.slice(0, 10).forEach((r: Record<string, unknown>) => {
      console.log(`  epoch=${r.epoch} goal_score=${r.goal_score} lyapunov_v=${r.lyapunov_v} at ${r.created_at}`);
    });
    if (convRows.length > 10) console.log(`  ... and ${convRows.length - 10} more`);
    console.log();
  }

  if (decRows.length) {
    console.log("--- Last decisions ---");
    decRows.forEach((r: Record<string, unknown>) => {
      console.log(`  ${r.timestamp} ${r.result} path=${r.governance_path ?? "-"} mode=${r.scope_mode ?? "-"}`);
    });
    console.log();
  }

  if (finRows.length) {
    console.log("--- Last finality decisions ---");
    finRows.forEach((r: Record<string, unknown>) => {
      console.log(`  option=${r.option} days=${r.days ?? "-"} at ${r.created_at}`);
    });
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
