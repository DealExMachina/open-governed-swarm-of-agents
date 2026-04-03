/**
 * Collect experiment results from DB to docs/experiments/<exp>/results/<timestamp>/.
 *
 * Usage:
 *   pnpm tsx scripts/collect-experiment-results.ts <exp_id> [output_dir]
 *
 * Exports: convergence_history.json (includes dimension_scores, gate columns for vector finality),
 * decision_records.json, scope_finality_decisions.json, context_events.json (sample), metadata.json.
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

async function collectSkillsMetrics(pool: Awaited<ReturnType<typeof getPool>>): Promise<Record<string, unknown>> {
  const scopeId = process.env.SCOPE_ID ?? "default";
  const [
    hitlReviewRes,
    finalityEvalRes,
    resolverEventsRes,
    contradictionNodesRes,
    resolvedNodesRes,
    finalityDecisionsRes,
  ] = await Promise.all([
    pool.query(
      "SELECT COUNT(*)::int as c FROM context_events WHERE data->>'type' = 'finality_review_submitted'",
    ),
    pool.query(
      "SELECT COUNT(*)::int as c FROM context_events WHERE data->>'type' IN ('finality_decided', 'finality_review_submitted', 'finality_evaluated')",
    ),
    pool.query(
      "SELECT data FROM context_events WHERE data->>'type' = 'contradictions_resolved' ORDER BY ts",
    ),
    pool.query(
      "SELECT COUNT(*)::int as c FROM nodes WHERE scope_id = $1 AND type = 'contradiction' AND status = 'active'",
      [scopeId],
    ),
    pool.query(
      "SELECT COUNT(*)::int as c FROM nodes WHERE scope_id = $1 AND type = 'contradiction' AND status = 'resolved'",
      [scopeId],
    ),
    pool.query(
      "SELECT * FROM scope_finality_decisions WHERE scope_id = $1 ORDER BY created_at",
      [scopeId],
    ),
  ]);

  const hitlReviewCount = hitlReviewRes.rows[0]?.c ?? 0;
  const finalityEvalCount = Math.max(finalityEvalRes.rows[0]?.c ?? 0, 1);
  const hitlTriggerRate = hitlReviewCount / finalityEvalCount;

  let resolverConfirmed = 0;
  let resolverResolved = 0;
  let resolverNoise = 0;
  for (const row of resolverEventsRes.rows ?? []) {
    const data = (row as { data: Record<string, unknown> }).data;
    resolverConfirmed += Number(data?.confirmed ?? 0);
    resolverResolved += Number(data?.resolved ?? 0);
    resolverNoise += Number(data?.noise ?? 0);
  }

  return {
    correctness: {
      hitl_reviews_queued: hitlReviewCount,
      finality_evaluations: finalityEvalCount,
      hitl_trigger_rate: hitlTriggerRate,
      resolver_confirmed: resolverConfirmed,
      resolver_resolved: resolverResolved,
      resolver_noise: resolverNoise,
      active_contradictions: contradictionNodesRes.rows[0]?.c ?? 0,
      resolved_contradictions: resolvedNodesRes.rows[0]?.c ?? 0,
      finality_decisions: finalityDecisionsRes.rows ?? [],
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

  const [convRes, decRes, finRes, eventsRes, compRes, propRes, evidRes] = await Promise.all([
    pool.query("SELECT * FROM convergence_history ORDER BY scope_id, epoch"),
    pool.query("SELECT * FROM decision_records ORDER BY timestamp"),
    pool.query("SELECT * FROM scope_finality_decisions ORDER BY scope_id, created_at"),
    pool.query(
      "SELECT seq, ts, data FROM context_events WHERE data->>'type' IN ('proposal_approved','proposal_rejected','proposal_pending_approval','finality_decided') ORDER BY ts LIMIT 500",
    ),
    pool.query(
      "SELECT seq, ts, data FROM context_events WHERE data->>'type' = 'compensation_detected' ORDER BY ts",
    ),
    pool.query("SELECT * FROM propagation_history ORDER BY scope_id, epoch"),
    pool.query("SELECT * FROM evidence_states ORDER BY scope_id, epoch, role_id"),
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
      compensation_events: compRes.rowCount ?? 0,
      propagation_history: propRes.rowCount ?? 0,
      evidence_states: evidRes.rowCount ?? 0,
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

  if ((compRes.rowCount ?? 0) > 0) {
    writes.push(
      writeFile(
        join(base, "compensation_events.json"),
        JSON.stringify(compRes.rows ?? [], null, 2),
      ),
    );
  }

  writes.push(
    writeFile(join(base, "propagation_history.json"), JSON.stringify(propRes.rows ?? [], null, 2)),
    writeFile(join(base, "evidence_states.json"), JSON.stringify(evidRes.rows ?? [], null, 2)),
  );

  if (expId === "exp-load") {
    const loadMetrics = await collectLoadMetrics(pool);
    writes.push(writeFile(join(base, "load_metrics.json"), JSON.stringify(loadMetrics, null, 2)));
  }

  if (expId === "exp-skills") {
    const skillsMetrics = await collectSkillsMetrics(pool);
    writes.push(writeFile(join(base, "skills_metrics.json"), JSON.stringify(skillsMetrics, null, 2)));
  }

  await Promise.all(writes);

  return base;
}

// ---------------------------------------------------------------------------
// Aggregation and comparison utilities
// ---------------------------------------------------------------------------

export interface TimeseriesMetric {
  timestamp: string;
  value: number;
}

/**
 * Compute min, max, mean, stddev for a metric from timeseries data.
 */
export function aggregateTimeseries(
  timeseries: TimeseriesMetric[],
): {
  count: number;
  min: number;
  max: number;
  mean: number;
  stddev: number;
} {
  if (timeseries.length === 0) {
    return { count: 0, min: 0, max: 0, mean: 0, stddev: 0 };
  }

  const values = timeseries.map((t) => t.value);
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, x) => sum + (x - m) ** 2, 0) / values.length;

  return {
    count: values.length,
    min,
    max,
    mean: m,
    stddev: Math.sqrt(variance),
  };
}

/**
 * Detect regressions by comparing metric values between runs.
 * Returns true if current value is significantly worse than baseline.
 */
export function isRegression(
  baseline: number,
  current: number,
  threshold_percent: number = 5,
): boolean {
  if (baseline === 0) return false;
  const delta_percent = Math.abs((current - baseline) / baseline) * 100;
  return delta_percent > threshold_percent && current > baseline;
}

/**
 * Compute summary statistics from result rows (convergence history, etc).
 * Expects rows with 'epoch' or 'ts' field and numeric metric columns.
 */
export function summarizeResults(
  rows: Array<Record<string, unknown>>,
  metricKeys: string[],
): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    total_rows: rows.length,
  };

  for (const key of metricKeys) {
    const values = rows
      .map((r) => r[key])
      .filter((v) => typeof v === "number") as number[];

    if (values.length > 0) {
      const sorted = [...values].sort((a, b) => a - b);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance =
        values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / values.length;

      summary[key] = {
        count: values.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        mean: parseFloat(mean.toFixed(4)),
        stddev: parseFloat(Math.sqrt(variance).toFixed(4)),
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
      };
    }
  }

  return summary;
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
