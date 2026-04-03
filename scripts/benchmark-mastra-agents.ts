#!/usr/bin/env tsx
/**
 * Mastra agent benchmark for SGRS governance overhead.
 *
 * Measures agent latency, throughput, and governance overhead when running
 * Mastra agents with SGRS governance enforcement.
 *
 * Usage:
 *   pnpm tsx scripts/benchmark-mastra-agents.ts
 *   pnpm tsx scripts/benchmark-mastra-agents.ts --scale=medium --runs=3
 *   pnpm tsx scripts/benchmark-mastra-agents.ts --agents=10 --tasks=100
 *
 * Options:
 *   --agents=N        Number of concurrent agents (default 5).
 *   --scale=S         Scale preset: tiny (5), small (10), medium (20), large (50).
 *   --tasks=N         Tasks per agent (default 10).
 *   --runs=N          Run benchmark N times, report aggregate stats (default 1).
 *   --skip-llm        Skip actual LLM calls, use deterministic mode (faster for testing).
 *   --model=M         Model to use (default from environment or gpt-4o-mini).
 */

import { Agent } from "@mastra/core/agent";
import { z } from "zod";
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
import { join } from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GOVERNANCE_PATH =
  process.env.GOVERNANCE_PATH ?? join(process.cwd(), "governance.yaml");

const SCALE_PRESETS: Record<string, number> = {
  tiny: 5,
  small: 10,
  medium: 20,
  large: 50,
};

function parseArgs(): {
  agents: number;
  tasks: number;
  runs: number;
  skipLlm: boolean;
  model: string;
} {
  const args = process.argv.slice(2);
  let agents = 5;
  let tasks = 10;
  let runs = 1;
  let skipLlm = false;
  let model = process.env.MASTRA_MODEL ?? "gpt-4o-mini";

  for (const a of args) {
    if (a.startsWith("--agents="))
      agents = Math.max(1, parseInt(a.slice("--agents=".length), 10));
    else if (a.startsWith("--scale=")) {
      const scale = a.slice("--scale=".length);
      if (SCALE_PRESETS[scale] !== undefined) {
        agents = SCALE_PRESETS[scale];
      }
    } else if (a.startsWith("--tasks="))
      tasks = Math.max(1, parseInt(a.slice("--tasks=".length), 10));
    else if (a.startsWith("--runs="))
      runs = Math.max(1, parseInt(a.slice("--runs=".length), 10));
    else if (a === "--skip-llm") skipLlm = true;
    else if (a.startsWith("--model=")) model = a.slice("--model=".length);
  }

  return { agents, tasks, runs, skipLlm, model };
}

// ---------------------------------------------------------------------------
// Task Definition
// ---------------------------------------------------------------------------

interface AgentTask {
  id: string;
  type: "governance" | "drift" | "resolution";
  input: string;
}

interface TaskResult {
  taskId: string;
  agentId: string;
  taskType: string;
  latencyMs: number;
  success: boolean;
  governanceDecision: string;
  error?: string;
}

// Deterministic tasks for reproducible benchmarking
function generateTask(agentId: string, taskIdx: number, type: string): AgentTask {
  const types = ["governance", "drift", "resolution"];
  const taskType = types[taskIdx % types.length];

  const inputs: Record<string, string> = {
    governance:
      "Check if agent can write to FactsExtracted node. Previous state: DriftChecked. Drift level: medium.",
    drift: "Analyze drift in current state. Goals: 80% complete. Risk score: 0.2. Active claims: 10.",
    resolution:
      "Resolve contradiction between ARR values. Side A: EUR 38M (auditor). Side B: EUR 42M (seller). Decision: EUR 38M is correct.",
  };

  return {
    id: `${agentId}-task-${taskIdx}`,
    type: taskType as any,
    input: inputs[taskType] || inputs["governance"],
  };
}

// ---------------------------------------------------------------------------
// Governance Integration
// ---------------------------------------------------------------------------

const KERNEL_INPUT: KernelInput = {
  from_state: "DriftChecked",
  to_state: "ContextIngested",
  drift_level: "medium",
  drift_types: ["contradiction", "goal"],
  mode: "YOLO",
};

async function evaluateGovernanceOffline(
  config: GovernanceConfig,
  _task: AgentTask,
): Promise<string> {
  // Offline governance check using sgrsAdapter (no LLM)
  const start = performance.now();
  const kernelOut = evaluateKernel(KERNEL_INPUT, config);
  const transitionOk = canTransition(
    "DriftChecked",
    "ContextIngested",
    { level: "medium", types: ["contradiction"] },
    config,
  );
  const rulesOut = evaluateRules({ level: "medium", types: ["goal"] }, config);
  performance.now() - start;

  return kernelOut.verdict === "ALLOWED" && transitionOk.allowed
    ? "APPROVED"
    : "DENIED";
}

// ---------------------------------------------------------------------------
// Mastra Agent Execution
// ---------------------------------------------------------------------------

async function runTaskWithAgent(
  agent: Agent,
  task: AgentTask,
  governance: GovernanceConfig,
  skipLlm: boolean,
): Promise<TaskResult> {
  const startTime = performance.now();

  try {
    // Pre-task governance check
    const govDecision = await evaluateGovernanceOffline(governance, task);

    if (skipLlm) {
      // Offline mode: use deterministic governance decision only
      const latencyMs = performance.now() - startTime;
      return {
        taskId: task.id,
        agentId: agent.id || "agent",
        taskType: task.type,
        latencyMs,
        success: govDecision === "APPROVED",
        governanceDecision: govDecision,
      };
    }

    // Online mode: use Mastra agent
    const prompt = `Task: ${task.type}
Input: ${task.input}

Based on the above, provide a brief decision (APPROVED or DENIED) with one sentence justification.`;

    const result = await agent.generate(prompt, {
      maxSteps: 1,
    });

    const latencyMs = performance.now() - startTime;
    const output = result.text || "";
    const success = output.includes("APPROVED") && govDecision === "APPROVED";

    return {
      taskId: task.id,
      agentId: agent.id || "agent",
      taskType: task.type,
      latencyMs,
      success,
      governanceDecision: govDecision,
    };
  } catch (error) {
    const latencyMs = performance.now() - startTime;
    return {
      taskId: task.id,
      agentId: agent.id || "agent",
      taskType: task.type,
      latencyMs,
      success: false,
      governanceDecision: "ERROR",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
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

interface RunResult {
  totalTasks: number;
  successCount: number;
  errorCount: number;
  elapsedSec: number;
  throughputTasksSec: number;
  latencies: {
    min: number;
    max: number;
    mean: number;
    p50: number;
    p95: number;
    p99: number;
    stddev: number;
  };
  perAgentMetrics: Array<{
    agentId: string;
    taskCount: number;
    avgLatency: number;
  }>;
  governanceOverhead: number;
}

async function runBenchmark(
  numAgents: number,
  tasksPerAgent: number,
  skipLlm: boolean,
  model: string,
): Promise<RunResult> {
  const policies = loadPolicies(GOVERNANCE_PATH);
  const governance = getGovernanceForScope("benchmark-scope", policies);

  // Create agents (reuse demo pattern)
  const agents = Array.from({ length: numAgents }, (_, i) => {
    return new Agent({
      id: `benchmark-agent-${i}`,
      name: `Benchmark Agent ${i}`,
      instructions: "You are a governance assistant. Respond with APPROVED or DENIED.",
      model: {
        id: model as any,
        url: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
        apiKey: process.env.OPENAI_API_KEY || "",
      },
    });
  });

  const startWall = Date.now();
  const allResults: TaskResult[] = [];

  // Run tasks sequentially per agent (deterministic ordering)
  for (const agent of agents) {
    const agentTasks = Array.from({ length: tasksPerAgent }, (_, i) =>
      generateTask(agent.id || "agent", i, "governance"),
    );

    for (const task of agentTasks) {
      const result = await runTaskWithAgent(agent, task, governance, skipLlm);
      allResults.push(result);
    }
  }

  const elapsedMs = Date.now() - startWall;
  const elapsedSec = elapsedMs / 1000;
  const successCount = allResults.filter((r) => r.success).length;
  const errorCount = allResults.filter((r) => r.error).length;
  const throughputTasksSec = allResults.length / elapsedSec;

  const latencies = allResults.map((r) => r.latencyMs).sort((a, b) => a - b);

  // Per-agent aggregation
  const byAgent = new Map<string, TaskResult[]>();
  for (const result of allResults) {
    if (!byAgent.has(result.agentId)) byAgent.set(result.agentId, []);
    byAgent.get(result.agentId)!.push(result);
  }

  const perAgentMetrics = Array.from(byAgent.entries()).map(([agentId, results]) => ({
    agentId,
    taskCount: results.length,
    avgLatency: mean(results.map((r) => r.latencyMs)),
  }));

  // Estimate governance overhead (deterministic portion vs total)
  const govOnlyLatencies = allResults
    .filter((r) => r.latencyMs < 100) // Governance-only tasks (no LLM)
    .map((r) => r.latencyMs);
  const govOnlyMean = mean(govOnlyLatencies);

  return {
    totalTasks: allResults.length,
    successCount,
    errorCount,
    elapsedSec,
    throughputTasksSec,
    latencies: {
      min: latencies[0] ?? 0,
      max: latencies[latencies.length - 1] ?? 0,
      mean: mean(latencies),
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      stddev: stddev(latencies),
    },
    perAgentMetrics,
    governanceOverhead: govOnlyMean,
  };
}

function printRunResults(result: RunResult): void {
  console.log("--- Results ---");
  console.log("  total tasks:    " + result.totalTasks);
  console.log("  successful:     " + result.successCount);
  console.log("  errors:         " + result.errorCount);
  console.log("  elapsed (s):    " + result.elapsedSec.toFixed(2));
  console.log("  throughput:     " + result.throughputTasksSec.toFixed(1) + " tasks/s");
  console.log("");

  console.log("  Latency (ms):");
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

  if (result.perAgentMetrics.length > 0) {
    console.log("  Per-Agent Metrics:");
    for (const agent of result.perAgentMetrics.slice(0, 3)) {
      console.log(
        "    " +
          agent.agentId +
          ": " +
          agent.taskCount +
          " tasks, avg latency " +
          agent.avgLatency.toFixed(2) +
          "ms",
      );
    }
    if (result.perAgentMetrics.length > 3) {
      console.log("    ... and " + (result.perAgentMetrics.length - 3) + " more agents");
    }
  }

  console.log("");
  console.log("  Governance Overhead: " + result.governanceOverhead.toFixed(2) + "ms");
}

async function main(): Promise<void> {
  const { agents, tasks, runs, skipLlm, model } = parseArgs();

  console.log("Mastra agent benchmark with SGRS governance");
  console.log("  agents:         " + agents);
  console.log("  tasks per agent: " + tasks);
  console.log("  runs:           " + runs);
  console.log("  skip LLM:       " + skipLlm);
  console.log("  model:          " + model);
  console.log("");

  const runResults: RunResult[] = [];

  for (let runIdx = 0; runIdx < runs; runIdx++) {
    if (runs > 1) {
      console.log(`=== Run ${runIdx + 1}/${runs} ===`);
    }

    const result = await runBenchmark(agents, tasks, skipLlm, model);
    runResults.push(result);
    printRunResults(result);

    if (runIdx < runs - 1) console.log("");
  }

  if (runs > 1) {
    console.log("\n=== Aggregate Stats ===");
    const allThroughputs = runResults.map((r) => r.throughputTasksSec);
    const allP99s = runResults.map((r) => r.latencies.p99);

    console.log("  throughput (tasks/s): avg=" + mean(allThroughputs).toFixed(1));
    console.log(
      "    min=" +
        Math.min(...allThroughputs).toFixed(1) +
        "  max=" +
        Math.max(...allThroughputs).toFixed(1) +
        "  stddev=" +
        stddev(allThroughputs).toFixed(1),
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
