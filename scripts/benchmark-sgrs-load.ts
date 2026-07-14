#!/usr/bin/env tsx
/**
 * Focused load benchmark for sgrs (Rust policy/convergence kernel).
 *
 * Demonstrates multiple concurrent "instances" sharing a single governance config:
 * - One governance bundle loaded once (unified policy).
 * - N concurrent workers each repeatedly call sgrs (kernel, transition, gates, convergence).
 * - Reports throughput, latency percentiles, and verifies identical outputs across instances
 *   (unified governance => deterministic decisions).
 *
 * Usage:
 *   pnpm tsx scripts/benchmark-sgrs-load.ts
 *   pnpm tsx scripts/benchmark-sgrs-load.ts --instances=8 --duration=10 --mix=both
 *   pnpm tsx scripts/benchmark-sgrs-load.ts --instances=4 --ops=50000
 *   pnpm tsx scripts/benchmark-sgrs-load.ts --scale=medium --runs=3
 *   pnpm tsx scripts/benchmark-sgrs-load.ts --scopes=10 --instances-per-scope=4
 *
 * Options:
 *   --instances=N         Number of concurrent workers (default 4). Overridden by --scale.
 *   --scale=S             Scale preset: tiny (4), small (8), medium (16), large (32).
 *   --duration=N          Run for N seconds (default 5). Ignored if --ops set.
 *   --ops=N               Total number of sgrs ops to run (then stop). Overrides duration.
 *   --runs=N              Run benchmark N times, report aggregate stats (default 1).
 *   --scopes=N            Number of scopes to test (for multi-tenant, default 1).
 *   --instances-per-scope=M  Concurrent instances per scope (default 1).
 *   --mix=M               Operation mix: governance | finality | both (default both).
 */

import { join } from "path";
import {
  loadPolicies,
  getGovernanceForScope,
  type GovernanceConfig,
} from "../src/governance.js";
import {
  evaluateKernel,
  canTransition,
  evaluateGates,
  evaluateRules,
  analyzeConvergence,
  computeDimensionScores,
  computeLyapunovV,
  computePressure,
  type KernelInput,
} from "../src/sgrsAdapter.js";
import {
  DEFAULT_CONVERGENCE_CONFIG,
  type ConvergencePoint,
} from "../src/convergenceTracker.js";
import type { FinalitySnapshot } from "../src/finalityEvaluator.js";

// ---------------------------------------------------------------------------
// Config and fixtures (unified governance)
// ---------------------------------------------------------------------------

const GOVERNANCE_PATH =
  process.env.GOVERNANCE_PATH ?? join(process.cwd(), "governance.yaml");
const SCOPE_ID = "bench-scope";

function loadUnifiedGovernance(): GovernanceConfig {
  return getGovernanceForScope(SCOPE_ID, loadPolicies(GOVERNANCE_PATH));
}

const KERNEL_INPUT: KernelInput = {
  from_state: "DriftChecked",
  to_state: "ContextIngested",
  drift_level: "medium",
  drift_types: ["contradiction", "goal"],
  mode: "YOLO",
};

function makeSnapshot(overrides: Partial<FinalitySnapshot> = {}): FinalitySnapshot {
  return {
    claims_active_min_confidence: 0.7,
    claims_active_count: 10,
    claims_active_avg_confidence: 0.75,
    contradictions_unresolved_count: 1,
    contradictions_total_count: 2,
    risks_critical_active_count: 0,
    goals_completion_ratio: 0.8,
    scope_risk_score: 0.2,
    ...overrides,
  };
}

function buildMinimalHistory(): ConvergencePoint[] {
  const snapshots: FinalitySnapshot[] = [
    makeSnapshot({ goals_completion_ratio: 0.5, scope_risk_score: 0.4 }),
    makeSnapshot({ goals_completion_ratio: 0.6, scope_risk_score: 0.35 }),
    makeSnapshot({ goals_completion_ratio: 0.7, scope_risk_score: 0.25 }),
    makeSnapshot({ goals_completion_ratio: 0.75, scope_risk_score: 0.22 }),
    makeSnapshot({ goals_completion_ratio: 0.8, scope_risk_score: 0.2 }),
  ];
  const points: ConvergencePoint[] = [];
  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i];
    const lyapunovV = computeLyapunovV(s);
    const pressure = computePressure(s);
    const dimensionScores = computeDimensionScores(s);
    points.push({
      epoch: i + 1,
      goal_score: 0.5 + i * 0.1,
      lyapunov_v: lyapunovV,
      dimension_scores: dimensionScores,
      pressure,
      created_at: new Date().toISOString(),
    });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Op types and runner
// ---------------------------------------------------------------------------

type OpType = "kernel" | "transition" | "rules" | "gates" | "convergence";

interface OpResult {
  op: OpType;
  latencyMs: number;
  /** For consistency check: fingerprint of output. */
  fingerprint: string;
}

function runGovernanceOp(config: GovernanceConfig): OpResult {
  const start = performance.now();
  const out = evaluateKernel(KERNEL_INPUT, config);
  const latencyMs = performance.now() - start;
  const fingerprint = JSON.stringify({
    verdict: out.verdict,
    reason: out.reason,
    suggested_actions: out.suggested_actions,
  });
  return { op: "kernel", latencyMs, fingerprint };
}

function runTransitionOp(config: GovernanceConfig): OpResult {
  const start = performance.now();
  const out = canTransition(
    "DriftChecked",
    "ContextIngested",
    { level: "high", types: ["contradiction"] },
    config,
  );
  const latencyMs = performance.now() - start;
  const fingerprint = JSON.stringify({ allowed: out.allowed, reason: out.reason });
  return { op: "transition", latencyMs, fingerprint };
}

function runRulesOp(config: GovernanceConfig): OpResult {
  const start = performance.now();
  const out = evaluateRules(
    { level: "medium", types: ["goal"] },
    config,
  );
  const latencyMs = performance.now() - start;
  const fingerprint = JSON.stringify(out);
  return { op: "rules", latencyMs, fingerprint };
}

function runGatesOp(): OpResult {
  const snapshot = makeSnapshot();
  const start = performance.now();
  const out = evaluateGates(snapshot, true, 0.85);
  const latencyMs = performance.now() - start;
  const fingerprint = JSON.stringify(out);
  return { op: "gates", latencyMs, fingerprint };
}

let cachedHistory: ConvergencePoint[] | null = null;

function runConvergenceOp(): OpResult {
  if (!cachedHistory) cachedHistory = buildMinimalHistory();
  const start = performance.now();
  const state = analyzeConvergence(
    cachedHistory,
    DEFAULT_CONVERGENCE_CONFIG,
    0.92,
  );
  const latencyMs = performance.now() - start;
  const fingerprint = JSON.stringify({
    convergence_rate: state.convergence_rate,
    is_monotonic: state.is_monotonic,
    is_plateaued: state.is_plateaued,
    trajectory_quality: state.trajectory_quality,
    highest_pressure_dimension: state.highest_pressure_dimension,
  });
  return { op: "convergence", latencyMs, fingerprint };
}

// ---------------------------------------------------------------------------
// Worker and harness
// ---------------------------------------------------------------------------

const SCALE_PRESETS: Record<string, number> = {
  tiny: 1,
  small: 8,
  medium: 16,
  large: 32,
};

function parseArgs(): {
  instances: number;
  durationSec: number;
  totalOps: number | null;
  runs: number;
  scopes: number;
  instancesPerScope: number;
  mix: "governance" | "finality" | "both";
} {
  const args = process.argv.slice(2);
  let instances = 4;
  let durationSec = 5;
  let totalOps: number | null = null;
  let runs = 1;
  let scopes = 1;
  let instancesPerScope = 1;
  let mix: "governance" | "finality" | "both" = "both";

  for (const a of args) {
    if (a.startsWith("--instances="))
      instances = Math.max(1, parseInt(a.slice("--instances=".length), 10));
    else if (a.startsWith("--scale=")) {
      const scale = a.slice("--scale=".length);
      if (SCALE_PRESETS[scale] !== undefined) {
        instances = SCALE_PRESETS[scale];
      }
    } else if (a.startsWith("--duration="))
      durationSec = Math.max(1, parseInt(a.slice("--duration=".length), 10));
    else if (a.startsWith("--ops="))
      totalOps = Math.max(1, parseInt(a.slice("--ops=".length), 10));
    else if (a.startsWith("--runs="))
      runs = Math.max(1, parseInt(a.slice("--runs=".length), 10));
    else if (a.startsWith("--scopes="))
      scopes = Math.max(1, parseInt(a.slice("--scopes=".length), 10));
    else if (a.startsWith("--instances-per-scope="))
      instancesPerScope = Math.max(1, parseInt(a.slice("--instances-per-scope=".length), 10));
    else if (a.startsWith("--mix=")) {
      const m = a.slice("--mix=".length);
      if (m === "governance" || m === "finality" || m === "both") mix = m;
    }
  }

  return { instances, durationSec, totalOps, runs, scopes, instancesPerScope, mix };
}

function pickOp(
  mix: "governance" | "finality" | "both",
  config: GovernanceConfig,
): OpResult {
  if (mix === "governance") {
    const r = Math.random();
    if (r < 0.4) return runGovernanceOp(config);
    if (r < 0.8) return runTransitionOp(config);
    return runRulesOp(config);
  }
  if (mix === "finality") {
    return Math.random() < 0.5 ? runGatesOp() : runConvergenceOp();
  }
  const r = Math.random();
  if (r < 0.25) return runGovernanceOp(config);
  if (r < 0.5) return runTransitionOp(config);
  if (r < 0.6) return runRulesOp(config);
  if (r < 0.8) return runGatesOp();
  return runConvergenceOp();
}

async function runWorker(
  _workerId: number,
  config: GovernanceConfig,
  mix: "governance" | "finality" | "both",
  deadline: number,
  maxOps: number | null,
): Promise<OpResult[]> {
  const myResults: OpResult[] = [];
  let count = 0;
  while (Date.now() < deadline && (maxOps == null || count < maxOps)) {
    const res = pickOp(mix, config);
    myResults.push(res);
    count++;
  }
  return myResults;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    Math.ceil((p / 100) * sorted.length) - 1,
    sorted.length - 1,
  );
  return sorted[Math.max(0, idx)];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, x) => sum + (x - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

interface RunResult {
  totalOps: number;
  elapsedSec: number;
  opsPerSec: number;
  byOp: Map<OpType, { latencies: number[]; fingerprints: Set<string> }>;
  allUnified: boolean;
}

async function runBenchmark(
  instances: number,
  instancesPerScope: number,
  scopes: number,
  durationSec: number,
  totalOps: number | null,
  mix: "governance" | "finality" | "both",
  config: GovernanceConfig,
): Promise<RunResult> {
  const startWall = Date.now();
  const deadline = startWall + durationSec * 1000;
  const maxOpsPerScope = totalOps != null ? Math.ceil(totalOps / scopes) : null;
  const maxOpsPerWorker = maxOpsPerScope != null ? Math.ceil(maxOpsPerScope / instances) : null;

  const allResults: OpResult[] = [];

  for (let scopeIdx = 0; scopeIdx < scopes; scopeIdx++) {
    const workers = Array.from({ length: instances }, (_, i) =>
      runWorker(
        i,
        config,
        mix,
        deadline,
        maxOpsPerWorker,
      ),
    );

    const scopeResults = await Promise.all(workers);
    for (const workerResults of scopeResults) {
      for (const r of workerResults) {
        allResults.push(r);
      }
    }
  }

  const elapsedMs = Date.now() - startWall;
  const elapsedSec = elapsedMs / 1000;
  const total = allResults.length;
  const opsPerSec = total / elapsedSec;

  const byOp = new Map<OpType, { latencies: number[]; fingerprints: Set<string> }>();
  for (const r of allResults) {
    if (!byOp.has(r.op)) {
      byOp.set(r.op, { latencies: [], fingerprints: new Set() });
    }
    const data = byOp.get(r.op)!;
    data.latencies.push(r.latencyMs);
    data.fingerprints.add(r.fingerprint);
  }

  const allUnified = Array.from(byOp.values()).every((d) => d.fingerprints.size === 1);

  return { totalOps: total, elapsedSec, opsPerSec, byOp, allUnified };
}

function printRunResults(result: RunResult): void {
  console.log("--- Results ---");
  console.log("  total ops:     " + result.totalOps);
  console.log("  elapsed (s):   " + result.elapsedSec.toFixed(2));
  console.log("  throughput:    " + result.opsPerSec.toFixed(0) + " ops/s");
  console.log("");

  console.log("  Latency (ms) by operation:");
  for (const [op, data] of result.byOp) {
    const sorted = [...data.latencies].sort((a, b) => a - b);
    const p50 = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);
    const p99 = percentile(sorted, 99);
    const min = sorted[0] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;
    const avg = mean(sorted);
    const uniq = data.fingerprints.size;
    const consistent = uniq === 1 ? " (unified)" : " (MISMATCH: " + uniq + " distinct)";
    console.log(
      "    " +
        op.padEnd(12) +
        " n=" +
        String(sorted.length).padStart(6) +
        "  min=" +
        min.toFixed(2) +
        "  p50=" +
        p50.toFixed(2) +
        "  p95=" +
        p95.toFixed(2) +
        "  p99=" +
        p99.toFixed(2) +
        "  max=" +
        max.toFixed(2) +
        "  avg=" +
        avg.toFixed(2) +
        consistent,
    );
  }

  console.log("");
  if (result.allUnified) {
    console.log("  Unified governance: all instances produced identical outputs for same inputs.");
  } else {
    console.log("  WARNING: some operations had multiple distinct outputs across instances.");
  }
}

async function main(): Promise<void> {
  const { instances, durationSec, totalOps, runs, scopes, instancesPerScope, mix } =
    parseArgs();

  const config = loadUnifiedGovernance();
  console.log("sgrs load benchmark: unified governance");
  console.log("  governance: " + GOVERNANCE_PATH);
  console.log("  scope:      " + SCOPE_ID);
  console.log("  instances:  " + instances);
  console.log("  scopes:     " + scopes);
  console.log("  instances-per-scope: " + instancesPerScope);
  console.log("  runs:       " + runs);
  console.log("  mix:        " + mix);
  if (totalOps != null) {
    console.log("  total ops:  " + totalOps + " (then stop)");
    const perWorker = Math.ceil(totalOps / (scopes * instances));
    console.log("  per worker: ~" + perWorker);
  } else {
    console.log("  duration:   " + durationSec + "s");
  }
  console.log("");

  const runResults: RunResult[] = [];

  for (let runIdx = 0; runIdx < runs; runIdx++) {
    if (runs > 1) {
      console.log(`=== Run ${runIdx + 1}/${runs} ===`);
    }

    const result = await runBenchmark(
      instances,
      instancesPerScope,
      scopes,
      durationSec,
      totalOps,
      mix,
      config,
    );

    runResults.push(result);
    printRunResults(result);

    if (runIdx < runs - 1) console.log("");
  }

  if (runs > 1) {
    console.log("\n=== Aggregate Stats ===");
    const allOpsPerSec = runResults.map((r) => r.opsPerSec);
    const allUnified = runResults.every((r) => r.allUnified);
    console.log("  throughput (ops/s): " + "  avg=" + mean(allOpsPerSec).toFixed(0));
    console.log(
      "    min=" +
        Math.min(...allOpsPerSec).toFixed(0) +
        "  max=" +
        Math.max(...allOpsPerSec).toFixed(0) +
        "  stddev=" +
        stddev(allOpsPerSec).toFixed(0),
    );
    if (!allUnified) {
      console.log("  WARNING: not all runs had unified governance!");
      process.exitCode = 1;
    }
  } else if (!runResults[0]?.allUnified) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exitCode = 1;
});
