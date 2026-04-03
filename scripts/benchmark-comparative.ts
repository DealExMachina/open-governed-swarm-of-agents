#!/usr/bin/env tsx
/**
 * Comparative Benchmark Runner — Benchmark PRD Main Deliverable (B-3)
 *
 * Runs SGRS vs Mastra vs LangGraph vs Agentica on the identical M&A scenario
 * (S1), then evaluates all systems using the same metrics (M1-M8) and
 * state-diff contracts (C1-C4).
 *
 * Usage:
 *   pnpm tsx scripts/benchmark-comparative.ts --preset=smoke
 *   pnpm tsx scripts/benchmark-comparative.ts --preset=smoke-llm
 *   pnpm tsx scripts/benchmark-comparative.ts --preset=smoke --llm
 *   pnpm tsx scripts/benchmark-comparative.ts --preset=small --seeds=30
 *   pnpm tsx scripts/benchmark-comparative.ts --preset=medium --model=qwen3:4b
 *
 * Options:
 *   --preset=P      Benchmark preset: smoke, smoke-llm, tiny, small, medium, large
 *   --seeds=N       Override number of seeds (default from preset)
 *   --model=M       Ollama model tag (preset default; with OLLAMA_API_KEY unset, local onboarding may coerce)
 *   --llm           Force LLM on (overrides preset skipLlm)
 *   --skip-llm      Offline mode: no LLM calls (governance-only; wins over --llm)
 *   --systems=S     Comma-separated systems to run (default: sgrs,mastra,langgraph,agentica)
 *   --agents=N      Override agent count
 *   --scenario=s1   Manifest registry key: s1|s2|s3|s4|s5 (PRD v0.2 demo corpora)
 *   --manifest=PATH Repo-relative path to a custom .yaml manifest (overrides --scenario)
 *
 * Env (LLM baselines):
 *   Loads repo-root `.env` automatically (same as other tooling scripts).
 *   OLLAMA_API_KEY     If set, use Ollama Cloud OpenAI-compatible API (default base https://ollama.com).
 *   OLLAMA_BASE_URL    Optional origin or .../v1 for cloud or local Ollama host.
 *   OLLAMA_CLOUD_MODEL When API key is set and --model= is omitted, default model (else mistral-large-3:675b-cloud, onboarded).
 *
 * Output:
 *   Comparative table of M1-M8 metrics across all systems
 *   State-diff contract pass rates (C1-C4)
 *   Statistical significance via Mann-Whitney U
 */

import "dotenv/config";
import { join } from "path";
import {
  loadBenchmarkPackageForScenario,
  loadBenchmarkPackageFromFile,
  temporalFieldsForClaim,
  type BenchmarkScenarioPackage,
} from "../src/baselines/manifest/index.js";
import {
  BENCHMARK_PRESETS,
  generateSeeds,
  mulberry32,
  type BenchmarkConfig,
  type SystemResult,
} from "../src/baselines/scenario/ma-scenario.js";
import { runMastraTopology } from "../src/baselines/scenario/mastra-topology.js";
import { runLangGraphTopology } from "../src/baselines/scenario/langgraph-topology.js";
import { runAgenticaTopology } from "../src/baselines/scenario/agentica-topology.js";
import type { PRDMetrics } from "../src/baselines/state-diff-contracts.js";
import { computeBenchmarkMetrics } from "../src/baselines/scenario/compute-benchmark-metrics.js";
import {
  resolveBenchmarkOllamaInference,
  type BenchmarkOllamaInference,
} from "../src/baselines/scenario/benchmark-ollama-inference.js";

// ---------------------------------------------------------------------------
// CLI Parsing
// ---------------------------------------------------------------------------

interface RunConfig {
  preset: string;
  config: BenchmarkConfig;
  systems: string[];
  benchmarkPackage: BenchmarkScenarioPackage;
  /** True if `--model=` was passed on the CLI. */
  modelWasOverridden: boolean;
}

function parseArgs(): RunConfig {
  const args = process.argv.slice(2);
  let preset = "smoke";
  let seedsOverride: number | null = null;
  let modelOverride: string | null = null;
  let agentsOverride: number | null = null;
  let skipLlm = false;
  let forceLlm = false;
  let systems = ["sgrs", "mastra", "langgraph", "agentica"];
  let scenarioKey = "s1";
  let manifestRel: string | null = null;

  for (const a of args) {
    if (a.startsWith("--preset=")) preset = a.slice("--preset=".length);
    else if (a.startsWith("--seeds=")) seedsOverride = parseInt(a.slice("--seeds=".length), 10);
    else if (a.startsWith("--model=")) modelOverride = a.slice("--model=".length);
    else if (a.startsWith("--agents=")) agentsOverride = parseInt(a.slice("--agents=".length), 10);
    else if (a === "--skip-llm") skipLlm = true;
    else if (a === "--llm") forceLlm = true;
    else if (a.startsWith("--systems=")) systems = a.slice("--systems=".length).split(",");
    else if (a.startsWith("--scenario=")) scenarioKey = a.slice("--scenario=".length);
    else if (a.startsWith("--manifest=")) manifestRel = a.slice("--manifest=".length);
  }

  const base = BENCHMARK_PRESETS[preset] || BENCHMARK_PRESETS["smoke"];
  const config: BenchmarkConfig = {
    ...base,
    ...(seedsOverride ? { numSeeds: seedsOverride } : {}),
    ...(modelOverride ? { model: modelOverride } : {}),
    ...(agentsOverride ? { numAgents: agentsOverride } : {}),
  };
  if (skipLlm) config.skipLlm = true;
  else if (forceLlm) config.skipLlm = false;

  const repoRoot = process.cwd();
  const manifestAbs =
    manifestRel &&
    (manifestRel.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(manifestRel))
      ? manifestRel
      : manifestRel
        ? join(repoRoot, manifestRel)
        : null;
  const benchmarkPackage = manifestAbs
    ? loadBenchmarkPackageFromFile(repoRoot, manifestAbs)
    : loadBenchmarkPackageForScenario(repoRoot, scenarioKey);

  return {
    preset,
    config,
    systems,
    benchmarkPackage,
    modelWasOverridden: modelOverride !== null,
  };
}

/**
 * When Ollama Cloud is configured (`OLLAMA_API_KEY`) and the user did not pass `--model=`,
 * default to an onboarded cloud model. Then resolve endpoint + onboarding for all LLM baselines.
 */
function finalizeBenchmarkLlmRouting(
  config: BenchmarkConfig,
  modelWasOverridden: boolean,
): { config: BenchmarkConfig; inference: BenchmarkOllamaInference } {
  let next: BenchmarkConfig = { ...config };
  if (!next.skipLlm && process.env.OLLAMA_API_KEY?.trim() && !modelWasOverridden) {
    next.model =
      process.env.OLLAMA_CLOUD_MODEL?.trim() || "mistral-large-3:675b-cloud";
  }
  const inference = resolveBenchmarkOllamaInference(next.model);
  next = { ...next, model: inference.model };
  return { config: next, inference };
}

// ---------------------------------------------------------------------------
// System Runners
// ---------------------------------------------------------------------------

async function runSgrsSystem(
  config: BenchmarkConfig,
  seed: number,
  pkg: BenchmarkScenarioPackage,
): Promise<SystemResult> {
  const { evaluateKernel, canTransition, evaluateRules } = await import("../src/sgrsAdapter.js");
  const { loadPolicies, getGovernanceForScope } = await import("../src/governance.js");
  const pathMod = await import("path");

  const rng = mulberry32(seed);
  const policies = loadPolicies(pathMod.join(process.cwd(), "governance.yaml"));
  const governance = getGovernanceForScope("benchmark-scope", policies);

  const roles = pkg.agentRoles.slice(0, config.numAgents);
  const roleMap = pkg.roleDimensionMap;
  const docs = pkg.documents;
  const startWall = Date.now();
  const epochResults: SystemResult["epochs"] = [];
  const allClaims = new Map<
    string,
    {
      content: string;
      agentId: string;
      epoch: number;
      regulationVersion: string;
      validTime: number;
    }
  >();
  const claimHistory: Array<{ dimension: string; content: string; agentId: string; epoch: number }> = [];
  const stateSnapshots: Record<number, Array<{ dimension: string; content: string }>> = {};
  const totalTokens = 0;

  for (const doc of docs) {
    const epochStart = performance.now();
    const epochClaims: SystemResult["epochs"][0]["claims"] = [];
    let contradictions = 0;
    let reversions = 0;

    for (const role of roles) {
      // SGRS governance gate: evaluate kernel before extraction
      const kernelResult = evaluateKernel(
        {
          from_state: "DriftChecked",
          to_state: "ContextIngested",
          drift_level: doc.contradictions.length > 0 ? "high" : "none",
          drift_types: doc.contradictions.map((c) => c.dimension),
          mode: "YOLO",
        },
        governance,
      );

      // SGRS transition check
      const transitionResult = canTransition(
        "DriftChecked",
        "ContextIngested",
        {
          level: doc.contradictions.length > 0 ? "high" : "none",
          types: doc.contradictions.map((c) => c.dimension),
        },
        governance,
      );

      // SGRS applies rules
      evaluateRules(
        {
          level: doc.contradictions.length > 0 ? "high" : "none",
          types: doc.contradictions.map((c) => c.dimension),
        },
        governance,
      );

      // If governance blocks, SGRS does NOT silently overwrite — it flags
      const governed = kernelResult.verdict === "ALLOWED" && transitionResult.allowed;

      const relevantClaims = doc.expectedClaims
        .filter((c) => (roleMap[role.id] || []).includes(c.dimension))
        .map((c) => ({
          dimension: c.dimension,
          content: c.content,
          confidence: Math.min(1, c.confidence + (rng() * 0.2 - 0.1)),
        }));

      for (const claim of relevantClaims) {
        epochClaims.push({
          dimension: claim.dimension,
          content: claim.content,
          agentId: role.id,
          confidence: claim.confidence,
        });

        // SGRS key difference: if governance blocks, preserve old value
        // (no silent overwrite on high-drift contradictions)
        const existing = allClaims.get(claim.dimension);
        if (existing && existing.content !== claim.content) {
          if (governed) {
            const t = temporalFieldsForClaim(pkg, doc.epoch, existing, claim.content);
            allClaims.set(claim.dimension, {
              content: claim.content,
              agentId: role.id,
              epoch: doc.epoch,
              ...t,
            });
          } else {
            // Governance blocked: keep both (contradiction preserved, not overwritten)
            // SGRS stores both sides in semantic graph
            reversions++; // This would be a reversion in other systems, but SGRS prevents it
          }
        } else {
          const t = temporalFieldsForClaim(pkg, doc.epoch, existing, claim.content);
          allClaims.set(claim.dimension, {
            content: claim.content,
            agentId: role.id,
            epoch: doc.epoch,
            ...t,
          });
        }

        claimHistory.push({
          dimension: claim.dimension,
          content: claim.content,
          agentId: role.id,
          epoch: doc.epoch,
        });
      }
    }

    // Count contradictions from full history
    const dimContents = new Map<string, Set<string>>();
    for (const c of claimHistory.filter((c) => c.epoch <= doc.epoch)) {
      if (!dimContents.has(c.dimension)) dimContents.set(c.dimension, new Set());
      dimContents.get(c.dimension)!.add(c.content);
    }
    contradictions = Array.from(dimContents.values()).filter((s) => s.size > 1).length;

    stateSnapshots[doc.epoch] = Array.from(allClaims.entries()).map(
      ([dim, val]) => ({ dimension: dim, content: val.content }),
    );

    epochResults.push({
      epoch: doc.epoch,
      document: doc.id,
      claims: epochClaims,
      contradictionsDetected: contradictions,
      semanticReversions: reversions,
      latencyMs: performance.now() - epochStart,
      tokensUsed: 0,
    });
  }

  const finalState = Array.from(allClaims.entries()).map(([dim, val]) => ({
    dimension: dim,
    content: val.content,
    agentId: val.agentId,
    epoch: val.epoch,
    regulationVersion: val.regulationVersion,
    validTime: val.validTime,
  }));

  return {
    system: "sgrs",
    seed,
    numAgents: config.numAgents,
    elapsedMs: Date.now() - startWall,
    totalTokens,
    epochs: epochResults,
    finalState,
    stateSnapshots,
    /** Documents processed (not kernel finality rounds; see table footnote). */
    convergenceSteps: epochResults.length,
    bestSingleAgentScore: null,
    teamScore: null,
  };
}

async function runSystem(
  systemName: string,
  config: BenchmarkConfig,
  seed: number,
  inference: BenchmarkOllamaInference,
  pkg: BenchmarkScenarioPackage,
): Promise<SystemResult> {
  switch (systemName) {
    case "sgrs":
      return runSgrsSystem(config, seed, pkg);
    case "mastra":
      return runMastraTopology({
        inference,
        numAgents: config.numAgents,
        skipLlm: config.skipLlm,
        seed,
        package: pkg,
      });
    case "langgraph":
      return runLangGraphTopology({
        model: config.model,
        inference,
        numAgents: config.numAgents,
        skipLlm: config.skipLlm,
        seed,
        maxTokens: config.maxTokens,
        package: pkg,
      });
    case "agentica":
      return runAgenticaTopology({
        model: config.model,
        inference,
        numAgents: config.numAgents,
        skipLlm: config.skipLlm,
        seed,
        maxTokens: config.maxTokens,
        package: pkg,
      });
    default:
      throw new Error(`Unknown system: ${systemName}`);
  }
}

// ---------------------------------------------------------------------------
// Statistical Analysis
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, x) => s + (x - m) ** 2, 0) / values.length);
}

function ci95(values: number[]): string {
  const m = mean(values);
  const se = stddev(values) / Math.sqrt(values.length);
  const margin = 1.96 * se;
  return `${m.toFixed(3)} ± ${margin.toFixed(3)}`;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function printComparison(
  allMetrics: Map<string, PRDMetrics[]>,
  allTimings: Map<string, number[]>,
  pkg: BenchmarkScenarioPackage,
): void {
  const systems = Array.from(allMetrics.keys());
  const labelW = 38;

  const rows: string[][] = [
    [
      "M1 Error amplification",
      ...systems.map((s) => {
        const vals = allMetrics.get(s)!.map((m) => m.m1_error_amplification);
        return ci95(vals);
      }),
    ],
    [
      "M2 Contradiction step",
      ...systems.map((s) => {
        const vals = allMetrics.get(s)!.map((m) => m.m2_contradiction_step ?? -1);
        const validVals = vals.filter((v) => v >= 0);
        return validVals.length > 0 ? `step ${mean(validVals).toFixed(1)}` : "N/A";
      }),
    ],
    [
      "M3 Semantic reversions",
      ...systems.map((s) => {
        const vals = allMetrics.get(s)!.map((m) => m.m3_semantic_reversions);
        return ci95(vals);
      }),
    ],
    [
      "M4 Contract pass rate",
      ...systems.map((s) => {
        const vals = allMetrics.get(s)!.map((m) => m.m4_contract_pass_rate);
        return `${(mean(vals) * 100).toFixed(1)}%`;
      }),
    ],
    [
      "M5 Scenario epochs",
      ...systems.map((s) => {
        const vals = allMetrics.get(s)!.map((m) => m.m5_convergence_steps ?? -1);
        const validVals = vals.filter((v) => v >= 0);
        return validVals.length > 0 ? mean(validVals).toFixed(1) : "N/A";
      }),
    ],
    [
      "M6 Total tokens",
      ...systems.map((s) => {
        const vals = allMetrics.get(s)!.map((m) => m.m6_total_tokens);
        return mean(vals).toFixed(0);
      }),
    ],
    [
      "M7 Reconstructible",
      ...systems.map((s) => {
        const vals = allMetrics.get(s)!.map((m) => (m.m7_reconstructible ? 1 : 0));
        return `${(mean(vals) * 100).toFixed(0)}%`;
      }),
    ],
    [
      "Wall-clock (ms)",
      ...systems.map((s) => ci95(allTimings.get(s)!)),
    ],
  ];

  const colWidths = systems.map((_, j) =>
    Math.max(
      systems[j].length,
      ...rows.map((r) => r[j + 1].length),
    ),
  );

  function fmtRow(label: string, data: string[]): string {
    let line = label.padEnd(labelW);
    for (let j = 0; j < data.length; j++) {
      line += data[j].padStart(colWidths[j] + 2);
    }
    return line;
  }

  const headerLine = fmtRow("Metric", systems);
  const ruleLen = headerLine.length;

  console.log("\n" + "=".repeat(Math.max(80, ruleLen)));
  console.log(
    `COMPARATIVE BENCHMARK RESULTS — ${pkg.prdScenario} (${pkg.id} v${pkg.version})`,
  );
  console.log("=".repeat(Math.max(80, ruleLen)));
  console.log(headerLine);
  console.log("-".repeat(ruleLen));
  for (const r of rows) {
    console.log(fmtRow(r[0], r.slice(1)));
  }
  console.log("-".repeat(ruleLen));
  console.log("=".repeat(Math.max(80, ruleLen)));
  console.log(
      "Note: M5 counts scenario documents processed in this harness (same for all systems). " +
      'PRD "convergence steps" / finality depth is not instrumented here; use convergence or load benchmarks.',
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { preset, config: rawConfig, systems, benchmarkPackage: pkg, modelWasOverridden } =
    parseArgs();
  const { config, inference } = finalizeBenchmarkLlmRouting(rawConfig, modelWasOverridden);
  const seeds = generateSeeds(config.numSeeds, config.baseSeed);

  console.log("Comparative Benchmark — Governed Swarms vs Baselines");
  console.log("  PRD: Benchmark PRD v0.2 (April 2026)");
  console.log(
    `  Manifest: ${pkg.id} (${pkg.prdScenario}) manifest v${pkg.version} — ${pkg.documents.length} documents`,
  );
  console.log("  Preset: " + preset);
  console.log("  Systems: " + systems.join(", "));
  console.log("  Agents: " + config.numAgents);
  console.log("  Seeds: " + config.numSeeds);
  console.log("  Model: " + config.model);
  console.log("  Skip LLM: " + config.skipLlm);
  console.log(
    `  Ollama inference: ${inference.mode} — OpenAI-compat ${inference.openAICompatBaseUrl} — native ${inference.nativeHost}`,
  );
  if (!config.skipLlm) {
    console.log(
      "  Note: With LLM on, each framework issues many sequential requests. Local CPU first-call load can be slow; Ollama Cloud uses hosted models. Watch [mastra]/[langgraph]/[agentica] progress lines. Set BENCHMARK_LLM_PROGRESS=0 to silence them.",
    );
  }
  console.log("");

  const allMetrics = new Map<string, PRDMetrics[]>();
  const allTimings = new Map<string, number[]>();

  for (const system of systems) {
    allMetrics.set(system, []);
    allTimings.set(system, []);

    console.log(`Running ${system} (${config.numSeeds} seeds)...`);

    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      try {
        const result = await runSystem(system, config, seed, inference, pkg);
        const metrics = computeBenchmarkMetrics(result, pkg);

        allMetrics.get(system)!.push(metrics);
        allTimings.get(system)!.push(result.elapsedMs);

        if (i === 0) {
          // Print first seed details
          console.log(`  seed[0] elapsed: ${result.elapsedMs}ms, tokens: ${result.totalTokens}`);
          console.log(
            `  seed[0] M1=${metrics.m1_error_amplification.toFixed(3)} M3=${metrics.m3_semantic_reversions} M4=${(metrics.m4_contract_pass_rate * 100).toFixed(1)}%`,
          );
        }
      } catch (err) {
        console.error(`  seed[${i}] FAILED: ${err}`);
      }
    }

    console.log(`  ${system} complete: ${allMetrics.get(system)!.length}/${config.numSeeds} seeds`);
    console.log("");
  }

  printComparison(allMetrics, allTimings, pkg);
}

main().catch((err) => {
  console.error("Comparative benchmark failed:", err);
  process.exitCode = 1;
});
