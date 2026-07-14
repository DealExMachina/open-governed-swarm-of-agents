/**
 * Analyze scalar vs vector finality A/B comparison results.
 *
 * Usage:
 *   pnpm tsx scripts/analyze-scalar-vs-vector.ts <ab-results-dir>
 *
 * Expects: <dir>/scalar/convergence_history.json and <dir>/vector/convergence_history.json
 */
import { readFileSync, existsSync } from "fs";
import { writeFileSync } from "fs";
import { join } from "path";

interface ConvergenceRow {
  epoch: number;
  scope_id: string;
  goal_score: number;
  lyapunov_v: number;
  finality_state: string;
  gate_a_monotonic: boolean;
  gate_b_evidence: boolean;
  gate_c_trajectory: boolean;
  gate_d_quiescent: boolean;
  gate_e_has_content: boolean;
  dimension_scores?: Record<string, number>;
}

function loadHistory(dir: string): ConvergenceRow[] {
  const path = join(dir, "convergence_history.json");
  if (!existsSync(path)) {
    console.error(`Missing: ${path}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf-8"));
}

function main(): void {
  const abDir = process.argv[2];
  if (!abDir) {
    console.error("Usage: pnpm tsx scripts/analyze-scalar-vs-vector.ts <ab-results-dir>");
    process.exit(1);
  }

  const scalar = loadHistory(join(abDir, "scalar"));
  const vector = loadHistory(join(abDir, "vector"));

  console.log("=".repeat(70));
  console.log("  Scalar vs Vector Finality A/B Comparison");
  console.log("=".repeat(70));

  console.log(`\n  Scalar: ${scalar.length} epochs | Vector: ${vector.length} epochs\n`);

  // Find RESOLVED epochs
  const scalarResolved = scalar.filter((r) => r.finality_state === "RESOLVED").map((r) => r.epoch);
  const vectorResolved = vector.filter((r) => r.finality_state === "RESOLVED").map((r) => r.epoch);

  console.log(`  Scalar RESOLVED at epochs: ${scalarResolved.length > 0 ? scalarResolved.join(", ") : "(never)"}`);
  console.log(`  Vector RESOLVED at epochs: ${vectorResolved.length > 0 ? vectorResolved.join(", ") : "(never)"}`);

  // Compensation events (from compensation_events.json if present)
  const compPath = join(abDir, "vector", "compensation_events.json");
  let compensationCount = 0;
  if (existsSync(compPath)) {
    const compEvents = JSON.parse(readFileSync(compPath, "utf-8"));
    compensationCount = compEvents.length;
    console.log(`  Compensation events (vector): ${compensationCount}`);
  }

  // Epoch-by-epoch comparison table
  const maxEpochs = Math.max(scalar.length, vector.length);
  console.log(`\n  ${"Epoch".padEnd(6)} ${"Scalar".padEnd(12)} ${"V(t)_s".padEnd(10)} ${"Vector".padEnd(12)} ${"V(t)_v".padEnd(10)} ${"Delta".padEnd(8)}`);
  console.log(`  ${"-".repeat(58)}`);

  for (let i = 0; i < maxEpochs; i++) {
    const s = scalar[i];
    const v = vector[i];
    const sState = s?.finality_state ?? "-";
    const vState = v?.finality_state ?? "-";
    const sV = s ? s.lyapunov_v.toFixed(4) : "-";
    const vV = v ? v.lyapunov_v.toFixed(4) : "-";
    const delta = s && v ? (s.goal_score - v.goal_score).toFixed(4) : "-";
    const epoch = (s?.epoch ?? v?.epoch ?? i + 1).toString();

    console.log(`  ${epoch.padEnd(6)} ${sState.padEnd(12)} ${sV.padEnd(10)} ${vState.padEnd(12)} ${vV.padEnd(10)} ${delta.padEnd(8)}`);
  }

  // Summary
  const analysis = {
    scalar_epochs: scalar.length,
    vector_epochs: vector.length,
    scalar_resolved_epochs: scalarResolved,
    vector_resolved_epochs: vectorResolved,
    scalar_resolved_count: scalarResolved.length,
    vector_resolved_count: vectorResolved.length,
    compensation_events: compensationCount,
    po2_validated: scalarResolved.length > 0 && vectorResolved.length === 0,
    conclusion:
      scalarResolved.length > 0 && vectorResolved.length === 0
        ? "PO-2 VALIDATED: Scalar finality declared RESOLVED but vector finality correctly blocked (compensation prevention)."
        : scalarResolved.length === 0 && vectorResolved.length === 0
          ? "Both scalar and vector finality stayed HITL/ESCALATED — no compensation scenario arose in this run."
          : scalarResolved.length > 0 && vectorResolved.length > 0
            ? "Both modes reached RESOLVED — vector is not stricter in this run (all dimensions passed)."
            : "UNEXPECTED: Vector resolved but scalar did not.",
  };

  console.log(`\n  ${analysis.conclusion}`);

  const outputPath = join(abDir, "comparison.json");
  writeFileSync(outputPath, JSON.stringify(analysis, null, 2));
  console.log(`\n  Analysis written to: ${outputPath}`);
}

main();
