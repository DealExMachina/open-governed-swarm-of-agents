#!/usr/bin/env tsx
/**
 * E3: Oscillation After Checkpoint
 *
 * After reaching provisional finality (low disagreement), inject a perturbation.
 * Count state revisions before re-stabilization.
 *
 * Success: <= 2 revisions (Lyapunov bound guarantee).
 *
 * Usage:
 *   pnpm tsx scripts/propagation-e3-oscillation-bound.ts
 *   pnpm tsx scripts/propagation-e3-oscillation-bound.ts --runs=20
 */

import {
  createEngine,
  makeUniformState,
  zeroPerturbation,
  targetedPerturbation,
  printTable,
  writeResult,
  parseArgs,
  type ExperimentResult,
} from "./lib/experiment-harness.js";

const NUM_ROLES = 7;
const NUM_DIMS = 4;
const PROVISIONAL_THRESHOLD = 0.01; // Omega < this = "provisional finality"
const RESTABILIZE_THRESHOLD = 0.01;
const REVISION_EPSILON = 0.001; // |Omega_{t+1} - Omega_t| > this = a "revision"
const MAX_STEPS_TO_FINALITY = 50;
const MAX_STEPS_AFTER_PERTURB = 30;
const MAX_REVISIONS = 2;

interface RunResult {
  perturbation_magnitude: number;
  revisions: number;
  steps_to_restabilize: number;
  omega_at_checkpoint: number;
  omega_after_perturb: number;
  passed: boolean;
}

function runOnce(perturbMagnitude: number): RunResult {
  const engine = createEngine(NUM_ROLES, NUM_DIMS);

  // Start near consensus with slight disagreement
  const state = makeUniformState(NUM_ROLES, NUM_DIMS, 0.7, 0.2);
  const stride = 2 * NUM_DIMS;
  // Add slight disagreement to role 0
  state[0 * stride + 0] = 0.8;
  state[1 * stride + 1] = 0.6;

  // Phase 1: Run to provisional finality
  let currentState = [...state];
  for (let i = 0; i < MAX_STEPS_TO_FINALITY; i++) {
    const result = engine.step(currentState, zeroPerturbation(NUM_ROLES, NUM_DIMS));
    currentState = result.flat_new_state;
    if (result.disagreement_after < PROVISIONAL_THRESHOLD) break;
  }

  const omegaCheckpoint = engine.getDisagreement(currentState);

  // Phase 2: Inject perturbation
  const perturbation = targetedPerturbation(NUM_ROLES, NUM_DIMS, 0, [0, 1], perturbMagnitude);
  // Also perturb role 3
  const stride2 = 2 * NUM_DIMS;
  perturbation[3 * stride2 + 2] = perturbMagnitude;
  perturbation[3 * stride2 + 3] = -perturbMagnitude;

  const pertResult = engine.step(currentState, perturbation);
  currentState = pertResult.flat_new_state;
  const omegaAfterPerturb = pertResult.disagreement_after;

  // Phase 3: Count revisions until re-stabilization
  let revisions = 0;
  let prevOmega = omegaAfterPerturb;
  let stepsToRestabilize = 0;

  for (let i = 0; i < MAX_STEPS_AFTER_PERTURB; i++) {
    const result = engine.step(currentState, zeroPerturbation(NUM_ROLES, NUM_DIMS));
    currentState = result.flat_new_state;
    const omega = result.disagreement_after;

    if (Math.abs(omega - prevOmega) > REVISION_EPSILON) {
      revisions++;
    }
    prevOmega = omega;
    stepsToRestabilize = i + 1;

    if (omega < RESTABILIZE_THRESHOLD) break;
  }

  return {
    perturbation_magnitude: perturbMagnitude,
    revisions,
    steps_to_restabilize: stepsToRestabilize,
    omega_at_checkpoint: omegaCheckpoint,
    omega_after_perturb: omegaAfterPerturb,
    passed: revisions <= MAX_REVISIONS,
  };
}

function main() {
  const { runs } = parseArgs();

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  E3: Oscillation After Checkpoint                          ║");
  console.log("║  Perturb after finality, count revisions to restabilize    ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();

  const magnitudes = [0.1, 0.2, 0.3, 0.4];
  const allResults: RunResult[] = [];
  const rows: string[][] = [];

  for (const mag of magnitudes) {
    const results: RunResult[] = [];
    for (let i = 0; i < runs; i++) {
      results.push(runOnce(mag));
    }
    allResults.push(...results);

    const avgRevisions = results.reduce((s, r) => s + r.revisions, 0) / runs;
    const maxRevisions = Math.max(...results.map((r) => r.revisions));
    const avgSteps = results.reduce((s, r) => s + r.steps_to_restabilize, 0) / runs;
    const passRate = results.filter((r) => r.passed).length / runs;

    rows.push([
      mag.toFixed(1),
      avgRevisions.toFixed(1),
      String(maxRevisions),
      avgSteps.toFixed(1),
      `${(passRate * 100).toFixed(0)}%`,
      passRate === 1 ? "PASS" : "FAIL",
    ]);
  }

  printTable(
    ["Magnitude", "Avg Rev", "Max Rev", "Avg Steps", "Pass Rate", "Status"],
    rows,
  );

  const allPassed = allResults.every((r) => r.passed);
  const maxRev = Math.max(...allResults.map((r) => r.revisions));
  console.log();
  console.log(
    `${allPassed ? "PASS" : "FAIL"}: max revisions = ${maxRev} ` +
    `(threshold: <= ${MAX_REVISIONS}). ` +
    `${allResults.filter((r) => r.passed).length}/${allResults.length} runs passed.`,
  );

  const result: ExperimentResult = {
    experiment: "E3",
    name: "Oscillation After Checkpoint",
    timestamp: new Date().toISOString(),
    config: { numRoles: NUM_ROLES, numDims: NUM_DIMS, runs, magnitudes },
    runs: allResults,
    aggregate: {
      max_revisions: maxRev,
      pass_rate: allResults.filter((r) => r.passed).length / allResults.length,
    },
    success_criterion: `revisions <= ${MAX_REVISIONS} (Lyapunov bound)`,
    passed: allPassed,
  };

  writeResult("E3", result);
  process.exit(allPassed ? 0 : 1);
}

main();
