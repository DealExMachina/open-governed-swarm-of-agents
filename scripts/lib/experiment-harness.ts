/**
 * Shared harness for E1-E7 propagation layer experiments.
 * Pure-math — no Docker, no Postgres, no NATS.
 */
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { PropagationEngine, type EvidenceStateFlat } from "../../src/propagationEngine.js";
import type { PropagationConfig, TopologyConfig } from "../../src/config/propagation.js";

// ---------------------------------------------------------------------------
// Seeded PRNG (Mulberry32) — deterministic, no external deps
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// State builders
// ---------------------------------------------------------------------------

/** Flat state layout: for each role, support[0..d-1] then refutation[0..d-1]. */
export function makeUniformState(
  numRoles: number,
  numDims: number,
  supportVal: number,
  refutationVal: number,
): number[] {
  const state: number[] = [];
  for (let r = 0; r < numRoles; r++) {
    for (let d = 0; d < numDims; d++) state.push(supportVal);
    for (let d = 0; d < numDims; d++) state.push(refutationVal);
  }
  return state;
}

export function makeRandomState(
  numRoles: number,
  numDims: number,
  seed: number,
): number[] {
  const rng = mulberry32(seed);
  const state: number[] = [];
  for (let r = 0; r < numRoles; r++) {
    for (let d = 0; d < numDims; d++) state.push(rng());
    for (let d = 0; d < numDims; d++) state.push(rng());
  }
  return state;
}

export interface RoleOverride {
  support: number[];
  refutation: number[];
}

/** Uniform baseline at 0.5, then apply per-role overrides. */
export function makeDisagreementState(
  numRoles: number,
  numDims: number,
  overrides: Map<number, RoleOverride>,
): number[] {
  const state = makeUniformState(numRoles, numDims, 0.5, 0.5);
  const stride = 2 * numDims;
  for (const [roleIdx, override] of overrides) {
    const offset = roleIdx * stride;
    for (let d = 0; d < numDims; d++) {
      if (override.support[d] !== undefined) state[offset + d] = override.support[d];
      if (override.refutation[d] !== undefined) state[offset + numDims + d] = override.refutation[d];
    }
  }
  return state;
}

// ---------------------------------------------------------------------------
// Perturbation generators
// ---------------------------------------------------------------------------

export function zeroPerturbation(numRoles: number, numDims: number): number[] {
  return new Array(numRoles * 2 * numDims).fill(0);
}

export function randomPerturbation(
  numRoles: number,
  numDims: number,
  maxNorm: number,
  seed: number,
): number[] {
  const rng = mulberry32(seed);
  const len = numRoles * 2 * numDims;
  const raw: number[] = [];
  for (let i = 0; i < len; i++) raw.push(rng() * 2 - 1);
  const norm = normVec(raw);
  if (norm === 0) return new Array(len).fill(0);
  const scale = (maxNorm * rng()) / norm;
  return raw.map((v) => v * scale);
}

export function targetedPerturbation(
  numRoles: number,
  numDims: number,
  roleIdx: number,
  dims: number[],
  magnitude: number,
): number[] {
  const p = zeroPerturbation(numRoles, numDims);
  const stride = 2 * numDims;
  const offset = roleIdx * stride;
  for (const d of dims) {
    p[offset + d] = magnitude;
    p[offset + numDims + d] = -magnitude;
  }
  return p;
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

export function normVec(v: number[]): number {
  return Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
}

export interface StepRecord {
  step: number;
  disagreement_before: number;
  disagreement_after: number;
  contraction_ratio: number;
  perturbation_norm: number;
  contraction_achieved: boolean;
  flat_new_state: number[];
}

export interface ConvergenceResult {
  steps: number;
  converged: boolean;
  finalState: number[];
  history: StepRecord[];
}

export function runUntilConverged(
  engine: PropagationEngine,
  initialState: EvidenceStateFlat,
  perturbationFn: (step: number) => EvidenceStateFlat,
  maxSteps: number,
  threshold: number,
): ConvergenceResult {
  let state = [...initialState];
  const history: StepRecord[] = [];

  for (let i = 0; i < maxSteps; i++) {
    const perturbation = perturbationFn(i);
    const result = engine.step(state, perturbation);
    history.push({
      step: i,
      disagreement_before: result.disagreement_before,
      disagreement_after: result.disagreement_after,
      contraction_ratio: result.contraction_ratio,
      perturbation_norm: result.perturbation_norm,
      contraction_achieved: result.contraction_achieved,
      flat_new_state: result.flat_new_state,
    });
    state = result.flat_new_state;
    if (result.disagreement_after < threshold) {
      return { steps: i + 1, converged: true, finalState: state, history };
    }
  }

  return { steps: maxSteps, converged: false, finalState: state, history };
}

// ---------------------------------------------------------------------------
// Engine factory (inline config, no YAML dependency)
// ---------------------------------------------------------------------------

/**
 * Create a PropagationEngine with inline config (no YAML dependency).
 * When topology is omitted, defaults to complete graph (backward-compatible).
 */
export function createEngine(
  numRoles: number,
  numDims: number,
  topology?: TopologyConfig,
): PropagationEngine {
  const roles = Array.from({ length: numRoles }, (_, i) => ({
    name: `role_${i}`,
    stalk_dim: 2 * numDims,
    primary_dims: "all" as const,
  }));

  const config: PropagationConfig = {
    propagation: {
      framework: "sheaf_laplacian",
      roles,
      dimensions: Array.from({ length: numDims }, (_, i) => `dim_${i}`),
      evidence_channels: ["support", "refutation"],
      sheaf: { edges: [] },
      diffusion: { alpha: "auto", max_alpha_ratio: 0.95 },
      admissible_set: {
        type: "convex_box",
        support_range: [0, 1],
        refutation_range: [0, 1],
      },
      noise: { epsilon_max_initial: 0.15, log_perturbation_norms: true },
      iss: { max_contradiction_rate: 0.3, alert_on_violation: true },
      topology_constraints: { min_spectral_gap: 0.1, max_degree: 4 },
      topology,
    },
  };

  return new PropagationEngine({ config, num_roles: numRoles, num_dims: numDims });
}

// ---------------------------------------------------------------------------
// State readout helpers
// ---------------------------------------------------------------------------

export function getSupportForRole(
  state: number[],
  roleIdx: number,
  numDims: number,
): number[] {
  const stride = 2 * numDims;
  const offset = roleIdx * stride;
  return state.slice(offset, offset + numDims);
}

export function getRefutationForRole(
  state: number[],
  roleIdx: number,
  numDims: number,
): number[] {
  const stride = 2 * numDims;
  const offset = roleIdx * stride + numDims;
  return state.slice(offset, offset + numDims);
}

export function meanSupportOnDim(
  state: number[],
  dim: number,
  numRoles: number,
  numDims: number,
): number {
  let sum = 0;
  const stride = 2 * numDims;
  for (let r = 0; r < numRoles; r++) {
    sum += state[r * stride + dim];
  }
  return sum / numRoles;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface ExperimentResult {
  experiment: string;
  name: string;
  timestamp: string;
  config: Record<string, unknown>;
  runs: Record<string, unknown>[];
  aggregate: Record<string, unknown>;
  success_criterion: string;
  passed: boolean;
}

const RESULTS_BASE = join(process.cwd(), "docs", "experiments", "propagation");

export function writeResult(experimentId: string, data: ExperimentResult): void {
  const dir = join(RESULTS_BASE, experimentId, "results");
  mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(dir, `${ts}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2));
  console.log(`\nResults written to: ${path}`);
}

export function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );

  const sep = "┼";
  const line = (l: string, m: string, r: string) =>
    l + widths.map((w) => "─".repeat(w + 2)).join(m) + r;

  console.log(line("┌", "┬", "┐"));
  console.log(
    "│" + headers.map((h, i) => ` ${h.padEnd(widths[i])} `).join("│") + "│",
  );
  console.log(line("├", sep, "┤"));
  for (const row of rows) {
    console.log(
      "│" + row.map((c, i) => ` ${(c ?? "").padEnd(widths[i])} `).join("│") + "│",
    );
  }
  console.log(line("└", "┴", "┘"));
}

export function parseArgs(): { runs: number } {
  const arg = process.argv.find((a) => a.startsWith("--runs="));
  const runs = arg ? parseInt(arg.split("=")[1], 10) : 10;
  return { runs: Number.isFinite(runs) && runs >= 1 ? runs : 10 };
}

// ---------------------------------------------------------------------------
// Metric aggregation
// ---------------------------------------------------------------------------

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    Math.ceil((p / 100) * sorted.length) - 1,
    sorted.length - 1,
  );
  return sorted[Math.max(0, idx)];
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, x) => sum + (x - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export interface MetricAggregate {
  count: number;
  min: number;
  max: number;
  mean: number;
  stddev: number;
  p50: number;
  p95: number;
  p99: number;
}

export function aggregateMetric(values: number[]): MetricAggregate {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean: mean(values),
    stddev: stddev(values),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

// ---------------------------------------------------------------------------
// Result comparison (regression detection)
// ---------------------------------------------------------------------------

export interface ComparisonResult {
  metric_name: string;
  baseline_value: number;
  current_value: number;
  delta: number;
  delta_percent: number;
  is_regression: boolean;
}

export function compareMetrics(
  baseline: number,
  current: number,
  threshold_percent: number = 5,
): ComparisonResult {
  const delta = current - baseline;
  const delta_percent = baseline === 0 ? 0 : (delta / baseline) * 100;
  const is_regression = Math.abs(delta_percent) > threshold_percent && delta > 0;

  return {
    metric_name: "",
    baseline_value: baseline,
    current_value: current,
    delta,
    delta_percent,
    is_regression,
  };
}

export interface DiffResult {
  baseline_timestamp: string;
  current_timestamp: string;
  comparisons: Record<string, ComparisonResult>;
  has_regressions: boolean;
}

export function diffResults(
  baseline: ExperimentResult,
  current: ExperimentResult,
  threshold_percent?: number,
): DiffResult {
  const comparisons: Record<string, ComparisonResult> = {};

  // Compare aggregate metrics if available
  const baselineAgg = baseline.aggregate as Record<string, number>;
  const currentAgg = current.aggregate as Record<string, number>;

  for (const [key, baselineVal] of Object.entries(baselineAgg)) {
    if (typeof baselineVal === "number" && typeof currentAgg[key] === "number") {
      const comp = compareMetrics(baselineVal, currentAgg[key], threshold_percent);
      comp.metric_name = key;
      comparisons[key] = comp;
    }
  }

  const has_regressions = Object.values(comparisons).some((c) => c.is_regression);

  return {
    baseline_timestamp: baseline.timestamp,
    current_timestamp: current.timestamp,
    comparisons,
    has_regressions,
  };
}
