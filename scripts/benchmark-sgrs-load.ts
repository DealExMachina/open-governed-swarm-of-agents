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
 *
 * Options:
 *   --instances=N   Number of concurrent workers (default 4).
 *   --duration=N    Run for N seconds (default 5). Ignored if --ops set.
 *   --ops=N         Total number of sgrs ops to run (then stop). Overrides duration.
 *   --mix=M         Operation mix: governance | finality | both (default both).
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

function parseArgs(): {
  instances: number;
  durationSec: number;
  totalOps: number | null;
  mix: "governance" | "finality" | "both";
} {
  const args = process.argv.slice(2);
  let instances = 4;
  let durationSec = 5;
  let totalOps: number | null = null;
  let mix: "governance" | "finality" | "both" = "both";

  for (const a of args) {
    if (a.startsWith("--instances="))
      instances = Math.max(1, parseInt(a.slice("--instances=".length), 10));
    else if (a.startsWith("--duration="))
      durationSec = Math.max(1, parseInt(a.slice("--duration=".length), 10));
    else if (a.startsWith("--ops="))
      totalOps = Math.max(1, parseInt(a.slice("--ops=".length), 10));
    else if (a.startsWith("--mix=")) {
      const m = a.slice("--mix=".length);
      if (m === "governance" || m === "finality" || m === "both") mix = m;
    }
  }

  return { instances, durationSec, totalOps, mix };
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
  results: OpResult[],
  resultsLock: { lock: boolean },
): Promise<void> {
  const myResults: OpResult[] = [];
  let count = 0;
  while (Date.now() < deadline && (maxOps == null || count < maxOps)) {
    const res = pickOp(mix, config);
    myResults.push(res);
    count++;
  }
  resultsLock.lock = true;
  for (const r of myResults) results.push(r);
  resultsLock.lock = false;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    Math.ceil((p / 100) * sorted.length) - 1,
    sorted.length - 1,
  );
  return sorted[Math.max(0, idx)];
}

function main(): void {
  const { instances, durationSec, totalOps, mix } = parseArgs();

  const config = loadUnifiedGovernance();
  console.log("sgrs load benchmark: unified governance");
  console.log("  governance: " + GOVERNANCE_PATH);
  console.log("  scope:      " + SCOPE_ID);
  console.log("  instances:  " + instances);
  console.log("  mix:        " + mix);
  if (totalOps != null) {
    console.log("  total ops:  " + totalOps + " (then stop)");
    const perWorker = Math.ceil(totalOps / instances);
    console.log("  per worker: ~" + perWorker);
  } else {
    console.log("  duration:   " + durationSec + "s");
  }
  console.log("");

  const results: OpResult[] = [];
  const resultsLock = { lock: false };
  const startWall = Date.now();
  const deadline = startWall + durationSec * 1000;
  const maxOpsPerWorker =
    totalOps != null ? Math.ceil(totalOps / instances) : null;

  const workers = Array.from({ length: instances }, (_, i) =>
    runWorker(
      i,
      config,
      mix,
      deadline,
      maxOpsPerWorker,
      results,
      resultsLock,
    ),
  );

  Promise.all(workers).then(() => {
    const elapsedMs = Date.now() - startWall;
    const elapsedSec = elapsedMs / 1000;
    const total = results.length;
    const opsPerSec = total / elapsedSec;

    const byOp = new Map<OpType, number[]>();
    const fingerprintsByOp = new Map<OpType, Set<string>>();
    for (const r of results) {
      if (!byOp.has(r.op)) {
        byOp.set(r.op, []);
        fingerprintsByOp.set(r.op, new Set());
      }
      const latencies = byOp.get(r.op);
      const fpSet = fingerprintsByOp.get(r.op);
      if (latencies) latencies.push(r.latencyMs);
      if (fpSet) fpSet.add(r.fingerprint);
    }

    console.log("--- Results ---");
    console.log("  total ops:     " + total);
    console.log("  elapsed (s):   " + elapsedSec.toFixed(2));
    console.log("  throughput:    " + opsPerSec.toFixed(0) + " ops/s");
    console.log("");

    console.log("  Latency (ms) by operation:");
    for (const [op, latencies] of byOp) {
      const sorted = [...latencies].sort((a, b) => a - b);
      const p50 = percentile(sorted, 50);
      const p95 = percentile(sorted, 95);
      const p99 = percentile(sorted, 99);
      const fpSet = fingerprintsByOp.get(op);
      const uniq = fpSet ? fpSet.size : 0;
      const consistent = uniq === 1 ? " (unified)" : " (MISMATCH: " + uniq + " distinct)";
      console.log(
        "    " +
          op.padEnd(12) +
          " n=" +
          String(latencies.length).padStart(6) +
          "  p50=" +
          p50.toFixed(2) +
          "  p95=" +
          p95.toFixed(2) +
          "  p99=" +
          p99.toFixed(2) +
          consistent,
      );
    }

    const allUnified = [...fingerprintsByOp.values()].every(
      (s) => s != null && s.size === 1,
    );
    console.log("");
    if (allUnified) {
      console.log("  Unified governance: all instances produced identical outputs for same inputs.");
    } else {
      console.log("  WARNING: some operations had multiple distinct outputs across instances.");
      process.exitCode = 1;
    }
  });
}

main();
