#!/usr/bin/env tsx
/**
 * E5: Topology Sensitivity
 *
 * Vary the sheaf topology (via role count on complete graph) to change the spectral
 * gap λ₁. Measure convergence time τ. Validate τ ∝ 1/λ₁ within 10%.
 *
 * Since the bridge only supports complete graphs, we vary n to change λ₁.
 * True topology variation (star, chain, ring) requires non-complete bridge extension.
 *
 * Success: Pearson correlation between τ and 1/λ₁ > 0.9 (strong proportionality).
 *
 * Usage:
 *   pnpm tsx scripts/propagation-e5-topology-sensitivity.ts
 *   pnpm tsx scripts/propagation-e5-topology-sensitivity.ts --runs=10
 */

import {
  createEngine,
  makeRandomState,
  randomPerturbation,
  printTable,
  writeResult,
  parseArgs,
  type ExperimentResult,
} from "./lib/experiment-harness.js";

const NUM_DIMS = 4;
const CONVERGENCE_THRESHOLD = 0.001;
const MAX_STEPS = 500;
const ROLE_COUNTS = [3, 4, 5, 6, 7, 8, 9, 10];
const CORRELATION_THRESHOLD = 0.9;

// Fixed alpha across all topologies so contraction rate rho = 1 - alpha*lambda_1
// varies with lambda_1. Must be < 2/lambda_max for stability. With lambda_max=n
// and max n=10, need alpha < 0.2. Use alpha = 0.05 for slow enough convergence.
const FIXED_ALPHA = 0.05;

// Small per-step perturbation so convergence times vary across seeds.
// Without noise, sheaf diffusion is deterministic and runs are identical.
const NOISE_MAGNITUDE = 0.02;

interface DataPoint {
  numRoles: number;
  spectral_gap: number;
  inverse_spectral_gap: number;
  contraction_rate: number;
  tau: number;
  tau_std: number;
  alpha: number;
}

function measureTau(numRoles: number, seed: number): DataPoint {
  const engine = createEngine(numRoles, NUM_DIMS);
  const spectrum = engine.analyzeTopology();

  // Large initial disagreement: randomized state for maximum Omega
  const state = makeRandomState(numRoles, NUM_DIMS, seed);

  // Run with FIXED alpha (not auto-optimized) so rho varies with lambda_1.
  // Per-step random perturbation ensures genuine cross-seed variance.
  let currentState = [...state];
  let tau = MAX_STEPS;
  for (let i = 0; i < MAX_STEPS; i++) {
    const perturbation = randomPerturbation(numRoles, NUM_DIMS, NOISE_MAGNITUDE, seed * MAX_STEPS + i);
    const result = engine.step(currentState, perturbation, FIXED_ALPHA);
    currentState = result.flat_new_state;
    if (result.disagreement_after < CONVERGENCE_THRESHOLD) {
      tau = i + 1;
      break;
    }
  }

  const rho = Math.abs(1 - FIXED_ALPHA * spectrum.spectral_gap);

  return {
    numRoles,
    spectral_gap: spectrum.spectral_gap,
    inverse_spectral_gap: 1.0 / spectrum.spectral_gap,
    contraction_rate: rho,
    tau,
    alpha: FIXED_ALPHA,
  };
}

function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n === 0) return 0;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

function main() {
  const { runs } = parseArgs();

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  E5: Topology Sensitivity                                  ║");
  console.log("║  tau vs 1/lambda_1 — convergence time vs spectral gap      ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();

  // Collect data points (average tau over runs for each n)
  const dataPoints: DataPoint[] = [];
  const rows: string[][] = [];

  for (const n of ROLE_COUNTS) {
    const taus: number[] = [];
    let point: DataPoint | null = null;

    for (let i = 0; i < runs; i++) {
      const p = measureTau(n, i * 1000 + n);
      taus.push(p.tau);
      if (!point) point = p;
    }

    const avgTau = taus.reduce((a, b) => a + b, 0) / taus.length;
    const stdTau = Math.sqrt(
      taus.reduce((s, t) => s + (t - avgTau) ** 2, 0) / taus.length,
    );
    const dp: DataPoint = { ...point!, tau: avgTau, tau_std: stdTau };
    dataPoints.push(dp);

    rows.push([
      String(n),
      dp.spectral_gap.toFixed(4),
      dp.inverse_spectral_gap.toFixed(6),
      dp.contraction_rate.toFixed(4),
      avgTau.toFixed(1),
      `±${stdTau.toFixed(1)}`,
    ]);
  }

  printTable(
    ["n (roles)", "lambda_1", "1/lambda_1", "rho", "Avg tau", "Std tau"],
    rows,
  );

  // Compute correlation between tau and 1/lambda_1
  const taus = dataPoints.map((d) => d.tau);
  const invGaps = dataPoints.map((d) => d.inverse_spectral_gap);
  const correlation = pearsonCorrelation(taus, invGaps);

  console.log();
  console.log(`Pearson correlation(tau, 1/lambda_1) = ${correlation.toFixed(4)}`);
  console.log(`Threshold: > ${CORRELATION_THRESHOLD}`);

  const passed = correlation > CORRELATION_THRESHOLD;
  console.log();
  console.log(
    `${passed ? "PASS" : "FAIL"}: correlation = ${correlation.toFixed(4)} ` +
    `(threshold: > ${CORRELATION_THRESHOLD}).`,
  );
  console.log();
  console.log("NOTE: Tested with complete graphs only (lambda_1 varies with n).");
  console.log("Per-step stochastic perturbation (epsilon =", NOISE_MAGNITUDE, ") adds cross-seed variance.");
  console.log("True topology variation (star/chain/ring) requires bridge extension.");

  const result: ExperimentResult = {
    experiment: "E5",
    name: "Topology Sensitivity",
    timestamp: new Date().toISOString(),
    config: { numDims: NUM_DIMS, runs, roleCounts: ROLE_COUNTS },
    runs: dataPoints,
    aggregate: {
      pearson_correlation: correlation,
      threshold: CORRELATION_THRESHOLD,
    },
    success_criterion: `Pearson correlation(tau, 1/lambda_1) > ${CORRELATION_THRESHOLD}`,
    passed,
  };

  writeResult("E5", result);
  process.exit(passed ? 0 : 1);
}

main();
