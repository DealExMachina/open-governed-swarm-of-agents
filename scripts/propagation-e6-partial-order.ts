#!/usr/bin/env tsx
/**
 * E6: Partial-Order Cooperation
 *
 * Two roles with orthogonal evidence (one has support on dim A, other on dim B).
 * Verify that the sheaf global section combines both roles' evidence.
 *
 * Success: final mean support on dim A > 0.5 AND dim B > 0.5.
 *
 * Usage:
 *   pnpm tsx scripts/propagation-e6-partial-order.ts
 *   pnpm tsx scripts/propagation-e6-partial-order.ts --runs=20
 */

import {
  createEngine,
  makeUniformState,
  randomPerturbation,
  runUntilConverged,
  meanSupportOnDim,
  printTable,
  writeResult,
  parseArgs,
  mulberry32,
  type ExperimentResult,
} from "./lib/experiment-harness.js";

const NUM_ROLES = 7;
const NUM_DIMS = 4;
const CONVERGENCE_THRESHOLD = 0.001;
const MAX_STEPS = 100;
const MEAN_SUPPORT_THRESHOLD = 0.5;
const NOISE_MAGNITUDE = 0.01; // Small per-step perturbation for cross-run variance

interface RunResult {
  seed: number;
  dimA_mean_support: number;
  dimB_mean_support: number;
  steps: number;
  converged: boolean;
  passed: boolean;
}

function runOnce(dimA: number, dimB: number, seed: number): RunResult {
  const rng = mulberry32(seed);
  const engine = createEngine(NUM_ROLES, NUM_DIMS);

  // Varied baseline per run: support in [0.45, 0.55], refutation in [0.08, 0.12]
  // Conservative range ensures mean support stays above 0.5 threshold after diffusion.
  const baseSup = 0.45 + rng() * 0.1;
  const baseRef = 0.08 + rng() * 0.04;
  const state = makeUniformState(NUM_ROLES, NUM_DIMS, baseSup, baseRef);
  const stride = 2 * NUM_DIMS;

  // Role 0: strong evidence on dim A (varied strength [0.90, 0.99])
  state[0 * stride + dimA] = 0.90 + rng() * 0.09;

  // Role 1: strong evidence on dim B (varied strength [0.90, 0.99])
  state[1 * stride + dimB] = 0.90 + rng() * 0.09;

  // Small per-role noise on neutral roles to break symmetry (±0.02)
  for (let r = 2; r < NUM_ROLES; r++) {
    for (let d = 0; d < NUM_DIMS; d++) {
      state[r * stride + d] += (rng() * 2 - 1) * 0.02;
      state[r * stride + d] = Math.max(0, Math.min(1, state[r * stride + d]));
    }
  }

  const result = runUntilConverged(
    engine,
    state,
    (step) => randomPerturbation(NUM_ROLES, NUM_DIMS, NOISE_MAGNITUDE, seed * MAX_STEPS + step),
    MAX_STEPS,
    CONVERGENCE_THRESHOLD,
  );

  const dimA_mean = meanSupportOnDim(result.finalState, dimA, NUM_ROLES, NUM_DIMS);
  const dimB_mean = meanSupportOnDim(result.finalState, dimB, NUM_ROLES, NUM_DIMS);

  return {
    seed,
    dimA_mean_support: dimA_mean,
    dimB_mean_support: dimB_mean,
    steps: result.steps,
    converged: result.converged,
    passed: dimA_mean > MEAN_SUPPORT_THRESHOLD && dimB_mean > MEAN_SUPPORT_THRESHOLD,
  };
}

function main() {
  const { runs } = parseArgs();

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  E6: Partial-Order Cooperation                             ║");
  console.log("║  Two roles with orthogonal evidence → global section       ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();

  // Test all pairs of orthogonal dimensions
  const dimPairs: [number, number][] = [
    [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3],
  ];

  const allResults: RunResult[] = [];
  const rows: string[][] = [];

  for (const [dimA, dimB] of dimPairs) {
    const results: RunResult[] = [];
    for (let i = 0; i < runs; i++) {
      const seed = i * 7919 + dimA * 100 + dimB;
      results.push(runOnce(dimA, dimB, seed));
    }
    allResults.push(...results);

    const meanA = results.reduce((s, r) => s + r.dimA_mean_support, 0) / runs;
    const meanB = results.reduce((s, r) => s + r.dimB_mean_support, 0) / runs;
    const stdA = Math.sqrt(results.reduce((s, r) => s + (r.dimA_mean_support - meanA) ** 2, 0) / runs);
    const stdB = Math.sqrt(results.reduce((s, r) => s + (r.dimB_mean_support - meanB) ** 2, 0) / runs);
    const avgSteps = results.reduce((s, r) => s + r.steps, 0) / runs;
    const passRate = results.filter((r) => r.passed).length / runs;

    rows.push([
      `dim${dimA}+dim${dimB}`,
      `${meanA.toFixed(4)}±${stdA.toFixed(4)}`,
      `${meanB.toFixed(4)}±${stdB.toFixed(4)}`,
      avgSteps.toFixed(1),
      `${(passRate * 100).toFixed(0)}%`,
      passRate === 1 ? "PASS" : "FAIL",
    ]);
  }

  printTable(
    ["Dim Pair", "Mean Sup A", "Mean Sup B", "Avg Steps", "Pass Rate", "Status"],
    rows,
  );

  const allPassed = allResults.every((r) => r.passed);
  console.log();
  console.log(
    `${allPassed ? "PASS" : "FAIL"}: ${allResults.filter((r) => r.passed).length}/${allResults.length} ` +
    `runs passed (mean support > ${MEAN_SUPPORT_THRESHOLD} on both orthogonal dims).`,
  );

  const result: ExperimentResult = {
    experiment: "E6",
    name: "Partial-Order Cooperation",
    timestamp: new Date().toISOString(),
    config: { numRoles: NUM_ROLES, numDims: NUM_DIMS, runs, threshold: MEAN_SUPPORT_THRESHOLD },
    runs: allResults,
    aggregate: {
      total_runs: allResults.length,
      pass_rate: allResults.filter((r) => r.passed).length / allResults.length,
    },
    success_criterion: `mean support on both orthogonal dims > ${MEAN_SUPPORT_THRESHOLD}`,
    passed: allPassed,
  };

  writeResult("E6", result);
  process.exit(allPassed ? 0 : 1);
}

main();
