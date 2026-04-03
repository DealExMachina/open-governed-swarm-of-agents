#!/usr/bin/env tsx
/**
 * E19 — Quantify information loss at the Extract boundary.
 *
 * Compares a bilattice-aware finality predicate against a scalarized predicate
 * computed from net evidence projection.
 *
 * Usage:
 *   pnpm tsx scripts/exp-e19-extract-loss.ts
 *   pnpm tsx scripts/exp-e19-extract-loss.ts --samples=5000 --seed=19
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

type Vec4 = [number, number, number, number];
type Class = "contradiction" | "ignorance" | "supported" | "refuted" | "mixed";

interface BilatticeState {
  support: Vec4;
  refutation: Vec4;
}

interface E19Summary {
  samples: number;
  seed: number;
  thresholds: {
    plus: Vec4;
    minus: Vec4;
    scalar_dimension_threshold: number;
    scalar_goal_threshold: number;
    disagreement_limit: number;
  };
  disagreement_rate: number;
  disagreement_count: number;
  confusion: {
    bilattice_true_scalar_true: number;
    bilattice_true_scalar_false: number;
    bilattice_false_scalar_true: number;
    bilattice_false_scalar_false: number;
  };
  decision: "acceptable" | "too_lossy";
}

function parseArg(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const raw = Number.parseInt(hit.split("=")[1] ?? "", 10);
  return Number.isFinite(raw) ? raw : fallback;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function randomEvidencePair(rng: () => number): [number, number] {
  // Biased regimes to stress the projection boundary:
  // - clear support, clear refutation, contradiction, ignorance, ambiguous.
  const regime = rng();
  if (regime < 0.25) return [0.8 + rng() * 0.2, rng() * 0.25]; // strong support
  if (regime < 0.5) return [rng() * 0.25, 0.8 + rng() * 0.2]; // strong refutation
  if (regime < 0.7) return [0.75 + rng() * 0.25, 0.75 + rng() * 0.25]; // contradiction
  if (regime < 0.85) return [rng() * 0.2, rng() * 0.2]; // ignorance
  return [rng(), rng()]; // mixed
}

function randomState(rng: () => number): BilatticeState {
  const support: number[] = [];
  const refutation: number[] = [];
  for (let d = 0; d < 4; d++) {
    const [s, r] = randomEvidencePair(rng);
    support.push(s);
    refutation.push(r);
  }
  return {
    support: support as Vec4,
    refutation: refutation as Vec4,
  };
}

function classifyDim(s: number, r: number, plus: number, minus: number): Class {
  if (s >= plus && r >= plus) return "contradiction";
  if (s <= minus && r <= minus) return "ignorance";
  if (s >= plus && r <= minus) return "supported";
  if (s <= minus && r >= plus) return "refuted";
  return "mixed";
}

function bilatticeFinality(state: BilatticeState, plus: Vec4, minus: Vec4): boolean {
  for (let d = 0; d < 4; d++) {
    const c = classifyDim(state.support[d], state.refutation[d], plus[d], minus[d]);
    if (c !== "supported") return false;
  }
  return true;
}

function netEvidence(s: number, r: number): number {
  // map [-1, 1] -> [0, 1]
  const v = (s - r + 1) / 2;
  return Math.max(0, Math.min(1, v));
}

function scalarFinality(state: BilatticeState, _dimThreshold: number, goalThreshold: number): boolean {
  const dimScores: Vec4 = [
    netEvidence(state.support[0], state.refutation[0]),
    netEvidence(state.support[1], state.refutation[1]),
    netEvidence(state.support[2], state.refutation[2]),
    netEvidence(state.support[3], state.refutation[3]),
  ];

  // Existing scalar aggregation profile in the project.
  const weighted =
    dimScores[0] * 0.3 +
    dimScores[1] * 0.3 +
    dimScores[2] * 0.25 +
    dimScores[3] * 0.15;

  // Scalar path only sees the aggregate score.
  return weighted >= goalThreshold;
}

function main(): void {
  const samples = parseArg("samples", 1000);
  const seed = parseArg("seed", 19);
  const rng = mulberry32(seed);

  const plus: Vec4 = [0.85, 0.95, 0.9, 0.8];
  const minus: Vec4 = [0.15, 0.1, 0.15, 0.2];
  const scalarDimensionThreshold = 0.75;
  const scalarGoalThreshold = 0.92;
  const disagreementLimit = 0.05;

  const confusion = {
    bilattice_true_scalar_true: 0,
    bilattice_true_scalar_false: 0,
    bilattice_false_scalar_true: 0,
    bilattice_false_scalar_false: 0,
  };

  let disagreement = 0;
  for (let i = 0; i < samples; i++) {
    const state = randomState(rng);
    const b = bilatticeFinality(state, plus, minus);
    const s = scalarFinality(state, scalarDimensionThreshold, scalarGoalThreshold);
    if (b !== s) disagreement++;

    if (b && s) confusion.bilattice_true_scalar_true++;
    else if (b && !s) confusion.bilattice_true_scalar_false++;
    else if (!b && s) confusion.bilattice_false_scalar_true++;
    else confusion.bilattice_false_scalar_false++;
  }

  const disagreementRate = disagreement / samples;
  const summary: E19Summary = {
    samples,
    seed,
    thresholds: {
      plus,
      minus,
      scalar_dimension_threshold: scalarDimensionThreshold,
      scalar_goal_threshold: scalarGoalThreshold,
      disagreement_limit: disagreementLimit,
    },
    disagreement_rate: disagreementRate,
    disagreement_count: disagreement,
    confusion,
    decision: disagreementRate <= disagreementLimit ? "acceptable" : "too_lossy",
  };

  const outDir = join("artifacts", "experiments", "e19");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, "extract-loss-summary.json");
  writeFileSync(outFile, JSON.stringify(summary, null, 2));

  console.log("E19 — Extract boundary loss");
  console.log(`Samples: ${samples}, seed: ${seed}`);
  console.log(`Disagreement: ${(disagreementRate * 100).toFixed(2)}% (${disagreement}/${samples})`);
  console.log(`Decision (<=${disagreementLimit * 100}%): ${summary.decision}`);
  console.log(`Saved: ${outFile}`);
}

main();
