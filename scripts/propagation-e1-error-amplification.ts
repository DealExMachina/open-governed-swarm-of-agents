#!/usr/bin/env tsx
/**
 * E1: Error Amplification
 *
 * Inject 5 false claims into one role's evidence. Measure how many propagate
 * to downstream roles (i.e., shift other roles' evidence toward the false value).
 *
 * Success: ratio of downstream accepted / injected < 0.2 (sheaf blocks >80%).
 *
 * Usage:
 *   pnpm tsx scripts/propagation-e1-error-amplification.ts
 *   pnpm tsx scripts/propagation-e1-error-amplification.ts --runs=20
 */

import {
  createEngine,
  makeUniformState,
  zeroPerturbation,
  runUntilConverged,
  getSupportForRole,
  getRefutationForRole,
  printTable,
  writeResult,
  parseArgs,
  mulberry32,
  type ExperimentResult,
} from "./lib/experiment-harness.js";

const NUM_ROLES = 7;
const NUM_DIMS = 4;
const NUM_FALSE_CLAIMS = 5;
const CONVERGENCE_THRESHOLD = 0.001;
const MAX_STEPS = 50;
const ACCEPTANCE_RATIO_THRESHOLD = 0.2;
// A false claim is "accepted" by another role if that role shifts > 50% toward the false value
const SHIFT_THRESHOLD = 0.5;

interface FalseClaim {
  dim: number;
  channel: "support" | "refutation";
  trueValue: number;
  falseValue: number;
}

interface RunResult {
  seed: number;
  accepted: number;
  injected: number;
  ratio: number;
  steps: number;
  converged: boolean;
  passed: boolean;
}

function runOnce(seed: number): RunResult {
  const engine = createEngine(NUM_ROLES, NUM_DIMS);
  const rng = mulberry32(seed);

  // Consensus state: support=0.7, refutation=0.2
  const consensusSupport = 0.7;
  const consensusRefutation = 0.2;
  const state = makeUniformState(NUM_ROLES, NUM_DIMS, consensusSupport, consensusRefutation);
  const stride = 2 * NUM_DIMS;

  // Generate 5 false claims for role 0: flip evidence to extreme opposite
  const claims: FalseClaim[] = [];
  const attackRole = 0;

  // Inject false claims on support channels (dims 0-3) and one refutation channel
  for (let i = 0; i < Math.min(NUM_FALSE_CLAIMS, NUM_DIMS); i++) {
    const falseValue = 0.05; // opposite of consensus support (0.7)
    state[attackRole * stride + i] = falseValue;
    claims.push({ dim: i, channel: "support", trueValue: consensusSupport, falseValue });
  }
  // 5th false claim: refutation on dim 0
  if (NUM_FALSE_CLAIMS > NUM_DIMS) {
    const falseValue = 0.95; // opposite of consensus refutation (0.2)
    state[attackRole * stride + NUM_DIMS + 0] = falseValue;
    claims.push({ dim: 0, channel: "refutation", trueValue: consensusRefutation, falseValue });
  }

  // Run propagation to convergence
  const result = runUntilConverged(
    engine,
    state,
    () => zeroPerturbation(NUM_ROLES, NUM_DIMS),
    MAX_STEPS,
    CONVERGENCE_THRESHOLD,
  );

  // Count how many false claims were "accepted" by downstream roles
  let accepted = 0;
  for (const claim of claims) {
    for (let r = 1; r < NUM_ROLES; r++) { // skip attacker role
      let finalValue: number;
      if (claim.channel === "support") {
        finalValue = getSupportForRole(result.finalState, r, NUM_DIMS)[claim.dim];
      } else {
        finalValue = getRefutationForRole(result.finalState, r, NUM_DIMS)[claim.dim];
      }

      // Check if role shifted > 50% toward the false value
      const totalGap = Math.abs(claim.falseValue - claim.trueValue);
      const shiftTowardFalse = Math.abs(finalValue - claim.trueValue);
      if (totalGap > 0 && shiftTowardFalse / totalGap > SHIFT_THRESHOLD) {
        accepted++;
      }
    }
  }

  // Total possible acceptances: NUM_FALSE_CLAIMS * (NUM_ROLES - 1)
  // But we measure ratio as: how many of the 5 claims were accepted by ANY downstream role
  let claimsAcceptedByAny = 0;
  for (const claim of claims) {
    let anyAccepted = false;
    for (let r = 1; r < NUM_ROLES; r++) {
      let finalValue: number;
      if (claim.channel === "support") {
        finalValue = getSupportForRole(result.finalState, r, NUM_DIMS)[claim.dim];
      } else {
        finalValue = getRefutationForRole(result.finalState, r, NUM_DIMS)[claim.dim];
      }
      const totalGap = Math.abs(claim.falseValue - claim.trueValue);
      const shiftTowardFalse = Math.abs(finalValue - claim.trueValue);
      if (totalGap > 0 && shiftTowardFalse / totalGap > SHIFT_THRESHOLD) {
        anyAccepted = true;
        break;
      }
    }
    if (anyAccepted) claimsAcceptedByAny++;
  }

  const ratio = claimsAcceptedByAny / NUM_FALSE_CLAIMS;

  return {
    seed,
    accepted: claimsAcceptedByAny,
    injected: NUM_FALSE_CLAIMS,
    ratio,
    steps: result.steps,
    converged: result.converged,
    passed: ratio < ACCEPTANCE_RATIO_THRESHOLD,
  };
}

function main() {
  const { runs } = parseArgs();

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  E1: Error Amplification                                   ║");
  console.log("║  Inject 5 false claims, measure downstream acceptance      ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();

  const results: RunResult[] = [];
  for (let i = 0; i < runs; i++) {
    results.push(runOnce(i * 1000 + 42));
  }

  const rows: string[][] = results.map((r) => [
    String(r.seed),
    `${r.accepted}/${r.injected}`,
    r.ratio.toFixed(3),
    String(r.steps),
    r.passed ? "PASS" : "FAIL",
  ]);

  printTable(["Seed", "Accepted/Injected", "Ratio", "Steps", "Status"], rows);

  const allPassed = results.every((r) => r.passed);
  const avgRatio = results.reduce((s, r) => s + r.ratio, 0) / runs;
  console.log();
  console.log(
    `${allPassed ? "PASS" : "FAIL"}: avg ratio = ${avgRatio.toFixed(3)} ` +
    `(threshold: < ${ACCEPTANCE_RATIO_THRESHOLD}). ` +
    `${results.filter((r) => r.passed).length}/${results.length} runs passed.`,
  );

  const result: ExperimentResult = {
    experiment: "E1",
    name: "Error Amplification",
    timestamp: new Date().toISOString(),
    config: { numRoles: NUM_ROLES, numDims: NUM_DIMS, runs, shiftThreshold: SHIFT_THRESHOLD },
    runs: results,
    aggregate: {
      avg_ratio: avgRatio,
      pass_rate: results.filter((r) => r.passed).length / results.length,
    },
    success_criterion: `accepted/injected ratio < ${ACCEPTANCE_RATIO_THRESHOLD}`,
    passed: allPassed,
  };

  writeResult("E1", result);
  process.exit(allPassed ? 0 : 1);
}

main();
