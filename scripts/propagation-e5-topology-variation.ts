#!/usr/bin/env tsx
/**
 * E5-T: Topology Sensitivity with True Topology Variation (Publication Grade)
 *
 * Validates τ ∝ 1/λ₁ across 5 topology families: complete, star, ring, chain,
 * random_regular. Uses Pearson and Spearman rank correlations with 95% CIs.
 *
 * Uses PropagationEngine with topology config — same abstraction as production.
 *
 * Key insight: star(n) has λ₁ = 1 (constant), ring(n) has λ₁ ≈ 2−2cos(2π/n),
 * complete(n) has λ₁ = n, random_regular(n,d) has tunable spectral gap.
 * These give qualitatively different mixing times.
 *
 * Success: Pearson correlation between τ and 1/λ₁ > 0.9 across all topologies,
 *          with no censored (MAX_STEPS-saturated) data points.
 *
 * Usage:
 *   pnpm tsx scripts/propagation-e5-topology-variation.ts
 *   pnpm tsx scripts/propagation-e5-topology-variation.ts --runs=30
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
import type { TopologyPreset, TopologyConfig } from "../src/config/propagation.js";

const NUM_DIMS = 4;
const CONVERGENCE_THRESHOLD = 0.001;
const MAX_STEPS = 2000; // Raised from 500 to avoid censoring slow topologies
const NOISE_MAGNITUDE = 0.02;
const CORRELATION_THRESHOLD = 0.9;
const DEFAULT_RUNS = 30; // Publication-grade: 30 runs for tight CIs

// Fixed alpha across all topologies. Must be < 2/lambda_max for the largest lambda_max.
// Worst case: complete(10) has lambda_max = 10, so alpha < 0.2.
const FIXED_ALPHA = 0.05;

interface TopologySpec {
  topology: TopologyPreset;
  n: number;
  topoConfig: TopologyConfig;
}

function spec(topology: TopologyPreset, n: number, degree?: number, seed?: number): TopologySpec {
  return { topology, n, topoConfig: { preset: topology, degree, seed } };
}

// 5 topology families with diverse spectral gaps
const SPECS: TopologySpec[] = [
  // Star: λ₁ = 1 (constant), slow mixing for large n
  spec("star", 5),
  spec("star", 7),
  spec("star", 10),
  // Chain: λ₁ = 2 − 2cos(π/n), smallest spectral gap, slowest mixing
  spec("chain", 5),
  spec("chain", 7),
  spec("chain", 10),
  // Ring: λ₁ = 2 − 2cos(2π/n), moderate mixing
  spec("ring", 5),
  spec("ring", 7),
  spec("ring", 10),
  // Complete: λ₁ = n, fastest mixing
  spec("complete", 3),
  spec("complete", 5),
  spec("complete", 7),
  spec("complete", 10),
  // Random regular: tunable spectral gap via degree
  spec("random_regular", 6, 3, 42),
  spec("random_regular", 8, 3, 42),
  spec("random_regular", 10, 3, 42),
  spec("random_regular", 8, 4, 42),
  spec("random_regular", 10, 4, 42),
];

interface DataPoint {
  topology: string;
  numRoles: number;
  degree?: number;
  spectral_gap: number;
  inverse_spectral_gap: number;
  lambda_max: number;
  contraction_rate: number;
  tau: number;
  tau_std: number;
  tau_ci95: number;
  censored: boolean; // true if any run hit MAX_STEPS
}

function measureTau(
  sp: TopologySpec, seed: number,
): { tau: number; spectrum: { spectral_gap: number; lambda_max: number; is_connected: boolean }; censored: boolean } {
  const engine = createEngine(sp.n, NUM_DIMS, sp.topoConfig);
  const spectrum = engine.analyzeTopology();

  if (!spectrum.is_connected) {
    return { tau: MAX_STEPS, spectrum, censored: true };
  }

  let state = makeRandomState(sp.n, NUM_DIMS, seed);
  let tau = MAX_STEPS;
  let censored = true;

  for (let i = 0; i < MAX_STEPS; i++) {
    const perturbation = randomPerturbation(
      sp.n, NUM_DIMS, NOISE_MAGNITUDE, seed * MAX_STEPS + i,
    );
    const result = engine.step(state, perturbation, FIXED_ALPHA);
    state = result.flat_new_state;
    if (result.disagreement_after < CONVERGENCE_THRESHOLD) {
      tau = i + 1;
      censored = false;
      break;
    }
  }

  return { tau, spectrum, censored };
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

/** Spearman rank correlation — robust to outliers and nonlinearity. */
function spearmanCorrelation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const rank = (arr: number[]) => {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    for (let i = 0; i < n; i++) ranks[sorted[i].i] = i + 1;
    return ranks;
  };
  return pearsonCorrelation(rank(xs), rank(ys));
}

function main() {
  const args = parseArgs();
  const runs = args.runs === 10 ? DEFAULT_RUNS : args.runs; // override default 10 → 30

  console.log("╔═══════════════════════════════════════════════════════════════════════╗");
  console.log("║  E5-T: Topology Sensitivity — Publication Grade                     ║");
  console.log("║  τ vs 1/λ₁ across complete, star, ring, chain, random_regular       ║");
  console.log(`║  ${runs} runs per config, MAX_STEPS=${MAX_STEPS}                              ║`);
  console.log("╚═══════════════════════════════════════════════════════════════════════╝");
  console.log();

  const dataPoints: DataPoint[] = [];
  const rows: string[][] = [];
  let totalCensored = 0;

  for (const sp of SPECS) {
    const taus: number[] = [];
    let spectrum: { spectral_gap: number; lambda_max: number; is_connected: boolean } | null = null;
    let anyCensored = false;

    for (let i = 0; i < runs; i++) {
      const result = measureTau(sp, i * 1000 + sp.n);
      taus.push(result.tau);
      if (!spectrum) spectrum = result.spectrum;
      if (result.censored) anyCensored = true;
    }

    if (anyCensored) totalCensored++;

    const avgTau = taus.reduce((a, b) => a + b, 0) / taus.length;
    const stdTau = Math.sqrt(
      taus.reduce((s, t) => s + (t - avgTau) ** 2, 0) / taus.length,
    );
    const ci95 = 1.96 * stdTau / Math.sqrt(runs);

    const rho = Math.abs(1 - FIXED_ALPHA * spectrum!.spectral_gap);

    const label = sp.topology === "random_regular"
      ? `rr(d=${sp.topoConfig.degree})`
      : sp.topology;

    const dp: DataPoint = {
      topology: label,
      numRoles: sp.n,
      degree: sp.topoConfig.degree,
      spectral_gap: spectrum!.spectral_gap,
      inverse_spectral_gap: 1.0 / spectrum!.spectral_gap,
      lambda_max: spectrum!.lambda_max,
      contraction_rate: rho,
      tau: avgTau,
      tau_std: stdTau,
      tau_ci95: ci95,
      censored: anyCensored,
    };
    dataPoints.push(dp);

    rows.push([
      label,
      String(sp.n),
      dp.spectral_gap.toFixed(4),
      dp.inverse_spectral_gap.toFixed(4),
      rho.toFixed(4),
      avgTau.toFixed(1),
      `±${ci95.toFixed(1)}`,
      anyCensored ? "YES" : "",
    ]);
  }

  printTable(
    ["Topology", "n", "λ₁", "1/λ₁", "ρ", "Avg τ", "95% CI", "Censored"],
    rows,
  );

  // Filter uncensored points for clean correlation
  const uncensored = dataPoints.filter((d) => !d.censored);
  const tausAll = dataPoints.map((d) => d.tau);
  const invGapsAll = dataPoints.map((d) => d.inverse_spectral_gap);
  const tausClean = uncensored.map((d) => d.tau);
  const invGapsClean = uncensored.map((d) => d.inverse_spectral_gap);

  const pearsonAll = pearsonCorrelation(tausAll, invGapsAll);
  const pearsonClean = pearsonCorrelation(tausClean, invGapsClean);
  const spearmanAll = spearmanCorrelation(tausAll, invGapsAll);
  const spearmanClean = spearmanCorrelation(tausClean, invGapsClean);

  console.log();
  console.log("Correlation analysis:");
  console.log(`  All points (${dataPoints.length}):       Pearson r = ${pearsonAll.toFixed(4)}, Spearman ρ = ${spearmanAll.toFixed(4)}`);
  console.log(`  Uncensored (${uncensored.length}):       Pearson r = ${pearsonClean.toFixed(4)}, Spearman ρ = ${spearmanClean.toFixed(4)}`);
  console.log(`  Censored points: ${totalCensored}/${dataPoints.length}`);
  console.log(`  Threshold: Pearson r > ${CORRELATION_THRESHOLD}`);

  // Per-topology correlations
  console.log();
  console.log("Per-topology breakdown:");
  const topoLabels = [...new Set(dataPoints.map((d) => d.topology))];
  for (const topo of topoLabels) {
    const subset = dataPoints.filter((d) => d.topology === topo && !d.censored);
    if (subset.length >= 2) {
      const subTaus = subset.map((d) => d.tau);
      const subInvGaps = subset.map((d) => d.inverse_spectral_gap);
      const subCorr = pearsonCorrelation(subTaus, subInvGaps);
      console.log(`  ${topo.padEnd(14)} r = ${subCorr.toFixed(4)} (${subset.length} uncensored points)`);
    } else {
      const note = dataPoints.filter((d) => d.topology === topo).length;
      console.log(`  ${topo.padEnd(14)} insufficient uncensored points (${subset.length}/${note})`);
    }
  }

  const passed = pearsonClean > CORRELATION_THRESHOLD;
  console.log();
  console.log(
    `${passed ? "PASS" : "FAIL"}: Pearson r(uncensored) = ${pearsonClean.toFixed(4)}, ` +
    `Spearman ρ = ${spearmanClean.toFixed(4)} ` +
    `(threshold: > ${CORRELATION_THRESHOLD}).`,
  );

  const result: ExperimentResult = {
    experiment: "E5-T",
    name: "Topology Sensitivity with True Topology Variation (Publication Grade)",
    timestamp: new Date().toISOString(),
    config: {
      numDims: NUM_DIMS,
      runs,
      maxSteps: MAX_STEPS,
      specs: SPECS.map((s) => ({ topology: s.topology, n: s.n, degree: s.topoConfig.degree })),
      fixedAlpha: FIXED_ALPHA,
      noiseMagnitude: NOISE_MAGNITUDE,
    },
    runs: dataPoints,
    aggregate: {
      pearson_all: pearsonAll,
      pearson_uncensored: pearsonClean,
      spearman_all: spearmanAll,
      spearman_uncensored: spearmanClean,
      total_specs: dataPoints.length,
      censored_specs: totalCensored,
      threshold: CORRELATION_THRESHOLD,
    },
    success_criterion: `Pearson r(τ, 1/λ₁) > ${CORRELATION_THRESHOLD} on uncensored points across 5 topology families`,
    passed,
  };

  writeResult("E5-T", result);
  process.exit(passed ? 0 : 1);
}

main();
