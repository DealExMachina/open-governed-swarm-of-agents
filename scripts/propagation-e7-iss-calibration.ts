#!/usr/bin/env tsx
/**
 * E7: ISS Gain Calibration
 *
 * Validates the ISS small-gain condition kappa/(1-rho^2) < 1 under realistic
 * contradiction loads. Uses FIXED_ALPHA = 0.05 (matching E5) so rho = 0.65
 * and kappa* = 1 - rho^2 = 0.5775.
 *
 * Three-part validation:
 *   Part A — Empirical runs with adversarial contradiction injection.
 *            Opposing role pairs inject conflicting evidence each step,
 *            generating measurable kappa > 0.
 *   Part B — Parametric sweep: call analyzeISS with swept kappa in [0, 0.8]
 *            to verify the small-gain boundary formula.
 *   Part C — Instability witness: verify small-gain is violated when kappa > kappa*.
 *
 * Success:
 *   - Empirical kappa > 0 (nontrivial)
 *   - Small-gain satisfied for all empirical runs
 *   - Parametric sweep shows stable -> unstable transition at kappa* = 0.5775
 *
 * Usage:
 *   pnpm tsx scripts/propagation-e7-iss-calibration.ts
 *   pnpm tsx scripts/propagation-e7-iss-calibration.ts --runs=5
 */

import {
  createEngine,
  makeRandomState,
  zeroPerturbation,
  printTable,
  writeResult,
  parseArgs,
  mulberry32,
  type ExperimentResult,
} from "./lib/experiment-harness.js";
import { analyzeISS as rawAnalyzeISS } from "../src/sgrsAdapter.js";

const NUM_ROLES = 7;
const NUM_DIMS = 4;
const NUM_STEPS = 100;
const CONTRADICTION_THRESHOLD = 0.3;
const FIXED_ALPHA = 0.05; // Same as E5; gives rho = 1 - 0.05*lambda_1
const ADVERSARIAL_MAGNITUDES = [0.15, 0.25, 0.35]; // Swept across runs

interface StepMetric {
  step: number;
  perturbation_norm: number;
  disagreement_before: number;
  disagreement_after: number;
  contraction_ratio: number;
  contradiction_count: number;
}

interface RunResult {
  seed: number;
  adversarial_magnitude: number;
  empirical_rho: number;
  empirical_kappa: number;
  empirical_small_gain: number;
  theoretical_rho: number;
  theoretical_kappa_star: number;
  small_gain_satisfied: boolean;
  small_gain_margin: number;
  passed: boolean;
}

interface SweepPoint {
  kappa: number;
  small_gain_value: number;
  small_gain_satisfied: boolean;
  margin: number;
}

/**
 * Create adversarial perturbation: opposing role pairs push in opposite
 * directions on specific dimensions, plus small random noise.
 */
function adversarialPerturbation(
  numRoles: number,
  numDims: number,
  magnitude: number,
  seed: number,
): number[] {
  const rng = mulberry32(seed);
  const p = zeroPerturbation(numRoles, numDims);
  const stride = 2 * numDims;

  // Role 0 vs Role 1: opposing evidence on dim 0 (support channel)
  p[0 * stride + 0] += magnitude;
  p[1 * stride + 0] -= magnitude;

  // Role 2 vs Role 3: opposing evidence on dim 1 (support channel)
  p[2 * stride + 1] += magnitude;
  p[3 * stride + 1] -= magnitude;

  // Role 4 vs Role 5: opposing evidence on dim 2 (refutation channel)
  p[4 * stride + numDims + 2] += magnitude * 0.8;
  p[5 * stride + numDims + 2] -= magnitude * 0.8;

  // Small random noise on all channels
  for (let i = 0; i < p.length; i++) {
    p[i] += (rng() * 2 - 1) * 0.02;
  }
  return p;
}

function runOnce(seed: number, adversarialMag: number): RunResult {
  const engine = createEngine(NUM_ROLES, NUM_DIMS);
  const spectrum = engine.analyzeTopology();

  const state = makeRandomState(NUM_ROLES, NUM_DIMS, seed);
  const initialDisagreement = engine.getDisagreement(state);
  const metrics: StepMetric[] = [];
  const noiseHistory: number[] = [];
  const contradictionHistory: number[] = [];

  let currentState = [...state];
  for (let step = 0; step < NUM_STEPS; step++) {
    const perturbation = adversarialPerturbation(
      NUM_ROLES, NUM_DIMS, adversarialMag, seed + step * 13,
    );
    const result = engine.step(currentState, perturbation, FIXED_ALPHA);
    const contradictions = engine.extractContradictions(
      result.flat_new_state, CONTRADICTION_THRESHOLD,
    );

    metrics.push({
      step,
      perturbation_norm: result.perturbation_norm,
      disagreement_before: result.disagreement_before,
      disagreement_after: result.disagreement_after,
      contraction_ratio: result.contraction_ratio,
      contradiction_count: contradictions.length,
    });

    noiseHistory.push(result.perturbation_norm);
    contradictionHistory.push(contradictions.length);
    currentState = result.flat_new_state;
  }

  // Empirical contraction rate: geometric mean of valid contraction ratios.
  // Note: this measures the *effective* contraction under noise, not the operator rate.
  const validRatios = metrics
    .map((m) => m.contraction_ratio)
    .filter((r) => r > 0 && Number.isFinite(r));
  const empiricalRho = validRatios.length > 0
    ? Math.exp(validRatios.reduce((s, r) => s + Math.log(r), 0) / validRatios.length)
    : 0;

  // Empirical kappa: mean contradiction count normalized by max possible
  const maxContradictions = (NUM_ROLES * (NUM_ROLES - 1)) / 2 * NUM_DIMS * 2;
  const empiricalKappa = contradictionHistory.reduce((a, b) => a + b, 0) /
    (contradictionHistory.length * maxContradictions);

  // Theoretical ISS via direct bridge call with FIXED_ALPHA.
  // The ISS condition uses the *operator* contraction rate (from spectral analysis),
  // not the effective contraction measured under noise.
  const noiseBound = noiseHistory.length > 0 ? Math.max(...noiseHistory) : 0;
  const issAnalysis = rawAnalyzeISS(
    spectrum.spectral_gap,
    FIXED_ALPHA,
    noiseBound,
    empiricalKappa, // pass the measured kappa to the ISS analysis
    initialDisagreement,
  );

  const theoreticalRho = issAnalysis.contraction_rate;
  const theoreticalRhoSq = theoreticalRho * theoreticalRho;
  const kappaStar = 1 - theoreticalRhoSq;

  // The ISS small-gain uses theoretical rho (operator rate) + empirical kappa
  const smallGainValue = theoreticalRhoSq < 1
    ? empiricalKappa / (1 - theoreticalRhoSq)
    : Infinity;

  return {
    seed,
    adversarial_magnitude: adversarialMag,
    empirical_rho: empiricalRho,
    empirical_kappa: empiricalKappa,
    empirical_small_gain: smallGainValue,
    theoretical_rho: theoreticalRho,
    theoretical_kappa_star: kappaStar,
    small_gain_satisfied: issAnalysis.small_gain_satisfied,
    small_gain_margin: issAnalysis.small_gain_margin,
    passed: empiricalKappa > 0 && issAnalysis.small_gain_satisfied,
  };
}

/**
 * Part B: Parametric sweep — verify small-gain boundary at kappa* = 1 - rho^2.
 */
function runParametricSweep(spectralGap: number): {
  points: SweepPoint[];
  boundaryCorrect: boolean;
} {
  const rho = 1 - FIXED_ALPHA * spectralGap;
  const rhoSq = rho * rho;
  const kappaStar = 1 - rhoSq;
  const noiseBound = 0.15; // representative
  const initialDisagreement = 1.0;

  const kappaValues = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.55, 0.57, 0.58, 0.6, 0.7, 0.8];

  const points: SweepPoint[] = kappaValues.map((kappa) => {
    const iss = rawAnalyzeISS(spectralGap, FIXED_ALPHA, noiseBound, kappa, initialDisagreement);
    return {
      kappa,
      small_gain_value: rhoSq < 1 ? kappa / (1 - rhoSq) : Infinity,
      small_gain_satisfied: iss.small_gain_satisfied,
      margin: iss.small_gain_margin,
    };
  });

  // Verify boundary: all kappa < kappaStar should be stable, all kappa > kappaStar unstable
  const boundaryCorrect = points.every((p) => {
    if (p.kappa < kappaStar - 0.01) return p.small_gain_satisfied === true;
    if (p.kappa > kappaStar + 0.01) return p.small_gain_satisfied === false;
    return true; // near boundary, either is ok
  });

  return { points, boundaryCorrect };
}

function main() {
  const { runs } = parseArgs();

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  E7: ISS Gain Calibration (adversarial + parametric)       ║");
  console.log("║  Validate small-gain condition kappa/(1-rho^2) < 1         ║");
  console.log("║  FIXED_ALPHA = 0.05, rho = 0.65, kappa* = 0.5775         ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();

  // --- Part A: Empirical runs with adversarial injection ---
  console.log("Part A: Empirical runs with adversarial contradiction injection");
  console.log("─".repeat(64));

  const results: RunResult[] = [];
  for (let i = 0; i < runs; i++) {
    const mag = ADVERSARIAL_MAGNITUDES[i % ADVERSARIAL_MAGNITUDES.length];
    results.push(runOnce(i * 7919 + 42, mag));
  }

  const rows: string[][] = results.map((r) => [
    String(r.seed),
    r.adversarial_magnitude.toFixed(2),
    r.empirical_rho.toFixed(4),
    r.empirical_kappa.toFixed(6),
    r.empirical_small_gain.toFixed(6),
    r.theoretical_rho.toFixed(4),
    r.theoretical_kappa_star.toFixed(4),
    r.small_gain_margin.toFixed(4),
    r.small_gain_satisfied ? "yes" : "NO",
    r.passed ? "PASS" : "FAIL",
  ]);

  printTable(
    ["Seed", "Adv Mag", "Emp rho", "Emp kappa", "Emp SG", "Th rho", "kappa*", "Margin", "SG<1", "Status"],
    rows,
  );

  const empiricalPassed = results.every((r) => r.passed);
  const anyKappaPositive = results.some((r) => r.empirical_kappa > 0);
  const allSGSatisfied = results.every((r) => r.small_gain_satisfied);
  console.log();
  console.log(
    `Empirical: ${empiricalPassed ? "PASS" : "FAIL"} — ` +
    `kappa>0: ${anyKappaPositive ? "yes" : "NO"}, ` +
    `SG satisfied: ${allSGSatisfied ? "all" : "NOT all"}, ` +
    `${results.filter((r) => r.passed).length}/${results.length} passed.`,
  );

  // --- Part B: Parametric sweep ---
  console.log();
  console.log("Part B: Parametric sweep — small-gain boundary validation");
  console.log("─".repeat(64));

  const engine = createEngine(NUM_ROLES, NUM_DIMS);
  const spectrum = engine.analyzeTopology();
  const sweep = runParametricSweep(spectrum.spectral_gap);

  const rho = 1 - FIXED_ALPHA * spectrum.spectral_gap;
  const kappaStar = 1 - rho * rho;
  console.log(`  rho = ${rho.toFixed(4)}, kappa* = 1 - rho^2 = ${kappaStar.toFixed(4)}`);
  console.log();

  const sweepRows = sweep.points.map((p) => [
    p.kappa.toFixed(3),
    p.small_gain_value.toFixed(4),
    p.small_gain_satisfied ? "STABLE" : "UNSTABLE",
    p.margin.toFixed(4),
    p.kappa < kappaStar ? "<kappa*" : ">=kappa*",
  ]);

  printTable(
    ["kappa", "SG value", "Status", "Margin", "vs kappa*"],
    sweepRows,
  );

  console.log();
  console.log(
    `Parametric sweep: ${sweep.boundaryCorrect ? "PASS" : "FAIL"} — ` +
    `boundary at kappa* = ${kappaStar.toFixed(4)} correctly separates stable/unstable.`,
  );

  // --- Overall verdict ---
  const allPassed = empiricalPassed && sweep.boundaryCorrect;
  console.log();
  console.log("═".repeat(64));
  console.log(
    `OVERALL: ${allPassed ? "PASS" : "FAIL"} — ` +
    `empirical: ${empiricalPassed ? "PASS" : "FAIL"}, ` +
    `parametric: ${sweep.boundaryCorrect ? "PASS" : "FAIL"}.`,
  );

  const result: ExperimentResult = {
    experiment: "E7",
    name: "ISS Gain Calibration",
    timestamp: new Date().toISOString(),
    config: {
      numRoles: NUM_ROLES,
      numDims: NUM_DIMS,
      numSteps: NUM_STEPS,
      fixedAlpha: FIXED_ALPHA,
      adversarialMagnitudes: ADVERSARIAL_MAGNITUDES,
      contradictionThreshold: CONTRADICTION_THRESHOLD,
      runs,
    },
    runs: results,
    parametric_sweep: {
      rho,
      kappa_star: kappaStar,
      points: sweep.points,
      boundary_correct: sweep.boundaryCorrect,
    },
    aggregate: {
      any_kappa_positive: anyKappaPositive,
      all_small_gain_satisfied: allSGSatisfied,
      pass_rate: results.filter((r) => r.passed).length / results.length,
    },
    success_criterion: "empirical kappa > 0 AND small-gain satisfied AND parametric boundary correct",
    passed: allPassed,
  };

  writeResult("E7", result);
  process.exit(allPassed ? 0 : 1);
}

main();
