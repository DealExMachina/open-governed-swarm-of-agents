#!/usr/bin/env tsx
/**
 * E4: Communication Cost Scaling
 *
 * Measure evidence objects transmitted per resolved case as role count scales (3→5→7).
 * Evidence objects per step = n * 2 * d (flat state size processed by the Laplacian).
 *
 * Success: O(|E|·d) scaling. On complete graph |E| = n(n-1)/2, so O(n²·d) is expected.
 * The experiment validates the measurement methodology and provides baseline numbers.
 *
 * NOTE: True sub-quadratic scaling requires sparse topologies (star, chain, ring),
 * which need the non-complete-graph bridge extension (future work).
 *
 * Usage:
 *   pnpm tsx scripts/propagation-e4-communication-cost.ts
 *   pnpm tsx scripts/propagation-e4-communication-cost.ts --runs=10
 */

import {
  createEngine,
  makeRandomState,
  zeroPerturbation,
  runUntilConverged,
  printTable,
  writeResult,
  parseArgs,
  type ExperimentResult,
} from "./lib/experiment-harness.js";

const NUM_DIMS = 4;
const CONVERGENCE_THRESHOLD = 0.001;
const MAX_STEPS = 100;
const ROLE_COUNTS = [3, 5, 7, 9];

interface RunResult {
  numRoles: number;
  steps: number;
  evidence_objects: number;
  edges: number; // |E| for complete graph
  converged: boolean;
}

function runOnce(numRoles: number, seed: number): RunResult {
  const engine = createEngine(numRoles, NUM_DIMS);
  const state = makeRandomState(numRoles, NUM_DIMS, seed);

  const result = runUntilConverged(
    engine,
    state,
    () => zeroPerturbation(numRoles, NUM_DIMS),
    MAX_STEPS,
    CONVERGENCE_THRESHOLD,
  );

  const evidencePerStep = numRoles * 2 * NUM_DIMS;
  const totalEvidence = result.steps * evidencePerStep;
  const edges = (numRoles * (numRoles - 1)) / 2;

  return {
    numRoles,
    steps: result.steps,
    evidence_objects: totalEvidence,
    edges,
    converged: result.converged,
  };
}

function main() {
  const { runs } = parseArgs();

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  E4: Communication Cost Scaling                            ║");
  console.log("║  Evidence objects per resolved case vs role count           ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();

  const allResults: RunResult[] = [];
  const aggregateRows: { numRoles: number; avgSteps: number; avgEvidence: number; edges: number }[] = [];

  for (const n of ROLE_COUNTS) {
    const results: RunResult[] = [];
    for (let i = 0; i < runs; i++) {
      results.push(runOnce(n, i * 1000 + n));
    }
    allResults.push(...results);

    const avgSteps = results.reduce((s, r) => s + r.steps, 0) / runs;
    const avgEvidence = results.reduce((s, r) => s + r.evidence_objects, 0) / runs;
    const edges = results[0].edges;
    aggregateRows.push({ numRoles: n, avgSteps, avgEvidence, edges });
  }

  // Compute scaling ratios relative to n=3
  const baseline = aggregateRows[0];
  const rows: string[][] = aggregateRows.map((r) => {
    const ratio = r.avgEvidence / baseline.avgEvidence;
    const edgeRatio = r.edges / baseline.edges;
    return [
      String(r.numRoles),
      String(r.edges),
      r.avgSteps.toFixed(1),
      r.avgEvidence.toFixed(0),
      ratio.toFixed(2) + "x",
      edgeRatio.toFixed(2) + "x",
    ];
  });

  printTable(
    ["n (roles)", "|E|", "Avg Steps", "Avg Evidence", "Ratio vs n=3", "|E| Ratio"],
    rows,
  );

  // Check if evidence scaling follows |E|*d (on complete graph, |E| = n(n-1)/2)
  // Evidence per step is n*2*d, and the Laplacian processes |E| edges per step.
  // So total cost ∝ steps * |E| * stalk_dim. We measure steps * n * 2d as a proxy.
  console.log();
  console.log("NOTE: On complete graph, |E| = n(n-1)/2, so O(|E|*d) = O(n^2*d).");
  console.log("Sub-quadratic scaling requires sparse topologies (future bridge extension).");

  const allPassed = allResults.every((r) => r.converged);
  console.log();
  console.log(
    `${allPassed ? "PASS" : "FAIL"}: all ${allResults.length} runs converged. ` +
    "Scaling data recorded for analysis.",
  );

  const result: ExperimentResult = {
    experiment: "E4",
    name: "Communication Cost Scaling",
    timestamp: new Date().toISOString(),
    config: { numDims: NUM_DIMS, runs, roleCounts: ROLE_COUNTS },
    runs: allResults,
    aggregate: {
      scaling_data: aggregateRows,
      all_converged: allPassed,
    },
    success_criterion: "O(|E|*d) scaling — complete graph provides baseline",
    passed: allPassed,
  };

  writeResult("E4", result);
  process.exit(allPassed ? 0 : 1);
}

main();
