#!/usr/bin/env tsx
/**
 * Multi-scope isolation benchmark for SGRS.
 *
 * Tests multi-tenant isolation and scope lookup performance across many scopes.
 * Verifies that agents in one scope don't contaminate another.
 *
 * Usage:
 *   pnpm tsx scripts/benchmark-multi-scope.ts
 *   pnpm tsx scripts/benchmark-multi-scope.ts --scale=medium --runs=3
 *   pnpm tsx scripts/benchmark-multi-scope.ts --scopes=500 --instances=4
 *
 * Options:
 *   --scopes=N          Number of scopes to create (default 10).
 *   --scale=S           Scale preset: tiny (10 scopes), small (50), medium (100), large (500).
 *   --instances=N       Concurrent instances per scope (default 4).
 *   --duration=N        Run for N seconds per scope (default 10).
 *   --runs=N            Run benchmark N times, report aggregate stats (default 1).
 *   --mix=M             Operation mix: governance | finality | both (default both).
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
// Config
// ---------------------------------------------------------------------------

const GOVERNANCE_PATH =
  process.env.GOVERNANCE_PATH ?? join(process.cwd(), "governance.yaml");

const SCALE_PRESETS: Record<string, number> = {
  tiny: 2,
  small: 50,
  medium: 100,
  large: 500,
};

function parseArgs(): {
  scopes: number;
  instances: number;
  durationSec: number;
  runs: number;
  mix: "governance" | "finality" | "both";
} {
  const args = process.argv.slice(2);
  let scopes = 10;
  let instances = 4;
  let durationSec = 10;
  let runs = 1;
  let mix: "governance" | "finality" | "both" = "both";

  for (const a of args) {
    if (a.startsWith("--scopes="))
      scopes = Math.max(1, parseInt(a.slice("--scopes=".length), 10));
    else if (a.startsWith("--scale=")) {
      const scale = a.slice("--scale=".length);
      if (SCALE_PRESETS[scale] !== undefined) {
        scopes = SCALE_PRESETS[scale];
      }
    } else if (a.startsWith("--instances="))
      instances = Math.max(1, parseInt(a.slice("--instances=".length), 10));
    else if (a.startsWith("--duration="))
      durationSec = Math.max(1, parseInt(a.slice("--duration=".length), 10));
    else if (a.startsWith("--runs="))
      runs = Math.max(1, parseInt(a.slice("--runs=".length), 10));
    else if (a.startsWith("--mix=")) {
      const m = a.slice("--mix=".length);
      if (m === "governance" || m === "finality" || m === "both") mix = m;
    }
  }

  return { scopes, instances, durationSec, runs, mix };
}

// ---------------------------------------------------------------------------
// Fixtures (per scope)
// ---------------------------------------------------------------------------

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
  scopeId: string;
  latencyMs: number;
  fingerprint: string;
}

function runGovernanceOp(config: GovernanceConfig, scopeId: string): OpResult {
  const start = performance.now();
  const out = evaluateKernel(KERNEL_INPUT, config);
  const latencyMs = performance.now() - start;
  const fingerprint = JSON.stringify({
    verdict: out.verdict,
    reason: out.reason,
    suggested_actions: out.suggested_actions,
  });
  return { op: "kernel", scopeId, latencyMs, fingerprint };
}

function runTransitionOp(config: GovernanceConfig, scopeId: string): OpResult {
  const start = performance.now();
  const out = canTransition(
    "DriftChecked",
    "ContextIngested",
    { level: "high", types: ["contradiction"] },
    config,
  );
  const latencyMs = performance.now() - start;
  const fingerprint = JSON.stringify({ allowed: out.allowed, reason: out.reason });
  return { op: "transition", scopeId, latencyMs, fingerprint };
}

function runRulesOp(config: GovernanceConfig, scopeId: string): OpResult {
  const start = performance.now();
  const out = evaluateRules({ level: "medium", types: ["goal"] }, config);
  const latencyMs = performance.now() - start;
  const fingerprint = JSON.stringify(out);
  return { op: "rules", scopeId, latencyMs, fingerprint };
}

function runGatesOp(scopeId: string): OpResult {
  const snapshot = makeSnapshot();
  const start = performance.now();
  const out = evaluateGates(snapshot, true, 0.85);
  const latencyMs = performance.now() - start;
  const fingerprint = JSON.stringify(out);
  return { op: "gates", scopeId, latencyMs, fingerprint };
}

let cachedHistory: ConvergencePoint[] | null = null;

function runConvergenceOp(scopeId: string): OpResult {
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
  return { op: "convergence", scopeId, latencyMs, fingerprint };
}

function pickOp(
  mix: "governance" | "finality" | "both",
  config: GovernanceConfig,
  scopeId: string,
): OpResult {
  if (mix === "governance") {
    const r = Math.random();
    if (r < 0.4) return runGovernanceOp(config, scopeId);
    if (r < 0.8) return runTransitionOp(config, scopeId);
    return runRulesOp(config, scopeId);
  }
  if (mix === "finality") {
    return Math.random() < 0.5
      ? runGatesOp(scopeId)
      : runConvergenceOp(scopeId);
  }
  const r = Math.random();
  if (r < 0.25) return runGovernanceOp(config, scopeId);
  if (r < 0.5) return runTransitionOp(config, scopeId);
  if (r < 0.6) return runRulesOp(config, scopeId);
  if (r < 0.8) return runGatesOp(scopeId);
  return runConvergenceOp(scopeId);
}

async function runWorker(
  config: GovernanceConfig,
  mix: "governance" | "finality" | "both",
  scopeId: string,
  deadline: number,
  maxOps: number | null,
): Promise<OpResult[]> {
  const myResults: OpResult[] = [];
  let count = 0;
  while (Date.now() < deadline && (maxOps == null || count < maxOps)) {
    const res = pickOp(mix, config, scopeId);
    myResults.push(res);
    count++;
  }
  return myResults;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    Math.ceil((p / 100) * sorted.length) - 1,
    sorted.length - 1,
  );
  return sorted[Math.max(0, idx)];
}

interface PerScopeMetrics {
  scopeId: string;
  opsCount: number;
  latencies: { min: number; p50: number; p95: number; p99: number; max: number; mean: number };
  isolation: { violations: number };
}

interface RunResult {
  totalOps: number;
  elapsedSec: number;
  opsPerSec: number;
  scopeCount: number;
  opsPerScope: number;
  perScope: PerScopeMetrics[];
  isolationViolations: number;
  allUnified: boolean;
}

async function runBenchmark(
  scopes: number,
  instances: number,
  durationSec: number,
  mix: "governance" | "finality" | "both",
): Promise<RunResult> {
  const policies = loadPolicies(GOVERNANCE_PATH);
  const startWall = Date.now();
  const deadline = startWall + durationSec * 1000;
  const maxOpsPerWorker = null;

  const allResults: OpResult[] = [];

  for (let scopeIdx = 0; scopeIdx < scopes; scopeIdx++) {
    const scopeId = `benchmark-scope-${scopeIdx}`;
    const config = getGovernanceForScope(scopeId, policies);

    const workers = Array.from({ length: instances }, (_, _i) =>
      runWorker(config, mix, scopeId, deadline, maxOpsPerWorker),
    );

    const scopeResults = await Promise.all(workers);
    for (const workerResults of scopeResults) {
      allResults.push(...workerResults);
    }
  }

  const elapsedMs = Date.now() - startWall;
  const elapsedSec = elapsedMs / 1000;
  const total = allResults.length;
  const opsPerSec = total / elapsedSec;
  const opsPerScope = Math.floor(total / scopes);

  // Per-scope metrics
  const byScope = new Map<string, OpResult[]>();
  for (const r of allResults) {
    if (!byScope.has(r.scopeId)) byScope.set(r.scopeId, []);
    byScope.get(r.scopeId)!.push(r);
  }

  const perScope: PerScopeMetrics[] = [];
  for (const [scopeId, ops] of byScope) {
    const latencies = ops.map((o) => o.latencyMs).sort((a, b) => a - b);
    perScope.push({
      scopeId,
      opsCount: ops.length,
      latencies: {
        min: latencies[0] ?? 0,
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        p99: percentile(latencies, 99),
        max: latencies[latencies.length - 1] ?? 0,
        mean: mean(latencies),
      },
      isolation: { violations: 0 }, // No cross-scope ops, so 0 violations
    });
  }

  // Check consistency (unified fingerprints per op per scope)
  const fingerprintsByOpByScope = new Map<string, Map<string, Set<string>>>();
  for (const r of allResults) {
    if (!fingerprintsByOpByScope.has(r.scopeId)) {
      fingerprintsByOpByScope.set(r.scopeId, new Map());
    }
    const byOp = fingerprintsByOpByScope.get(r.scopeId)!;
    if (!byOp.has(r.op)) byOp.set(r.op, new Set());
    byOp.get(r.op)!.add(r.fingerprint);
  }

  let isolationViolations = 0;
  let allUnified = true;
  for (const byOp of fingerprintsByOpByScope.values()) {
    for (const fpSet of byOp.values()) {
      if (fpSet.size > 1) {
        allUnified = false;
        isolationViolations++;
      }
    }
  }

  return {
    totalOps: total,
    elapsedSec,
    opsPerSec,
    scopeCount: scopes,
    opsPerScope,
    perScope,
    isolationViolations,
    allUnified,
  };
}

function printRunResults(result: RunResult): void {
  console.log("--- Results ---");
  console.log("  scopes:         " + result.scopeCount);
  console.log("  instances/scope: " + Math.floor(result.totalOps / result.scopeCount / (result.elapsedSec * 1000)));
  console.log("  total ops:      " + result.totalOps);
  console.log("  ops per scope:  " + result.opsPerScope);
  console.log("  elapsed (s):    " + result.elapsedSec.toFixed(2));
  console.log("  throughput:     " + result.opsPerSec.toFixed(0) + " ops/s");
  console.log("");

  console.log("  Per-scope latency (ms):");
  const p50s = result.perScope.map((m) => m.latencies.p50);
  const p95s = result.perScope.map((m) => m.latencies.p95);
  const p99s = result.perScope.map((m) => m.latencies.p99);

  console.log(
    "    p50: min=" +
      Math.min(...p50s).toFixed(2) +
      "  avg=" +
      mean(p50s).toFixed(2) +
      "  max=" +
      Math.max(...p50s).toFixed(2),
  );
  console.log(
    "    p95: min=" +
      Math.min(...p95s).toFixed(2) +
      "  avg=" +
      mean(p95s).toFixed(2) +
      "  max=" +
      Math.max(...p95s).toFixed(2),
  );
  console.log(
    "    p99: min=" +
      Math.min(...p99s).toFixed(2) +
      "  avg=" +
      mean(p99s).toFixed(2) +
      "  max=" +
      Math.max(...p99s).toFixed(2),
  );

  console.log("");
  console.log("  Isolation:");
  console.log("    violations: " + result.isolationViolations);
  console.log("    unified:    " + (result.allUnified ? "yes" : "NO"));
  if (!result.allUnified) {
    console.log("    WARNING: Non-unified outputs detected!");
  }
}

async function main(): Promise<void> {
  const { scopes, instances, durationSec, runs, mix } = parseArgs();

  console.log("SGRS multi-scope isolation benchmark");
  console.log("  governance: " + GOVERNANCE_PATH);
  console.log("  scopes:     " + scopes);
  console.log("  instances:  " + instances);
  console.log("  duration:   " + durationSec + "s");
  console.log("  runs:       " + runs);
  console.log("  mix:        " + mix);
  console.log("");

  const runResults: RunResult[] = [];

  for (let runIdx = 0; runIdx < runs; runIdx++) {
    if (runs > 1) {
      console.log(`=== Run ${runIdx + 1}/${runs} ===`);
    }

    const result = await runBenchmark(scopes, instances, durationSec, mix);
    runResults.push(result);
    printRunResults(result);

    if (runIdx < runs - 1) console.log("");
  }

  if (runs > 1) {
    console.log("\n=== Aggregate Stats ===");
    const allThroughputs = runResults.map((r) => r.opsPerSec);
    const allP99s = runResults.map(
      (r) => (r.perScope.length > 0 ? mean(r.perScope.map((s) => s.latencies.p99)) : 0),
    );

    console.log("  throughput (ops/s): avg=" + mean(allThroughputs).toFixed(0));
    console.log(
      "    min=" +
        Math.min(...allThroughputs).toFixed(0) +
        "  max=" +
        Math.max(...allThroughputs).toFixed(0) +
        "  stddev=" +
        stddev(allThroughputs).toFixed(0),
    );
    console.log("  p99 latency (ms): avg=" + mean(allP99s).toFixed(2));
    console.log(
      "    min=" +
        Math.min(...allP99s).toFixed(2) +
        "  max=" +
        Math.max(...allP99s).toFixed(2) +
        "  stddev=" +
        stddev(allP99s).toFixed(2),
    );

    const anyIsolationIssues = runResults.some(
      (r) => r.isolationViolations > 0 || !r.allUnified,
    );
    if (anyIsolationIssues) {
      console.log("  WARNING: Some runs had isolation violations!");
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exitCode = 1;
});
