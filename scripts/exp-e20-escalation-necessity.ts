#!/usr/bin/env tsx
/**
 * E20 — Necessity of governance escalation.
 *
 * Runs four governance configurations on a controlled M&A-like trajectory:
 * - always-MASTER
 * - always-YOLO
 * - pressure-directed (current design intent)
 * - oracle (best action per step from a finite policy set)
 *
 * Usage:
 *   pnpm tsx scripts/exp-e20-escalation-necessity.ts
 *   pnpm tsx scripts/exp-e20-escalation-necessity.ts --runs=200 --seed=20
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

type Mode = "MASTER" | "MITL" | "YOLO";
type PolicyName = "always-master" | "always-yolo" | "pressure-directed" | "oracle";

interface SimState {
  omega: number;
  contradictionBurden: number;
  step: number;
}

interface RunMetrics {
  converged: boolean;
  stepsToConverge: number;
  escalations: number;
  unnecessaryEscalations: number;
}

interface Aggregate {
  policy: PolicyName;
  meanSteps: number;
  p95Steps: number;
  finalityRate: number;
  meanEscalations: number;
  meanUnnecessaryEscalations: number;
}

interface E20Summary {
  scenario: string;
  runs: number;
  seed: number;
  policies: Aggregate[];
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

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[idx];
}

function choosePressureDirected(state: SimState): Mode {
  if (state.omega > 0.65 || state.contradictionBurden > 0.45) return "MASTER";
  if (state.omega > 0.35 || state.contradictionBurden > 0.2) return "MITL";
  return "YOLO";
}

function transition(state: SimState, mode: Mode, rng: () => number): SimState {
  // Controlled dynamics calibrated for an M&A stress profile:
  // contradictions + uncertainty decay at different rates depending on governance strictness.
  const noise = (rng() - 0.5) * 0.03;
  let omegaDecay = 0;
  let contradictionDecay = 0;

  if (mode === "YOLO") {
    omegaDecay = 0.08;
    contradictionDecay = 0.05;
  } else if (mode === "MITL") {
    omegaDecay = 0.13;
    contradictionDecay = 0.1;
  } else {
    // MASTER
    omegaDecay = state.contradictionBurden > 0.25 ? 0.2 : 0.06;
    contradictionDecay = state.contradictionBurden > 0.25 ? 0.18 : 0.04;
  }

  // YOLO can overshoot under unresolved contradiction pressure.
  const yoloPenalty = mode === "YOLO" && state.contradictionBurden > 0.35 ? 0.04 : 0;

  const nextOmega = Math.max(0, Math.min(1, state.omega - omegaDecay + yoloPenalty + noise));
  const nextContradiction = Math.max(0, Math.min(1, state.contradictionBurden - contradictionDecay + Math.max(0, noise)));

  return {
    omega: nextOmega,
    contradictionBurden: nextContradiction,
    step: state.step + 1,
  };
}

function runWithPolicy(policy: PolicyName, rng: () => number, maxSteps = 50): RunMetrics {
  let state: SimState = {
    omega: 0.9 + (rng() - 0.5) * 0.06,
    contradictionBurden: 0.7 + (rng() - 0.5) * 0.06,
    step: 0,
  };

  let escalations = 0;
  let unnecessaryEscalations = 0;

  for (let t = 0; t < maxSteps; t++) {
    const mode: Mode =
      policy === "always-master"
        ? "MASTER"
        : policy === "always-yolo"
          ? "YOLO"
          : policy === "pressure-directed"
            ? choosePressureDirected(state)
            : // oracle: one-step lookahead over [YOLO, MITL, MASTER]
              (() => {
                const ranked = (["YOLO", "MITL", "MASTER"] as Mode[])
                  .map((m) => ({ m, s: transition(state, m, rng) }))
                  .sort(
                    (a, b) =>
                      a.s.omega + a.s.contradictionBurden - (b.s.omega + b.s.contradictionBurden),
                  );
                return ranked[0]?.m ?? "MITL";
              })();

    if (mode !== "YOLO") escalations++;
    if (mode === "MASTER" && state.omega < 0.3 && state.contradictionBurden < 0.2) unnecessaryEscalations++;

    state = transition(state, mode, rng);
    if (state.omega <= 0.05 && state.contradictionBurden <= 0.03) {
      return {
        converged: true,
        stepsToConverge: state.step,
        escalations,
        unnecessaryEscalations,
      };
    }
  }

  return {
    converged: false,
    stepsToConverge: maxSteps,
    escalations,
    unnecessaryEscalations,
  };
}

function aggregate(policy: PolicyName, runs: RunMetrics[]): Aggregate {
  const steps = runs.map((r) => r.stepsToConverge).sort((a, b) => a - b);
  const converged = runs.filter((r) => r.converged).length;
  const mean = (arr: number[]) => (arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length);

  return {
    policy,
    meanSteps: mean(steps),
    p95Steps: quantile(steps, 0.95),
    finalityRate: converged / runs.length,
    meanEscalations: mean(runs.map((r) => r.escalations)),
    meanUnnecessaryEscalations: mean(runs.map((r) => r.unnecessaryEscalations)),
  };
}

function main(): void {
  const runs = parseArg("runs", 200);
  const seed = parseArg("seed", 20);
  const rng = mulberry32(seed);

  const policies: PolicyName[] = ["always-master", "always-yolo", "pressure-directed", "oracle"];
  const results: Aggregate[] = [];

  for (const policy of policies) {
    const runResults: RunMetrics[] = [];
    for (let i = 0; i < runs; i++) {
      runResults.push(runWithPolicy(policy, rng));
    }
    results.push(aggregate(policy, runResults));
  }

  const summary: E20Summary = {
    scenario: "M&A controlled profile (Project Horizon proxy)",
    runs,
    seed,
    policies: results,
  };

  const outDir = join("artifacts", "experiments", "e20");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, "escalation-necessity-summary.json");
  writeFileSync(outFile, JSON.stringify(summary, null, 2));

  console.log("E20 — Necessity of governance escalation");
  console.log(`Runs: ${runs}, seed: ${seed}`);
  for (const r of results) {
    console.log(
      `${r.policy.padEnd(18)} steps=${r.meanSteps.toFixed(2)} p95=${r.p95Steps.toFixed(0)} finality=${(r.finalityRate * 100).toFixed(1)}% escal=${r.meanEscalations.toFixed(2)} unnecessary=${r.meanUnnecessaryEscalations.toFixed(2)}`,
    );
  }
  console.log(`Saved: ${outFile}`);
}

main();
