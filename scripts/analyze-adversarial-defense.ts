#!/usr/bin/env tsx
/**
 * Analyze Experiment 8 results: adversarial agent defense validation.
 *
 * Reads results from docs/experiments/exp8/results/ and produces:
 * - Per-mode V(t) trajectory comparison
 * - False finality detection (RESOLVED despite genuine contradictions)
 * - Gate trigger profile (which gates caught adversarial manipulation)
 * - Decision record audit (governance tier/path distribution)
 * - Dimension score inflation tracking
 *
 * Usage:
 *   pnpm tsx scripts/analyze-adversarial-defense.ts docs/experiments/exp8/results/
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

// ── Types ────────────────────────────────────────────────────────────────────

interface ConvergencePoint {
  epoch: number;
  goal_score: number;
  lyapunov_v: number;
  dimension_scores: Record<string, number>;
  pressure: Record<string, number>;
  created_at: string;
  context_seq?: number | null;
  gate_a_monotonic?: boolean | null;
  gate_b_evidence?: boolean | null;
  gate_c_trajectory_ok?: boolean | null;
  gate_d_quiescent?: boolean | null;
  gate_e_has_content?: boolean | null;
  finality_state?: string | null;
  unresolved_contradictions?: number | null;
  trajectory_quality?: number | null;
}

interface DecisionRecord {
  decision_id: string;
  scope_id: string;
  proposal_id: string;
  result: string;
  reason: string;
  governance_path: string;
  scope_mode: string;
  obligations: unknown[];
  created_at: string;
}

interface FinalityDecision {
  scope_id: string;
  option: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ── Load results ─────────────────────────────────────────────────────────────

function loadJsonSafe<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T[];
  } catch {
    return [];
  }
}

interface ModeResults {
  mode: string;
  convergence: ConvergencePoint[];
  decisions: DecisionRecord[];
  finality: FinalityDecision[];
}

function loadModeResults(resultsDir: string): ModeResults[] {
  const modes: ModeResults[] = [];

  // Find timestamped subdirectories for each mode
  const dirs = readdirSync(resultsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const dir of dirs) {
    const fullPath = join(resultsDir, dir);

    // Determine mode from metadata or directory name
    let mode = "unknown";
    const metadataPath = join(fullPath, "metadata.json");
    if (existsSync(metadataPath)) {
      try {
        const meta = JSON.parse(readFileSync(metadataPath, "utf-8"));
        mode = meta.adversarial_mode ?? meta.label ?? dir;
      } catch { /* use dir name */ }
    }

    // Fall back to directory name pattern
    if (mode === "unknown" || mode === dir) {
      if (dir.includes("baseline")) mode = "baseline";
      else if (dir.includes("collude")) mode = "collude";
      else if (dir.includes("inflate")) mode = "inflate";
    }

    const convergence = loadJsonSafe<ConvergencePoint>(join(fullPath, "convergence_history.json"));
    const decisions = loadJsonSafe<DecisionRecord>(join(fullPath, "decision_records.json"));
    const finality = loadJsonSafe<FinalityDecision>(join(fullPath, "scope_finality_decisions.json"));

    if (convergence.length > 0 || decisions.length > 0) {
      modes.push({ mode, convergence, decisions, finality });
    }
  }

  return modes;
}

// ── Analysis functions ───────────────────────────────────────────────────────

function analyzeConvergenceTrajectory(points: ConvergencePoint[]): {
  vStart: number;
  vEnd: number;
  vMin: number;
  vMax: number;
  totalDelta: number;
  monotonicViolations: number;
  averageStepSize: number;
  goalScoreEnd: number;
} {
  if (points.length === 0) {
    return { vStart: 0, vEnd: 0, vMin: 0, vMax: 0, totalDelta: 0, monotonicViolations: 0, averageStepSize: 0, goalScoreEnd: 0 };
  }
  const vs = points.map((p) => p.lyapunov_v);
  let monotonicViolations = 0;
  let totalStep = 0;
  for (let i = 1; i < vs.length; i++) {
    if (vs[i] > vs[i - 1] + 1e-9) monotonicViolations++;
    totalStep += Math.abs(vs[i] - vs[i - 1]);
  }
  return {
    vStart: vs[0],
    vEnd: vs[vs.length - 1],
    vMin: Math.min(...vs),
    vMax: Math.max(...vs),
    totalDelta: vs[vs.length - 1] - vs[0],
    monotonicViolations,
    averageStepSize: vs.length > 1 ? totalStep / (vs.length - 1) : 0,
    goalScoreEnd: points[points.length - 1].goal_score,
  };
}

function analyzeDimensionInflation(points: ConvergencePoint[]): Record<string, { start: number; end: number; inflated: boolean }> {
  if (points.length < 2) return {};
  const dims = Object.keys(points[0].dimension_scores);
  const result: Record<string, { start: number; end: number; inflated: boolean }> = {};
  for (const dim of dims) {
    const start = points[0].dimension_scores[dim] ?? 0;
    const end = points[points.length - 1].dimension_scores[dim] ?? 0;
    // "Inflated" = dimension at 0.95+ (suspiciously perfect)
    result[dim] = { start, end, inflated: end >= 0.95 };
  }
  return result;
}

function analyzeGateProfile(points: ConvergencePoint[]): {
  gateAPassRate: number;
  gateBPassRate: number;
  gateCPassRate: number;
  gateDPassRate: number;
  gateEPassRate: number;
  allGatesPassRate: number;
  pointsWithGates: number;
} {
  const withGates = points.filter((p) => p.gate_a_monotonic !== undefined && p.gate_a_monotonic !== null);
  if (withGates.length === 0) {
    return { gateAPassRate: 0, gateBPassRate: 0, gateCPassRate: 0, gateDPassRate: 0, gateEPassRate: 0, allGatesPassRate: 0, pointsWithGates: 0 };
  }
  const n = withGates.length;
  const gA = withGates.filter((p) => p.gate_a_monotonic).length;
  const gB = withGates.filter((p) => p.gate_b_evidence).length;
  const gC = withGates.filter((p) => p.gate_c_trajectory_ok).length;
  const gD = withGates.filter((p) => p.gate_d_quiescent).length;
  const gE = withGates.filter((p) => p.gate_e_has_content).length;
  const all = withGates.filter((p) =>
    p.gate_a_monotonic && p.gate_b_evidence && p.gate_c_trajectory_ok && p.gate_d_quiescent && p.gate_e_has_content,
  ).length;

  return {
    gateAPassRate: gA / n,
    gateBPassRate: gB / n,
    gateCPassRate: gC / n,
    gateDPassRate: gD / n,
    gateEPassRate: gE / n,
    allGatesPassRate: all / n,
    pointsWithGates: n,
  };
}

function analyzeGovernanceDecisions(decisions: DecisionRecord[]): {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  yoloOverrides: number;
  tierDistribution: Record<string, number>;
} {
  const TIER_MAP: Record<string, number> = {
    processProposal: 1,
    processProposal_yoloOverride: 1,
    oversight_acceptDeterministic: 1,
    processProposal_mitlEscalation: 2,
    oversight_escalateToHuman: 2,
    processProposal_masterReject: 1,
    oversight_escalateToLLM: 3,
    processProposalWithAgent: 3,
  };

  const tierDistribution: Record<string, number> = { "Tier 1": 0, "Tier 2": 0, "Tier 3": 0 };
  let approved = 0, rejected = 0, pending = 0, yoloOverrides = 0;

  for (const d of decisions) {
    if (d.result === "approved") approved++;
    else if (d.result === "rejected") rejected++;
    else pending++;
    if (d.reason?.startsWith("yolo_override:")) yoloOverrides++;
    const tier = TIER_MAP[d.governance_path] ?? 1;
    tierDistribution[`Tier ${tier}`] = (tierDistribution[`Tier ${tier}`] ?? 0) + 1;
  }

  return { total: decisions.length, approved, rejected, pending, yoloOverrides, tierDistribution };
}

function detectFalseFinality(finality: FinalityDecision[], convergence: ConvergencePoint[]): {
  finalState: string;
  isFalseFinality: boolean;
  explanation: string;
} {
  if (finality.length === 0 && convergence.length > 0) {
    const lastPoint = convergence[convergence.length - 1];
    const state = lastPoint.finality_state ?? "ACTIVE";
    return {
      finalState: state,
      isFalseFinality: false,
      explanation: `No finality decision recorded. Last convergence state: ${state}`,
    };
  }

  if (finality.length === 0) {
    return { finalState: "UNKNOWN", isFalseFinality: false, explanation: "No data" };
  }

  const lastFinality = finality[finality.length - 1];
  const finalState = lastFinality.option;

  // Check convergence for last recorded finality state
  const lastConv = convergence.length > 0 ? convergence[convergence.length - 1] : null;
  const lastFinalityState = lastConv?.finality_state ?? finalState;

  // False finality = RESOLVED when adversarial mutations were applied
  // We detect this by checking if the finality was reached with suspiciously perfect scores
  const isResolved = lastFinalityState === "RESOLVED" || finalState === "RESOLVED";
  const dims = lastConv?.dimension_scores ?? {};
  const allDimsPerfect = Object.values(dims).every((v) => v >= 0.95);
  const isFalseFinality = isResolved && allDimsPerfect;

  return {
    finalState: lastFinalityState || finalState,
    isFalseFinality,
    explanation: isFalseFinality
      ? "FALSE FINALITY: System declared RESOLVED with suspiciously perfect dimension scores"
      : isResolved
        ? "Genuine finality: RESOLVED (scores not artificially perfect)"
        : `Not RESOLVED: ${lastFinalityState || finalState}`,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const resultsDir = process.argv[2] ?? "docs/experiments/exp8/results";

  if (!existsSync(resultsDir)) {
    console.error(`Results directory not found: ${resultsDir}`);
    console.error("Run experiment first: bash scripts/run-experiment.sh exp8");
    process.exit(1);
  }

  const modes = loadModeResults(resultsDir);
  if (modes.length === 0) {
    console.error("No result directories found in", resultsDir);
    process.exit(1);
  }

  console.log("\n" + "═".repeat(75));
  console.log("  EXPERIMENT 8: ADVERSARIAL AGENT DEFENSE ANALYSIS");
  console.log("  Assumption #5: Cooperative Agent Model");
  console.log("═".repeat(75));

  let hasBaseline = false;
  let hasInflate = false;
  let hasCollude = false;
  let falseFinalityDetected = false;
  let defensesHeld = false;

  for (const { mode, convergence, decisions, finality } of modes) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`  Mode: ${mode.toUpperCase()}`);
    console.log(`${"─".repeat(60)}`);

    if (mode === "baseline") hasBaseline = true;
    if (mode === "inflate") hasInflate = true;
    if (mode === "collude") hasCollude = true;

    // V(t) trajectory
    const trajectory = analyzeConvergenceTrajectory(convergence);
    console.log(`\n  V(t) Trajectory:`);
    console.log(`    Start:              ${trajectory.vStart.toFixed(4)}`);
    console.log(`    End:                ${trajectory.vEnd.toFixed(4)}`);
    console.log(`    Min:                ${trajectory.vMin.toFixed(4)}`);
    console.log(`    Max:                ${trajectory.vMax.toFixed(4)}`);
    console.log(`    Total delta:        ${trajectory.totalDelta.toFixed(4)}`);
    console.log(`    Monotonicity viols: ${trajectory.monotonicViolations}`);
    console.log(`    Avg step size:      ${trajectory.averageStepSize.toFixed(4)}`);
    console.log(`    Goal score (end):   ${trajectory.goalScoreEnd.toFixed(4)}`);

    // Dimension inflation
    const inflation = analyzeDimensionInflation(convergence);
    console.log(`\n  Dimension Scores (start → end):`);
    for (const [dim, info] of Object.entries(inflation)) {
      const marker = info.inflated ? " ⚠️  INFLATED" : "";
      console.log(`    ${dim.padEnd(28)} ${info.start.toFixed(3)} → ${info.end.toFixed(3)}${marker}`);
    }

    // Gate profile
    const gates = analyzeGateProfile(convergence);
    if (gates.pointsWithGates > 0) {
      console.log(`\n  Gate Profile (${gates.pointsWithGates} evaluations):`);
      console.log(`    Gate A (monotonic):     ${(gates.gateAPassRate * 100).toFixed(0)}%`);
      console.log(`    Gate B (evidence):      ${(gates.gateBPassRate * 100).toFixed(0)}%`);
      console.log(`    Gate C (trajectory):    ${(gates.gateCPassRate * 100).toFixed(0)}%`);
      console.log(`    Gate D (quiescence):    ${(gates.gateDPassRate * 100).toFixed(0)}%`);
      console.log(`    Gate E (has content):   ${(gates.gateEPassRate * 100).toFixed(0)}%`);
      console.log(`    All gates pass:         ${(gates.allGatesPassRate * 100).toFixed(0)}%`);
    }

    // Governance decisions
    const gov = analyzeGovernanceDecisions(decisions);
    if (gov.total > 0) {
      console.log(`\n  Governance Decisions (${gov.total} total):`);
      console.log(`    Approved:   ${gov.approved} (${((gov.approved / gov.total) * 100).toFixed(0)}%)`);
      console.log(`    Rejected:   ${gov.rejected} (${((gov.rejected / gov.total) * 100).toFixed(0)}%)`);
      console.log(`    Pending:    ${gov.pending} (${((gov.pending / gov.total) * 100).toFixed(0)}%)`);
      console.log(`    YOLO ovrds: ${gov.yoloOverrides}`);
      for (const [tier, count] of Object.entries(gov.tierDistribution)) {
        if (count > 0) console.log(`    ${tier}:       ${count}`);
      }
    }

    // False finality detection
    const finalityResult = detectFalseFinality(finality, convergence);
    console.log(`\n  Finality State: ${finalityResult.finalState}`);
    console.log(`  ${finalityResult.explanation}`);

    if (finalityResult.isFalseFinality) {
      falseFinalityDetected = true;
    }
    if (mode === "inflate" && !finalityResult.isFalseFinality && finalityResult.finalState !== "RESOLVED") {
      defensesHeld = true;
    }
  }

  // ── Aggregate conclusion ──────────────────────────────────────────────────

  console.log(`\n${"═".repeat(75)}`);
  console.log("  CONCLUSION");
  console.log(`${"═".repeat(75)}`);

  if (hasBaseline && hasInflate && hasCollude) {
    console.log("\n  All three sub-experiments completed.");
  } else {
    const missing = [];
    if (!hasBaseline) missing.push("baseline");
    if (!hasInflate) missing.push("inflate");
    if (!hasCollude) missing.push("collude");
    console.log(`\n  ⚠️  Missing sub-experiments: ${missing.join(", ")}`);
  }

  console.log("\n  Assumption #5 Analysis:");

  if (defensesHeld) {
    console.log("  ✅ Single adversarial agent (inflate): DETECTED by drift/governance");
    console.log("     → Existing defenses (honest drift agent) catch confidence inflation");
  } else if (hasInflate) {
    console.log("  ⚠️  Single adversarial agent (inflate): Defenses may have been bypassed");
    console.log("     → Further investigation needed on drift detection effectiveness");
  }

  if (falseFinalityDetected) {
    console.log("  🔴 Coordinated adversarial agents (collude): FALSE FINALITY ACHIEVED");
    console.log("     → Confirms Assumption #5: cooperative model IS required for formal guarantees");
    console.log("     → Byzantine fault tolerance (SECP integration) needed for adversarial robustness");
  } else if (hasCollude) {
    console.log("  ⚠️  Coordinated adversarial (collude): Expected false finality not observed");
    console.log("     → Gates may provide some defense even without honest drift agent");
  }

  const validated = defensesHeld && falseFinalityDetected;
  console.log(`\n  Assumption #5 status: ${validated ? "VALIDATED" : "PARTIALLY VALIDATED"}`);
  if (validated) {
    console.log("  The cooperative agent model IS required: Byzantine agents can cause false finality.");
    console.log("  Existing defenses (drift detection, governance) provide PARTIAL robustness");
    console.log("  but are insufficient against coordinated adversarial agents.");
  }

  console.log("");
}

main();
