/**
 * Collect experiment results from DB to docs/experiments/<exp>/results/<timestamp>/.
 *
 * Usage:
 *   pnpm tsx scripts/collect-experiment-results.ts <exp_id> [output_dir]
 *
 * Exports: convergence_history.json, decision_records.json, scope_finality_decisions.json,
 * context_events.json (sample), metadata.json (run params, timestamp).
 *
 * For exp-load: also exports load_metrics.json (state graph, progression, finality).
 * Env: LOAD_RUN_ID, LOAD_INJECTION, LOAD_GRAPH, LOAD_SCALING, LOAD_DURATION.
 *
 * If output_dir omitted, uses docs/experiments/<exp_id>/results/<timestamp>/.
 */
import "dotenv/config";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { getPool } from "../src/db.js";

async function collectLoadMetrics(pool: Awaited<ReturnType<typeof getPool>>): Promise<Record<string, unknown>> {
  const [
    bootstrapRes,
    transitionsRes,
    casRejectRes,
    approvedRes,
    rejectedRes,
    firstLastRes,
    convRes,
    finRes,
  ] = await Promise.all([
    pool.query(
      "SELECT ts FROM context_events WHERE data->>'type' = 'bootstrap' ORDER BY ts ASC LIMIT 1",
    ),
    pool.query(
      "SELECT seq, ts FROM context_events WHERE data->>'type' = 'state_transition' ORDER BY ts",
    ),
    pool.query(
      "SELECT COUNT(*)::int as c FROM context_events WHERE data->>'type' = 'proposal_rejected' AND data->>'reason' = 'state_epoch_mismatch'",
    ),
    pool.query(
      "SELECT COUNT(*)::int as c FROM context_events WHERE data->>'type' = 'proposal_approved'",
    ),
    pool.query(
      "SELECT COUNT(*)::int as c FROM context_events WHERE data->>'type' = 'proposal_rejected'",
    ),
    pool.query(
      "SELECT MIN(ts) as first_ts, MAX(ts) as last_ts FROM context_events WHERE data->>'type' = 'state_transition'",
    ),
    pool.query(
      "SELECT epoch, goal_score, lyapunov_v, created_at FROM convergence_history WHERE scope_id = $1 ORDER BY epoch",
      [process.env.SCOPE_ID ?? "default"],
    ),
    pool.query(
      "SELECT scope_id, option, created_at FROM scope_finality_decisions ORDER BY created_at DESC LIMIT 1",
    ),
  ]);

  const bootstrapTs = bootstrapRes.rows[0]?.ts;
  const transitions = transitionsRes.rows ?? [];
  const firstTransition = firstLastRes.rows[0]?.first_ts;
  const casRejections = casRejectRes.rows[0]?.c ?? 0;
  const proposalsApproved = approvedRes.rows[0]?.c ?? 0;
  const proposalsRejected = rejectedRes.rows[0]?.c ?? 0;
  const convHistory = (convRes.rows ?? []) as Array<{ epoch: number; goal_score: number; lyapunov_v: number }>;
  const durationS = process.env.LOAD_DURATION ? parseInt(process.env.LOAD_DURATION, 10) : null;

  let vMonotonicityViolations = 0;
  for (let i = 1; i < convHistory.length; i++) {
    if (convHistory[i].lyapunov_v > convHistory[i - 1].lyapunov_v) vMonotonicityViolations++;
  }

  const epochMax = convHistory.length > 0 ? Math.max(...convHistory.map((r) => r.epoch)) : 0;
  const cyclesCompleted = Math.floor(transitions.length / 3);
  const durationMinutes = durationS ? durationS / 60 : null;

  return {
    state_graph: {
      cas_rejections: casRejections,
      proposals_approved: proposalsApproved,
      proposals_rejected: proposalsRejected,
      state_transitions_count: transitions.length,
      epoch_max: epochMax,
    },
    progression: {
      bootstrap_to_first_transition_ms:
        bootstrapTs && firstTransition
          ? new Date(firstTransition).getTime() - new Date(bootstrapTs).getTime()
          : null,
      first_transition_ts: firstTransition ?? null,
      last_transition_ts: firstLastRes.rows[0]?.last_ts ?? null,
      cycles_completed: cyclesCompleted,
      cycles_per_min: durationMinutes ? cyclesCompleted / durationMinutes : null,
    },
    finality: {
      convergence_history_rows: convHistory.length,
      v_monotonicity_violations: vMonotonicityViolations,
      final_decision: (finRes.rows?.[0] as { option?: string })?.option ?? null,
    },
    run_params: {
      injection: process.env.LOAD_INJECTION,
      graph: process.env.LOAD_GRAPH,
      scaling: process.env.LOAD_SCALING,
      duration_s: durationS,
    },
  };
}

async function collect(
  expId: string,
  outputDir?: string,
): Promise<string> {
  const runId = process.env.LOAD_RUN_ID;
  const ts = runId
    ? runId
    : new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base =
    outputDir ?? join(process.cwd(), "docs", "experiments", expId, "results", ts);
  await mkdir(base, { recursive: true });

  const pool = getPool();

  const [convRes, decRes, finRes, eventsRes] = await Promise.all([
    pool.query("SELECT * FROM convergence_history ORDER BY scope_id, epoch"),
    pool.query("SELECT * FROM decision_records ORDER BY timestamp"),
    pool.query("SELECT * FROM scope_finality_decisions ORDER BY scope_id, created_at"),
    pool.query(
      "SELECT seq, ts, data FROM context_events WHERE data->>'type' IN ('proposal_approved','proposal_rejected','proposal_pending_approval','finality_decided') ORDER BY ts LIMIT 500",
    ),
  ]);

  const adversarialMode = process.env.ADVERSARIAL_MODE ?? null;
  const metadata = {
    exp_id: expId,
    collected_at: new Date().toISOString(),
    load_run_id: runId ?? null,
    adversarial_mode: adversarialMode,
    label: adversarialMode ? `exp8-${adversarialMode}` : null,
    env: {
      SCOPE_ID: process.env.SCOPE_ID ?? "default",
      GOVERNANCE_MODE: process.env.GOVERNANCE_MODE ?? null,
      ADVERSARIAL_MODE: adversarialMode,
      LOAD_INJECTION: process.env.LOAD_INJECTION,
      LOAD_GRAPH: process.env.LOAD_GRAPH,
      LOAD_SCALING: process.env.LOAD_SCALING,
    },
    counts: {
      convergence_history: convRes.rowCount ?? 0,
      decision_records: decRes.rowCount ?? 0,
      scope_finality_decisions: finRes.rowCount ?? 0,
      context_events_sampled: eventsRes.rowCount ?? 0,
    },
  };

  const writes: Promise<void>[] = [
    writeFile(join(base, "metadata.json"), JSON.stringify(metadata, null, 2)),
    writeFile(join(base, "convergence_history.json"), JSON.stringify(convRes.rows ?? [], null, 2)),
    writeFile(join(base, "decision_records.json"), JSON.stringify(decRes.rows ?? [], null, 2)),
    writeFile(
      join(base, "scope_finality_decisions.json"),
      JSON.stringify(finRes.rows ?? [], null, 2),
    ),
    writeFile(
      join(base, "context_events_sample.json"),
      JSON.stringify(eventsRes.rows ?? [], null, 2),
    ),
  ];

  if (expId === "exp-load") {
    const loadMetrics = await collectLoadMetrics(pool);
    writes.push(writeFile(join(base, "load_metrics.json"), JSON.stringify(loadMetrics, null, 2)));
  }

  await Promise.all(writes);

  return base;
}

async function main(): Promise<void> {
  const expId = process.argv[2] ?? "exp1";
  const outputDir = process.argv[3];

  const dir = await collect(expId, outputDir);
  console.log("Results written to:", dir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
