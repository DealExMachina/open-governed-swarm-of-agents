#!/usr/bin/env tsx
/**
 * E4-T: Communication Cost Scaling across Topologies (Publication Grade)
 *
 * Measures evidence objects, edge count, convergence steps, and Pareto cost
 * (edges × steps) per topology across 5 families: complete, star, ring, chain,
 * random_regular.
 *
 * Key comparison: complete O(n²) edges vs star/ring/chain O(n) edges.
 * Pareto cost = |E| × τ captures the tradeoff: sparse topologies use fewer
 * edges per step but may need more steps to converge.
 *
 * Uses PropagationEngine with topology config — same abstraction as production.
 *
 * Usage:
 *   pnpm tsx scripts/propagation-e4-topology-scaling.ts
 *   pnpm tsx scripts/propagation-e4-topology-scaling.ts --runs=30
 */

import {
  createEngine,
  makeRandomState,
  randomPerturbation,
  runUntilConverged,
  printTable,
  writeResult,
  parseArgs,
  type ExperimentResult,
} from "./lib/experiment-harness.js";
import { getTopologyInfo } from "../src/sgrsAdapter.js";
import type { TopologyPreset, TopologyConfig } from "../src/config/propagation.js";

const NUM_DIMS = 4;
const CONVERGENCE_THRESHOLD = 0.001;
const MAX_STEPS = 2000; // Raised from 500 for slow topologies
const ROLE_COUNTS = [3, 5, 7, 9];
const NOISE_MAGNITUDE = 0.02;
const DEFAULT_RUNS = 30; // Publication-grade: 30 runs for tight CIs

interface TopoSpec {
  preset: TopologyPreset;
  degree?: number;
  seed?: number;
  label: string;
}

const TOPOLOGIES: TopoSpec[] = [
  { preset: "complete", label: "complete" },
  { preset: "star", label: "star" },
  { preset: "ring", label: "ring" },
  { preset: "chain", label: "chain" },
  { preset: "random_regular", degree: 3, seed: 42, label: "rr(d=3)" },
  { preset: "random_regular", degree: 4, seed: 42, label: "rr(d=4)" },
];

interface RunResult {
  topology: string;
  numRoles: number;
  steps: number;
  evidence_objects: number;
  edges: number;
  pareto_cost: number; // edges × steps
  converged: boolean;
}

function runOnce(
  topo: TopoSpec,
  numRoles: number,
  seed: number,
): RunResult {
  const topoConfig: TopologyConfig = {
    preset: topo.preset,
    degree: topo.degree,
    seed: topo.seed,
  };
  const engine = createEngine(numRoles, NUM_DIMS, topoConfig);
  const info = getTopologyInfo(topo.preset, numRoles, topo.degree, topo.seed);
  const state = makeRandomState(numRoles, NUM_DIMS, seed);

  const result = runUntilConverged(
    engine,
    state,
    (step) => randomPerturbation(numRoles, NUM_DIMS, NOISE_MAGNITUDE, seed * MAX_STEPS + step),
    MAX_STEPS,
    CONVERGENCE_THRESHOLD,
  );

  const evidencePerStep = numRoles * 2 * NUM_DIMS;
  const edges = info.num_edges;

  return {
    topology: topo.label,
    numRoles,
    steps: result.steps,
    evidence_objects: result.steps * evidencePerStep,
    edges,
    pareto_cost: edges * result.steps,
    converged: result.converged,
  };
}

function main() {
  const args = parseArgs();
  const runs = args.runs === 10 ? DEFAULT_RUNS : args.runs; // override default 10 → 30

  console.log("╔═══════════════════════════════════════════════════════════════════════╗");
  console.log("║  E4-T: Communication Cost Scaling — Publication Grade               ║");
  console.log("║  Evidence objects, edge count, and Pareto cost across 5 topologies  ║");
  console.log(`║  ${runs} runs per config, MAX_STEPS=${MAX_STEPS}                              ║`);
  console.log("╚═══════════════════════════════════════════════════════════════════════╝");
  console.log();

  const allResults: RunResult[] = [];
  const rows: string[][] = [];

  interface AggRow {
    topology: string;
    numRoles: number;
    edges: number;
    avgSteps: number;
    stdSteps: number;
    avgEvidence: number;
    avgPareto: number;
    allConverged: boolean;
  }
  const aggRows: AggRow[] = [];

  for (const topo of TOPOLOGIES) {
    for (const n of ROLE_COUNTS) {
      // random_regular needs n > degree and n*degree even; skip invalid combos
      if (topo.preset === "random_regular" && topo.degree != null) {
        if (n <= topo.degree || (n * topo.degree) % 2 !== 0) continue;
      }

      const results: RunResult[] = [];
      for (let i = 0; i < runs; i++) {
        results.push(runOnce(topo, n, i * 1000 + n));
      }
      allResults.push(...results);

      const avgSteps = results.reduce((s, r) => s + r.steps, 0) / runs;
      const stdSteps = Math.sqrt(
        results.reduce((s, r) => s + (r.steps - avgSteps) ** 2, 0) / runs,
      );
      const ci95 = 1.96 * stdSteps / Math.sqrt(runs);
      const avgEvidence = results.reduce((s, r) => s + r.evidence_objects, 0) / runs;
      const edges = results[0].edges;
      const avgPareto = results.reduce((s, r) => s + r.pareto_cost, 0) / runs;
      const allConverged = results.every((r) => r.converged);

      const agg: AggRow = { topology: topo.label, numRoles: n, edges, avgSteps, stdSteps, avgEvidence, avgPareto, allConverged };
      aggRows.push(agg);

      rows.push([
        topo.label,
        String(n),
        String(edges),
        `${avgSteps.toFixed(1)} ±${ci95.toFixed(1)}`,
        avgEvidence.toFixed(0),
        avgPareto.toFixed(0),
        allConverged ? "yes" : "NO",
      ]);
    }
  }

  printTable(
    ["Topology", "n", "|E|", "Avg Steps (95%CI)", "Avg Evidence", "Pareto |E|×τ", "Conv"],
    rows,
  );

  // Pareto analysis at n=9
  console.log();
  console.log("Pareto analysis (n=9): cost = |E| × τ");
  const n9 = aggRows.filter((r) => r.numRoles === 9);
  n9.sort((a, b) => a.avgPareto - b.avgPareto);
  for (const r of n9) {
    const marker = r.avgPareto === n9[0].avgPareto ? " ← Pareto optimal" : "";
    console.log(
      `  ${r.topology.padEnd(14)} |E|=${String(r.edges).padStart(3)} × τ=${r.avgSteps.toFixed(1).padStart(6)} = ${r.avgPareto.toFixed(0).padStart(8)}${marker}`,
    );
  }

  // Edge scaling: ratio vs n=3 baseline for each topology
  console.log();
  console.log("Edge scaling ratios (relative to n=3 within each topology):");
  for (const topo of TOPOLOGIES) {
    const subset = aggRows.filter((r) => r.topology === topo.label);
    const baseline = subset.find((r) => r.numRoles === 3);
    if (!baseline || subset.length < 2) continue;
    const ratios = subset.map((r) =>
      `n=${r.numRoles}:${(r.avgEvidence / baseline.avgEvidence).toFixed(2)}x`,
    );
    console.log(`  ${topo.label.padEnd(14)} ${ratios.join("  ")}`);
  }

  const allPassed = allResults.every((r) => r.converged);
  console.log();
  console.log(
    `${allPassed ? "PASS" : "FAIL"}: ${allResults.length} runs, ` +
    `${allResults.filter((r) => r.converged).length} converged.`,
  );

  const result: ExperimentResult = {
    experiment: "E4-T",
    name: "Communication Cost Scaling across Topologies (Publication Grade)",
    timestamp: new Date().toISOString(),
    config: {
      numDims: NUM_DIMS,
      runs,
      maxSteps: MAX_STEPS,
      roleCounts: ROLE_COUNTS,
      topologies: TOPOLOGIES.map((t) => t.label),
    },
    runs: allResults,
    aggregate: {
      all_converged: allPassed,
      pareto_analysis_n9: n9.map((r) => ({
        topology: r.topology,
        edges: r.edges,
        avgSteps: r.avgSteps,
        paretoCost: r.avgPareto,
      })),
      scaling_data: aggRows,
    },
    success_criterion: "All topologies converge; Pareto cost identifies optimal topology; sparse topologies show sub-quadratic edge count",
    passed: allPassed,
  };

  writeResult("E4-T", result);
  process.exit(allPassed ? 0 : 1);
}

main();
