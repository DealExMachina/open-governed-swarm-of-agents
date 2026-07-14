#!/usr/bin/env tsx
/**
 * Analyze experiment results across multiple runs (batch).
 * Reads run-1..N subdirectories, computes aggregated statistics, writes summary.json.
 *
 * Usage:
 *   pnpm tsx scripts/analyze-experiment.ts <batch_dir>
 *   pnpm tsx scripts/analyze-experiment.ts docs/experiments/exp1/results/2026-02-28T...-batch-n3
 *
 * Output: <batch_dir>/summary.json with:
 *   - V(t) mean/std per epoch
 *   - Goal score mean/std per epoch
 *   - Convergence rate alpha mean/std
 *   - Gate satisfaction frequencies
 *   - Decision path distribution
 *   - Finality state distribution
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

interface ConvRow {
  epoch: number | string;
  goal_score: number;
  lyapunov_v: number;
  gate_a_monotonic: boolean | null;
  gate_b_evidence: boolean | null;
  gate_c_trajectory_ok: boolean | null;
  gate_d_quiescent: boolean | null;
  gate_e_has_content: boolean | null;
  finality_state: string | null;
  unresolved_contradictions: number | null;
  trajectory_quality: number | null;
}

interface DecisionRow {
  governance_path: string | null;
  scope_mode: string | null;
  result: string;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}

function computeAlpha(vSeries: number[]): number[] {
  const alphas: number[] = [];
  for (let i = 1; i < vSeries.length; i++) {
    const vPrev = vSeries[i - 1];
    const vCurr = vSeries[i];
    if (vPrev > 1e-10) {
      alphas.push(-Math.log(Math.max(vCurr / vPrev, 1e-10)));
    }
  }
  return alphas;
}

function main(): void {
  const batchDir = process.argv[2];
  if (!batchDir || !existsSync(batchDir)) {
    console.error("Usage: pnpm tsx scripts/analyze-experiment.ts <batch_dir>");
    process.exit(1);
  }

  const runDirs = readdirSync(batchDir)
    .filter((d) => d.startsWith("run-") && existsSync(join(batchDir, d, "convergence_history.json")))
    .sort();

  if (runDirs.length === 0) {
    console.error("No run-* subdirectories with convergence_history.json found in", batchDir);
    process.exit(1);
  }

  console.log(`Analyzing ${runDirs.length} runs in ${batchDir}`);

  // Collect per-run data
  const allConv: ConvRow[][] = [];
  const allDec: DecisionRow[][] = [];
  const allFinalityDecisions: Array<{ option?: string; scope_id?: string }[]> = [];

  for (const rd of runDirs) {
    const convPath = join(batchDir, rd, "convergence_history.json");
    const decPath = join(batchDir, rd, "decision_records.json");
    const finPath = join(batchDir, rd, "scope_finality_decisions.json");

    const conv: ConvRow[] = JSON.parse(readFileSync(convPath, "utf-8"));
    allConv.push(conv);

    if (existsSync(decPath)) {
      allDec.push(JSON.parse(readFileSync(decPath, "utf-8")));
    }
    if (existsSync(finPath)) {
      allFinalityDecisions.push(JSON.parse(readFileSync(finPath, "utf-8")));
    }
  }

  // ── V(t) and score per epoch ──────────────────────────────────────────────
  const allEpochs = new Set<number>();
  for (const conv of allConv) {
    for (const r of conv) allEpochs.add(Number(r.epoch));
  }
  const sortedEpochs = [...allEpochs].sort((a, b) => a - b);

  const epochStats: Array<{
    epoch: number;
    goal_score_mean: number;
    goal_score_std: number;
    v_mean: number;
    v_std: number;
    n: number;
  }> = [];

  for (const ep of sortedEpochs) {
    const scores: number[] = [];
    const vs: number[] = [];
    for (const conv of allConv) {
      const rows = conv.filter((r) => Number(r.epoch) === ep);
      if (rows.length > 0) {
        const lastRow = rows[rows.length - 1];
        scores.push(lastRow.goal_score);
        vs.push(lastRow.lyapunov_v);
      }
    }
    epochStats.push({
      epoch: ep,
      goal_score_mean: mean(scores),
      goal_score_std: std(scores),
      v_mean: mean(vs),
      v_std: std(vs),
      n: scores.length,
    });
  }

  // ── Alpha per run ─────────────────────────────────────────────────────────
  const alphasPerRun: number[][] = [];
  for (const conv of allConv) {
    const dedupByEpoch = new Map<number, ConvRow>();
    for (const r of conv) {
      dedupByEpoch.set(Number(r.epoch), r);
    }
    const sorted = [...dedupByEpoch.entries()].sort((a, b) => a[0] - b[0]);
    const vSeries = sorted.map(([, r]) => r.lyapunov_v);
    alphasPerRun.push(computeAlpha(vSeries));
  }
  const flatAlphas = alphasPerRun.flat();
  const alphaMean = mean(flatAlphas);
  const alphaStd = std(flatAlphas);

  // ── Gate frequencies ──────────────────────────────────────────────────────
  let totalGateRows = 0;
  const gateCounts = { a: 0, b: 0, c: 0, d: 0, e: 0 };
  const finalityStateCounts: Record<string, number> = {};

  for (const conv of allConv) {
    for (const r of conv) {
      if (r.gate_a_monotonic !== null) {
        totalGateRows++;
        if (r.gate_a_monotonic) gateCounts.a++;
        if (r.gate_b_evidence) gateCounts.b++;
        if (r.gate_c_trajectory_ok) gateCounts.c++;
        if (r.gate_d_quiescent) gateCounts.d++;
        if (r.gate_e_has_content) gateCounts.e++;
      }
      if (r.finality_state) {
        finalityStateCounts[r.finality_state] = (finalityStateCounts[r.finality_state] ?? 0) + 1;
      }
    }
  }

  const gateFrequencies = totalGateRows > 0
    ? {
        gate_a_monotonic: gateCounts.a / totalGateRows,
        gate_b_evidence: gateCounts.b / totalGateRows,
        gate_c_trajectory_ok: gateCounts.c / totalGateRows,
        gate_d_quiescent: gateCounts.d / totalGateRows,
        gate_e_has_content: gateCounts.e / totalGateRows,
        total_evaluations: totalGateRows,
      }
    : null;

  // ── Decision path distribution ────────────────────────────────────────────
  const pathCounts: Record<string, number> = {};
  const modeCounts: Record<string, number> = {};
  const resultCounts: Record<string, number> = {};
  let totalDecisions = 0;

  for (const decs of allDec) {
    for (const d of decs) {
      totalDecisions++;
      const p = d.governance_path ?? "null";
      const m = d.scope_mode ?? "null";
      pathCounts[p] = (pathCounts[p] ?? 0) + 1;
      modeCounts[m] = (modeCounts[m] ?? 0) + 1;
      resultCounts[d.result] = (resultCounts[d.result] ?? 0) + 1;
    }
  }

  // ── Finality decisions ────────────────────────────────────────────────────
  let totalFinalityDecisions = 0;
  const finalityOptionCounts: Record<string, number> = {};
  for (const fds of allFinalityDecisions) {
    for (const fd of fds) {
      totalFinalityDecisions++;
      const opt = fd.option ?? "unknown";
      finalityOptionCounts[opt] = (finalityOptionCounts[opt] ?? 0) + 1;
    }
  }

  // ── Build summary ─────────────────────────────────────────────────────────
  const summary = {
    n_runs: runDirs.length,
    convergence_trajectory: epochStats,
    alpha: {
      mean: alphaMean,
      std: alphaStd,
      per_run_means: alphasPerRun.map((a) => mean(a)),
    },
    gate_frequencies: gateFrequencies,
    finality_state_distribution: finalityStateCounts,
    decisions: {
      total: totalDecisions,
      per_run_mean: totalDecisions / runDirs.length,
      governance_path: pathCounts,
      scope_mode: modeCounts,
      result: resultCounts,
    },
    finality_decisions: {
      total: totalFinalityDecisions,
      options: finalityOptionCounts,
    },
  };

  const outPath = join(batchDir, "summary.json");
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`Summary written to ${outPath}`);

  // Print human-readable summary
  console.log("\n=== BATCH SUMMARY ===");
  console.log(`Runs: ${summary.n_runs}`);
  console.log(`\nConvergence trajectory (epoch: score mean +/- std | V mean +/- std):`);
  for (const e of epochStats) {
    if (e.n < 2) {
      console.log(`  epoch ${e.epoch}: score=${e.goal_score_mean.toFixed(3)} V=${e.v_mean.toFixed(3)} (n=${e.n})`);
    } else {
      console.log(
        `  epoch ${e.epoch}: score=${e.goal_score_mean.toFixed(3)} +/- ${e.goal_score_std.toFixed(3)} | V=${e.v_mean.toFixed(3)} +/- ${e.v_std.toFixed(3)} (n=${e.n})`,
      );
    }
  }
  console.log(`\nAlpha: ${alphaMean.toFixed(4)} +/- ${alphaStd.toFixed(4)}`);
  if (gateFrequencies) {
    console.log(`\nGate satisfaction (% of ${totalGateRows} evaluations):`);
    console.log(`  A (monotonic):   ${(gateFrequencies.gate_a_monotonic * 100).toFixed(1)}%`);
    console.log(`  B (evidence):    ${(gateFrequencies.gate_b_evidence * 100).toFixed(1)}%`);
    console.log(`  C (trajectory):  ${(gateFrequencies.gate_c_trajectory_ok * 100).toFixed(1)}%`);
    console.log(`  D (quiescent):   ${(gateFrequencies.gate_d_quiescent * 100).toFixed(1)}%`);
    console.log(`  E (content):     ${(gateFrequencies.gate_e_has_content * 100).toFixed(1)}%`);
  }
  console.log(`\nFinality states: ${JSON.stringify(finalityStateCounts)}`);
  console.log(`Decisions: ${totalDecisions} total, paths: ${JSON.stringify(pathCounts)}`);
}

main();
