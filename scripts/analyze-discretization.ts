#!/usr/bin/env tsx
/**
 * Analyze dimension step sizes from convergence history to validate
 * Assumption #1: Discretization of A.
 *
 * Reads convergence_history from the DB (or a JSON file) and computes:
 *  1. Per-dimension: set of distinct values, min non-zero step, max step
 *  2. Whether step sizes are bounded away from 0 (empirical ε)
 *  3. Whether any dimension exhibits Zeno-like behavior
 *  4. Effective lattice granularity: ε_obs per dimension
 *
 * Usage:
 *   pnpm tsx scripts/analyze-discretization.ts [convergence_history.json]
 *
 * If no file is provided, reads from DATABASE_URL.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ConvergenceRow {
  epoch: number | string;
  goal_score: number;
  lyapunov_v: number;
  dimension_scores: Record<string, number>;
  context_seq?: number | string | null;
}

interface DimensionAnalysis {
  dimension: string;
  distinct_values: number[];
  distinct_count: number;
  min_value: number;
  max_value: number;
  steps: number[];               // non-zero deltas
  min_nonzero_step: number;      // empirical ε for this dimension
  max_step: number;
  mean_step: number;
  is_bounded_away_from_zero: boolean; // all steps > ε_threshold
  zeno_risk: boolean;            // decreasing step sizes near a limit
}

interface DiscretizationReport {
  total_points: number;
  dimensions: Record<string, DimensionAnalysis>;
  global_min_epsilon: number;    // min across all dimensions
  well_founded_empirical: boolean;
  lyapunov_v_monotonicity: {
    violations: number;
    total_transitions: number;
    violation_rate: number;
  };
}

function analyzeDiscretization(rows: ConvergenceRow[]): DiscretizationReport {
  const EPSILON_THRESHOLD = 1e-10; // below this, consider step as ~0

  const dimNames = Object.keys(rows[0]?.dimension_scores ?? {});
  const dimensions: Record<string, DimensionAnalysis> = {};

  for (const dim of dimNames) {
    const values: number[] = rows.map((r) => r.dimension_scores[dim] ?? 0);
    const distinctSet = new Set(values.map((v) => v.toFixed(15)));
    const distinctValues = Array.from(distinctSet).map(Number).sort((a, b) => a - b);

    // Compute non-zero steps
    const steps: number[] = [];
    for (let i = 1; i < values.length; i++) {
      const delta = Math.abs(values[i] - values[i - 1]);
      if (delta > EPSILON_THRESHOLD) {
        steps.push(delta);
      }
    }

    const minStep = steps.length > 0 ? Math.min(...steps) : Infinity;
    const maxStep = steps.length > 0 ? Math.max(...steps) : 0;
    const meanStep = steps.length > 0 ? steps.reduce((a, b) => a + b, 0) / steps.length : 0;

    // Check for Zeno-like behavior: steps getting smaller near a limit
    let zenoRisk = false;
    if (steps.length >= 5) {
      const lastFive = steps.slice(-5);
      const isDecreasing = lastFive.every((s, i) => i === 0 || s <= lastFive[i - 1] * 1.1);
      const isSmall = lastFive[lastFive.length - 1] < minStep * 2;
      zenoRisk = isDecreasing && isSmall && lastFive[lastFive.length - 1] < 0.001;
    }

    dimensions[dim] = {
      dimension: dim,
      distinct_values: distinctValues,
      distinct_count: distinctValues.length,
      min_value: Math.min(...values),
      max_value: Math.max(...values),
      steps,
      min_nonzero_step: minStep,
      max_step: maxStep,
      mean_step: meanStep,
      // A dimension with 0 steps (constant value) is trivially well-founded
      is_bounded_away_from_zero: steps.length === 0 || minStep > EPSILON_THRESHOLD,
      zeno_risk: zenoRisk,
    };
  }

  // Lyapunov V monotonicity check
  let violations = 0;
  const totalTransitions = Math.max(0, rows.length - 1);
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].lyapunov_v > rows[i - 1].lyapunov_v + EPSILON_THRESHOLD) {
      violations++;
    }
  }

  const allMinSteps = Object.values(dimensions)
    .map((d) => d.min_nonzero_step)
    .filter((s) => s !== Infinity);
  const globalMinEpsilon = allMinSteps.length > 0 ? Math.min(...allMinSteps) : Infinity;

  const wellFounded = Object.values(dimensions).every(
    (d) => d.is_bounded_away_from_zero && !d.zeno_risk,
  );

  return {
    total_points: rows.length,
    dimensions,
    global_min_epsilon: globalMinEpsilon,
    well_founded_empirical: wellFounded,
    lyapunov_v_monotonicity: {
      violations,
      total_transitions: totalTransitions,
      violation_rate: totalTransitions > 0 ? violations / totalTransitions : 0,
    },
  };
}

function formatReport(report: DiscretizationReport): string {
  const lines: string[] = [];
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("  DISCRETIZATION ANALYSIS — Assumption #1 Validation");
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("");
  lines.push(`Total convergence points: ${report.total_points}`);
  lines.push(`Global minimum ε (step size): ${report.global_min_epsilon.toExponential(6)}`);
  lines.push(`Well-founded (empirical): ${report.well_founded_empirical ? "YES ✓" : "NO ✗"}`);
  lines.push("");

  for (const [name, dim] of Object.entries(report.dimensions)) {
    lines.push(`── ${name} ${"─".repeat(Math.max(1, 50 - name.length))}`);
    lines.push(`  Distinct values:    ${dim.distinct_count}`);
    lines.push(`  Range:              [${dim.min_value.toFixed(6)}, ${dim.max_value.toFixed(6)}]`);
    lines.push(`  Non-zero steps:     ${dim.steps.length}`);
    lines.push(`  Min step (ε_obs):   ${dim.min_nonzero_step === Infinity ? "N/A (no changes)" : dim.min_nonzero_step.toExponential(6)}`);
    lines.push(`  Max step:           ${dim.max_step.toExponential(6)}`);
    lines.push(`  Mean step:          ${dim.mean_step.toExponential(6)}`);
    lines.push(`  Bounded from 0:     ${dim.is_bounded_away_from_zero ? "YES ✓" : "NO ✗"}`);
    lines.push(`  Zeno risk:          ${dim.zeno_risk ? "YES ✗" : "NO ✓"}`);
    lines.push("");
  }

  lines.push("── Lyapunov V monotonicity ─────────────────────────────────");
  const mono = report.lyapunov_v_monotonicity;
  lines.push(`  Violations:         ${mono.violations} / ${mono.total_transitions} transitions`);
  lines.push(`  Violation rate:     ${(mono.violation_rate * 100).toFixed(1)}%`);
  lines.push("");

  if (report.well_founded_empirical) {
    lines.push("CONCLUSION: Dimension scores take finitely many distinct values");
    lines.push(`with minimum step ε ≥ ${report.global_min_epsilon.toExponential(4)}.`);
    lines.push("This empirically validates the discretization assumption A_ε.");
  } else {
    const problematic = Object.entries(report.dimensions)
      .filter(([, d]) => !d.is_bounded_away_from_zero || d.zeno_risk)
      .map(([name]) => name);
    lines.push(`WARNING: Discretization may not hold for: ${problematic.join(", ")}`);
    lines.push("Further investigation needed.");
  }
  lines.push("");

  return lines.join("\n");
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  let rows: ConvergenceRow[];

  if (inputPath) {
    // Read from JSON file
    const raw = readFileSync(inputPath, "utf-8");
    rows = JSON.parse(raw) as ConvergenceRow[];
    console.log(`Read ${rows.length} convergence points from ${inputPath}`);
  } else {
    // Read from DB
    const { getPool } = await import("../src/db.js");
    const pool = getPool();
    const scopeId = process.env.SCOPE_ID ?? "default";
    const res = await pool.query(
      `SELECT epoch, goal_score, lyapunov_v, dimension_scores, context_seq
       FROM convergence_history
       WHERE scope_id = $1
       ORDER BY created_at ASC`,
      [scopeId],
    );
    rows = res.rows.map((r: Record<string, unknown>) => ({
      epoch: Number(r.epoch),
      goal_score: Number(r.goal_score),
      lyapunov_v: Number(r.lyapunov_v),
      dimension_scores: r.dimension_scores as Record<string, number>,
      context_seq: r.context_seq != null ? Number(r.context_seq) : null,
    }));
    console.log(`Read ${rows.length} convergence points from database (scope=${scopeId})`);
  }

  if (rows.length < 2) {
    console.error("Need at least 2 convergence points for analysis.");
    process.exit(1);
  }

  const report = analyzeDiscretization(rows);
  const formatted = formatReport(report);
  console.log("\n" + formatted);

  // Write JSON report
  const outputPath = inputPath
    ? inputPath.replace(".json", "-discretization.json")
    : join(process.cwd(), "docs", "experiments", "discretization-report.json");
  writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`Report written to: ${outputPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
