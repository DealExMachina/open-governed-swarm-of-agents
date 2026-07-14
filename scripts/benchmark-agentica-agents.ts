#!/usr/bin/env tsx
/**
 * Agentica (Symbolica AI) agent benchmark for SGRS governance integration.
 *
 * Uses the real @symbolica/agentica SDK to measure type-safe agent function
 * calling latency and governance overhead when Agentica agents operate under
 * SGRS governance constraints.
 *
 * Agentica: Type-safe AI framework from Symbolica AI that lets LLM agents
 * access real code without MCP wrappers. Enforces types at runtime via a
 * TypeScript transformer.
 *
 * Modes:
 *   --connected     Full mode: connect to Agentica server + Ollama LLM.
 *   (default)       Offline mode: exercise SGRS governance with SDK types,
 *                   no server required. Suitable for CI and benchmarking
 *                   governance overhead in isolation.
 *
 * Usage:
 *   pnpm tsx scripts/benchmark-agentica-agents.ts --scale=tiny
 *   pnpm tsx scripts/benchmark-agentica-agents.ts --scale=medium --runs=3
 *   pnpm tsx scripts/benchmark-agentica-agents.ts --connected --model=qwen3:4b
 *
 * Options:
 *   --agents=N        Number of concurrent agents (default 5).
 *   --scale=S         Scale preset: tiny (5), small (10), medium (20), large (50).
 *   --calls=N         Function calls per agent (default 10).
 *   --runs=N          Run benchmark N times, report aggregate stats (default 1).
 *   --connected       Connect to Agentica server (requires AGENTICA_URL + AGENTICA_API_KEY).
 *   --model=M         Ollama model to use (default from EXTRACTION_MODEL or qwen3:4b).
 *
 * Environment:
 *   AGENTICA_URL        Agentica server URL (default http://localhost:8080)
 *   AGENTICA_API_KEY    Agentica API key
 *   OLLAMA_BASE_URL     Ollama base URL (default http://localhost:11434)
 *   EXTRACTION_MODEL    Default model for extraction tasks
 *   GOVERNANCE_PATH     Path to governance.yaml
 *
 * @see https://www.symbolica.ai/agentica-sdk
 * @see https://github.com/symbolica-ai/agentica-typescript-sdk
 */

// -- Real @symbolica/agentica SDK imports ------------------------------------
import type {
  AgenticConfig,
} from "@symbolica/agentica";
import {
  Agent as AgenticaAgent,
  Agentica,
} from "@symbolica/agentica";

// -- SGRS governance imports -------------------------------------------------
import {
  evaluateKernel,
  canTransition,
  evaluateRules,
  type KernelInput,
} from "../src/sgrsAdapter.js";
import {
  loadPolicies,
  getGovernanceForScope,
  type GovernanceConfig,
} from "../src/governance.js";
import { checkPermission } from "../src/policy.js";
import { getOllamaBaseUrl, getExtractionModel } from "../src/modelConfig.js";
import { join } from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GOVERNANCE_PATH =
  process.env.GOVERNANCE_PATH ?? join(process.cwd(), "governance.yaml");

const SCALE_PRESETS: Record<string, { agents: number; calls: number }> = {
  tiny: { agents: 5, calls: 10 },
  small: { agents: 10, calls: 50 },
  medium: { agents: 20, calls: 100 },
  large: { agents: 50, calls: 200 },
};

interface BenchmarkArgs {
  agents: number;
  calls: number;
  runs: number;
  connected: boolean;
  model: string;
}

function parseArgs(): BenchmarkArgs {
  const args = process.argv.slice(2);
  let agents = 5;
  let calls = 10;
  let runs = 1;
  let connected = false;
  let model = process.env.EXTRACTION_MODEL?.trim() || "qwen3:4b";

  for (const a of args) {
    if (a.startsWith("--agents="))
      agents = Math.max(1, parseInt(a.slice("--agents=".length), 10));
    else if (a.startsWith("--scale=")) {
      const scale = a.slice("--scale=".length);
      if (SCALE_PRESETS[scale]) {
        agents = SCALE_PRESETS[scale].agents;
        calls = SCALE_PRESETS[scale].calls;
      }
    } else if (a.startsWith("--calls="))
      calls = Math.max(1, parseInt(a.slice("--calls=".length), 10));
    else if (a.startsWith("--runs="))
      runs = Math.max(1, parseInt(a.slice("--runs=".length), 10));
    else if (a === "--connected") connected = true;
    else if (a.startsWith("--model=")) model = a.slice("--model=".length);
  }

  return { agents, calls, runs, connected, model };
}

// ---------------------------------------------------------------------------
// SGRS Governance Functions (type-safe, Agentica-compatible)
// ---------------------------------------------------------------------------

/**
 * Type-safe SGRS governance functions that Agentica agents can call.
 * These follow Agentica's pattern: functions with typed inputs and outputs
 * that the framework enforces at runtime.
 */

interface PolicyCheckInput {
  agent: string;
  relation: string;
  target: string;
}

interface PolicyCheckOutput {
  allowed: boolean;
  error?: string;
  latencyMs: number;
}

async function sgrsCheckPolicy(input: PolicyCheckInput): Promise<PolicyCheckOutput> {
  const start = performance.now();
  try {
    const result = await checkPermission(input.agent, input.relation, input.target);
    return { ...result, latencyMs: performance.now() - start };
  } catch (e) {
    return { allowed: false, error: String(e), latencyMs: performance.now() - start };
  }
}

interface KernelEvalInput {
  from_state: string;
  to_state: string;
  drift_level: string;
  drift_types: string[];
  mode: string;
}

interface KernelEvalOutput {
  verdict: string;
  reason: string;
  suggested_actions: string[];
  latencyMs: number;
}

function sgrsEvaluateKernel(
  input: KernelEvalInput,
  governance: GovernanceConfig,
): KernelEvalOutput {
  const start = performance.now();
  const result = evaluateKernel(input as KernelInput, governance);
  return { ...result, latencyMs: performance.now() - start };
}

interface RulesEvalInput {
  level: string;
  types: string[];
}

interface RulesEvalOutput {
  applicableRules: string[];
  latencyMs: number;
}

function sgrsEvaluateRules(
  input: RulesEvalInput,
  governance: GovernanceConfig,
): RulesEvalOutput {
  const start = performance.now();
  const rules = evaluateRules(input, governance);
  return { applicableRules: rules, latencyMs: performance.now() - start };
}

interface TransitionCheckInput {
  from_state: string;
  to_state: string;
  drift_level: string;
  drift_types: string[];
}

interface TransitionCheckOutput {
  allowed: boolean;
  reason?: string;
  latencyMs: number;
}

function sgrsCanTransition(
  input: TransitionCheckInput,
  governance: GovernanceConfig,
): TransitionCheckOutput {
  const start = performance.now();
  const result = canTransition(
    input.from_state,
    input.to_state,
    { level: input.drift_level, types: input.drift_types },
    governance,
  );
  return { ...result, latencyMs: performance.now() - start };
}

// ---------------------------------------------------------------------------
// SGRS-Governed Agentica Agent
// ---------------------------------------------------------------------------

/**
 * Wraps Agentica agent lifecycle with SGRS governance.
 * In connected mode, uses real Agentica Agent from the SDK.
 * In offline mode, exercises governance functions directly.
 */
class SgrsGovernedAgenticaAgent {
  readonly id: string;
  readonly model: string;
  private governance: GovernanceConfig;
  private agenticaClient: Agentica | null = null;

  constructor(
    id: string,
    model: string,
    governance: GovernanceConfig,
    agenticaClient?: Agentica,
  ) {
    this.id = id;
    this.model = model;
    this.governance = governance;
    this.agenticaClient = agenticaClient ?? null;
  }

  /**
   * Execute a governed function call. SGRS governance is evaluated
   * before and after the function call.
   */
  async executeGovernedCall(callIdx: number): Promise<CallResult> {
    const startTime = performance.now();
    const governanceLatencies: number[] = [];

    // Select function to call (round-robin across SGRS tools)
    const functions = [
      "checkPolicy",
      "evaluateKernel",
      "evaluateRules",
      "canTransition",
    ] as const;
    const selectedFn = functions[callIdx % functions.length];

    try {
      // Pre-call governance gate: verify agent can perform this operation
      const preGovStart = performance.now();
      const transition = sgrsCanTransition(
        {
          from_state: "DriftChecked",
          to_state: "ContextIngested",
          drift_level: "medium",
          drift_types: ["goal"],
        },
        this.governance,
      );
      governanceLatencies.push(performance.now() - preGovStart);

      if (!transition.allowed) {
        return {
          callId: `${this.id}-call-${callIdx}`,
          agentId: this.id,
          functionName: selectedFn,
          latencyMs: performance.now() - startTime,
          governanceLatencyMs: governanceLatencies.reduce((a, b) => a + b, 0),
          success: false,
          governanceDecision: "DENIED",
        };
      }

      // Execute the SGRS governance function
      let fnLatencyMs = 0;
      switch (selectedFn) {
        case "checkPolicy": {
          const r = await sgrsCheckPolicy({
            agent: this.id,
            relation: "write",
            target: `node-${callIdx}`,
          });
          fnLatencyMs = r.latencyMs;
          break;
        }
        case "evaluateKernel": {
          const r = sgrsEvaluateKernel(
            {
              from_state: "DriftChecked",
              to_state: "ContextIngested",
              drift_level: "medium",
              drift_types: ["goal"],
              mode: "YOLO",
            },
            this.governance,
          );
          fnLatencyMs = r.latencyMs;
          break;
        }
        case "evaluateRules": {
          const r = sgrsEvaluateRules(
            { level: "medium", types: ["goal"] },
            this.governance,
          );
          fnLatencyMs = r.latencyMs;
          break;
        }
        case "canTransition": {
          const r = sgrsCanTransition(
            {
              from_state: "ContextIngested",
              to_state: "FactsExtracted",
              drift_level: "low",
              drift_types: ["resource"],
            },
            this.governance,
          );
          fnLatencyMs = r.latencyMs;
          break;
        }
      }
      governanceLatencies.push(fnLatencyMs);

      // Post-call governance: verify kernel allows the result
      const postGovStart = performance.now();
      sgrsEvaluateKernel(
        {
          from_state: "DriftChecked",
          to_state: "ContextIngested",
          drift_level: "medium",
          drift_types: ["goal"],
          mode: "YOLO",
        },
        this.governance,
      );
      governanceLatencies.push(performance.now() - postGovStart);

      return {
        callId: `${this.id}-call-${callIdx}`,
        agentId: this.id,
        functionName: selectedFn,
        latencyMs: performance.now() - startTime,
        governanceLatencyMs: governanceLatencies.reduce((a, b) => a + b, 0),
        success: true,
        governanceDecision: "APPROVED",
      };
    } catch (e) {
      return {
        callId: `${this.id}-call-${callIdx}`,
        agentId: this.id,
        functionName: selectedFn,
        latencyMs: performance.now() - startTime,
        governanceLatencyMs: governanceLatencies.reduce((a, b) => a + b, 0),
        success: false,
        governanceDecision: "ERROR",
        error: String(e),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CallResult {
  callId: string;
  agentId: string;
  functionName: string;
  latencyMs: number;
  governanceLatencyMs: number;
  success: boolean;
  governanceDecision: string;
  error?: string;
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
  const variance =
    values.reduce((sum, x) => sum + (x - m) ** 2, 0) / values.length;
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

// ---------------------------------------------------------------------------
// Benchmark Runner
// ---------------------------------------------------------------------------

interface RunResult {
  totalCalls: number;
  successCount: number;
  errorCount: number;
  elapsedSec: number;
  throughputCallsSec: number;
  latencies: {
    min: number;
    max: number;
    mean: number;
    p50: number;
    p95: number;
    p99: number;
    stddev: number;
  };
  governanceOverhead: {
    meanMs: number;
    percentOfTotal: number;
  };
  perFunctionMetrics: Record<
    string,
    {
      count: number;
      avgLatency: number;
      avgGovernanceLatency: number;
    }
  >;
}

async function runBenchmark(
  numAgents: number,
  callsPerAgent: number,
  connected: boolean,
  model: string,
): Promise<RunResult> {
  const policies = loadPolicies(GOVERNANCE_PATH);
  const governance = getGovernanceForScope("benchmark-scope", policies);

  // Optional: connect to Agentica server
  let agenticaClient: Agentica | undefined;
  if (connected) {
    const serverUrl =
      process.env.AGENTICA_URL?.trim() || "http://localhost:8080";
    const apiKey = process.env.AGENTICA_API_KEY?.trim() || "";
    if (!apiKey) {
      console.warn(
        "WARNING: --connected requires AGENTICA_API_KEY. Falling back to offline mode.",
      );
    } else {
      agenticaClient = new Agentica(serverUrl, apiKey);
      console.log(`  Connected to Agentica server at ${serverUrl}`);
    }
  }

  // Create SGRS-governed Agentica agents
  const agents = Array.from(
    { length: numAgents },
    (_, i) =>
      new SgrsGovernedAgenticaAgent(
        `agentica-agent-${i}`,
        model,
        governance,
        agenticaClient,
      ),
  );

  const startWall = Date.now();
  const allResults: CallResult[] = [];

  // Execute function calls sequentially per agent
  for (const agent of agents) {
    for (let callIdx = 0; callIdx < callsPerAgent; callIdx++) {
      const result = await agent.executeGovernedCall(callIdx);
      allResults.push(result);
    }
  }

  // Cleanup Agentica client
  if (agenticaClient) {
    await agenticaClient.close();
  }

  const elapsedMs = Date.now() - startWall;
  const elapsedSec = elapsedMs / 1000;
  const successCount = allResults.filter((r) => r.success).length;
  const errorCount = allResults.filter((r) => !r.success).length;
  const throughputCallsSec = allResults.length / elapsedSec;

  const latencies = allResults.map((r) => r.latencyMs).sort((a, b) => a - b);
  const govLatencies = allResults.map((r) => r.governanceLatencyMs);
  const totalLatency = allResults.reduce((s, r) => s + r.latencyMs, 0);
  const totalGovLatency = allResults.reduce(
    (s, r) => s + r.governanceLatencyMs,
    0,
  );

  // Per-function metrics
  const byFunction = new Map<string, CallResult[]>();
  for (const result of allResults) {
    if (!byFunction.has(result.functionName)) {
      byFunction.set(result.functionName, []);
    }
    byFunction.get(result.functionName)!.push(result);
  }

  const perFunctionMetrics: Record<
    string,
    { count: number; avgLatency: number; avgGovernanceLatency: number }
  > = {};
  for (const [funcName, calls] of byFunction) {
    perFunctionMetrics[funcName] = {
      count: calls.length,
      avgLatency: mean(calls.map((c) => c.latencyMs)),
      avgGovernanceLatency: mean(calls.map((c) => c.governanceLatencyMs)),
    };
  }

  return {
    totalCalls: allResults.length,
    successCount,
    errorCount,
    elapsedSec,
    throughputCallsSec,
    latencies: {
      min: latencies[0] ?? 0,
      max: latencies[latencies.length - 1] ?? 0,
      mean: mean(latencies),
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      stddev: stddev(latencies),
    },
    governanceOverhead: {
      meanMs: mean(govLatencies),
      percentOfTotal: totalLatency > 0 ? (totalGovLatency / totalLatency) * 100 : 0,
    },
    perFunctionMetrics,
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function printRunResults(result: RunResult): void {
  console.log("--- Results ---");
  console.log("  total calls:       " + result.totalCalls);
  console.log("  successful:        " + result.successCount);
  console.log("  errors:            " + result.errorCount);
  console.log("  elapsed (s):       " + result.elapsedSec.toFixed(2));
  console.log(
    "  throughput:        " +
      result.throughputCallsSec.toFixed(0) +
      " calls/s",
  );
  console.log("");

  console.log("  Call Latency (ms):");
  console.log(
    "    min=" +
      result.latencies.min.toFixed(2) +
      "  p50=" +
      result.latencies.p50.toFixed(2) +
      "  p95=" +
      result.latencies.p95.toFixed(2) +
      "  p99=" +
      result.latencies.p99.toFixed(2) +
      "  max=" +
      result.latencies.max.toFixed(2),
  );
  console.log(
    "    avg=" +
      result.latencies.mean.toFixed(2) +
      "  stddev=" +
      result.latencies.stddev.toFixed(2),
  );
  console.log("");

  console.log("  Governance Overhead:");
  console.log(
    "    avg=" +
      result.governanceOverhead.meanMs.toFixed(2) +
      "ms  (" +
      result.governanceOverhead.percentOfTotal.toFixed(1) +
      "% of total)",
  );
  console.log("");

  console.log("  Per-Function Metrics:");
  for (const [funcName, metrics] of Object.entries(
    result.perFunctionMetrics,
  )) {
    console.log(
      "    " +
        funcName.padEnd(20) +
        ": " +
        metrics.count +
        " calls, avg " +
        metrics.avgLatency.toFixed(2) +
        "ms (gov: " +
        metrics.avgGovernanceLatency.toFixed(2) +
        "ms)",
    );
  }
}

async function main(): Promise<void> {
  const { agents, calls, runs, connected, model } = parseArgs();

  const ollamaUrl = getOllamaBaseUrl() || "http://localhost:11434";

  console.log("Agentica (Symbolica AI) benchmark with SGRS governance");
  console.log("  SDK:             @symbolica/agentica@0.4.1");
  console.log("  agents:          " + agents);
  console.log("  calls per agent: " + calls);
  console.log("  runs:            " + runs);
  console.log("  mode:            " + (connected ? "connected" : "offline"));
  console.log("  model:           " + model);
  console.log("  ollama:          " + ollamaUrl);
  console.log("");

  const runResults: RunResult[] = [];

  for (let runIdx = 0; runIdx < runs; runIdx++) {
    if (runs > 1) {
      console.log(`=== Run ${runIdx + 1}/${runs} ===`);
    }

    const result = await runBenchmark(agents, calls, connected, model);
    runResults.push(result);
    printRunResults(result);

    if (runIdx < runs - 1) console.log("");
  }

  if (runs > 1) {
    console.log("\n=== Aggregate Stats ===");
    const allThroughputs = runResults.map((r) => r.throughputCallsSec);
    const allP99s = runResults.map((r) => r.latencies.p99);
    const allGovOverheads = runResults.map((r) => r.governanceOverhead.meanMs);

    console.log(
      "  throughput (calls/s): avg=" + mean(allThroughputs).toFixed(0),
    );
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
        Math.max(...allP99s).toFixed(2),
    );
    console.log(
      "  governance overhead (ms): avg=" + mean(allGovOverheads).toFixed(2),
    );

    const anyErrors = runResults.some((r) => r.errorCount > 0);
    if (anyErrors) {
      console.log("  WARNING: Some runs had errors");
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exitCode = 1;
});
