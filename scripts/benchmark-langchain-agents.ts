#!/usr/bin/env tsx
/**
 * LangChain agent benchmark for SGRS governance integration.
 *
 * Simulates LangChain agents using SGRS tools and governance enforcement.
 * Measures query latency, tool call count, governance overhead.
 *
 * NOTE: LangChain is not installed in this environment, so this benchmark
 * simulates the agent.generate() → tool_calls → tool.execute() loop.
 *
 * Usage:
 *   pnpm tsx scripts/benchmark-langchain-agents.ts
 *   pnpm tsx scripts/benchmark-langchain-agents.ts --scale=medium --runs=3
 *   pnpm tsx scripts/benchmark-langchain-agents.ts --agents=10 --queries=50
 *
 * Options:
 *   --agents=N        Number of concurrent agents (default 5).
 *   --scale=S         Scale preset: tiny (5), small (10), medium (20), large (50).
 *   --queries=N       Queries per agent (default 10).
 *   --runs=N          Run benchmark N times, report aggregate stats (default 1).
 *   --tool-calls=N    Simulated tool calls per query (default 3).
 */

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
  queries: number;
  runs: number;
  toolCallsPerQuery: number;
} {
  const args = process.argv.slice(2);
  let agents = 5;
  let queries = 10;
  let runs = 1;
  let toolCallsPerQuery = 3;

  for (const a of args) {
    if (a.startsWith("--agents="))
      agents = Math.max(1, parseInt(a.slice("--agents=".length), 10));
    else if (a.startsWith("--scale=")) {
      const scale = a.slice("--scale=".length);
      if (SCALE_PRESETS[scale] !== undefined) {
        agents = SCALE_PRESETS[scale];
      }
    } else if (a.startsWith("--queries="))
      queries = Math.max(1, parseInt(a.slice("--queries=".length), 10));
    else if (a.startsWith("--runs="))
      runs = Math.max(1, parseInt(a.slice("--runs=".length), 10));
    else if (a.startsWith("--tool-calls="))
      toolCallsPerQuery = Math.max(1, parseInt(a.slice("--tool-calls=".length), 10));
  }

  return { agents, queries, runs, toolCallsPerQuery };
}

// ---------------------------------------------------------------------------
// SGRS Tools for LangChain
// ---------------------------------------------------------------------------

interface ToolCall {
  toolName: string;
  input: Record<string, unknown>;
}

async function checkPolicyTool(
  agent: string,
  relation: string,
  target: string,
): Promise<{ allowed: boolean; error?: string }> {
  try {
    const result = await checkPermission(agent, relation, target);
    return result;
  } catch (e) {
    return { allowed: false, error: String(e) };
  }
}

async function evaluateKernelTool(
  kernelInput: KernelInput,
  governance: GovernanceConfig,
): Promise<{ verdict: string; reason: string; suggested_actions: string[] }> {
  return evaluateKernel(kernelInput, governance);
}

async function evaluateRulesTool(
  drift: { level: string; types: string[] },
  governance: GovernanceConfig,
): Promise<{ applicableRules: string[] }> {
  const rules = evaluateRules(drift, governance);
  return { applicableRules: rules };
}

// Simulated tool call
interface SimulatedToolCall {
  name: string;
  input: Record<string, unknown>;
}

async function executeSgrsToolCall(
  toolCall: SimulatedToolCall,
  governance: GovernanceConfig,
): Promise<{ success: boolean; output: unknown; latencyMs: number }> {
  const startTime = performance.now();

  try {
    let output: unknown;

    switch (toolCall.name) {
      case "check_policy":
        output = await checkPolicyTool(
          String(toolCall.input.agent || "agent-0"),
          String(toolCall.input.relation || "write"),
          String(toolCall.input.target || "node-0"),
        );
        break;

      case "evaluate_kernel":
        output = await evaluateKernelTool(
          {
            from_state: String(toolCall.input.from_state || "DriftChecked"),
            to_state: String(toolCall.input.to_state || "ContextIngested"),
            drift_level: String(toolCall.input.drift_level || "medium"),
            drift_types: (toolCall.input.drift_types as string[]) || ["goal"],
            mode: String(toolCall.input.mode || "YOLO"),
          },
          governance,
        );
        break;

      case "evaluate_rules":
        output = await evaluateRulesTool(
          {
            level: String(toolCall.input.level || "medium"),
            types: (toolCall.input.types as string[]) || ["goal"],
          },
          governance,
        );
        break;

      default:
        output = { status: "unknown_tool" };
    }

    const latencyMs = performance.now() - startTime;
    return { success: true, output, latencyMs };
  } catch (e) {
    const latencyMs = performance.now() - startTime;
    return { success: false, output: { error: String(e) }, latencyMs };
  }
}

// ---------------------------------------------------------------------------
// Query Execution
// ---------------------------------------------------------------------------

interface QueryResult {
  queryId: string;
  agentId: string;
  latencyMs: number;
  toolCallCount: number;
  successToolCalls: number;
  failedToolCalls: number;
  totalToolLatencyMs: number;
  agentReasoningTimeMs: number;
  success: boolean;
}

const SAMPLE_QUERIES = [
  {
    id: "q1",
    text: "What contradictions are active in the current state?",
    expectedToolCalls: ["evaluate_kernel", "evaluate_rules"],
  },
  {
    id: "q2",
    text: "Can agent-3 write to the FactsExtracted node?",
    expectedToolCalls: ["check_policy"],
  },
  {
    id: "q3",
    text: "Resolve the ARR discrepancy and verify governance allows the action.",
    expectedToolCalls: ["check_policy", "evaluate_kernel", "evaluate_rules"],
  },
  {
    id: "q4",
    text: "Check the current state transition rules.",
    expectedToolCalls: ["evaluate_rules"],
  },
  {
    id: "q5",
    text: "Verify agent permissions and governance alignment.",
    expectedToolCalls: ["check_policy", "evaluate_kernel"],
  },
];

async function executeQuery(
  agentId: string,
  queryId: string,
  governance: GovernanceConfig,
  toolCallsPerQuery: number,
): Promise<QueryResult> {
  const startTime = performance.now();
  const query = SAMPLE_QUERIES[parseInt(queryId) % SAMPLE_QUERIES.length];

  // Simulate agent.generate() → planning phase
  const planningTime = Math.random() * 50 + 10; // 10-60ms reasoning

  // Simulate tool_calls based on query
  const toolNames = ["check_policy", "evaluate_kernel", "evaluate_rules"];
  const toolCalls: SimulatedToolCall[] = Array.from(
    { length: Math.min(toolCallsPerQuery, query.expectedToolCalls.length) },
    (_, i) => ({
      name: query.expectedToolCalls[i] || toolNames[i % toolNames.length],
      input: {
        agent: agentId,
        relation: "write",
        target: "node-" + i,
        from_state: "DriftChecked",
        to_state: "ContextIngested",
        drift_level: "medium",
        level: "medium",
        types: ["goal"],
      },
    }),
  );

  // Execute tool calls
  let totalToolLatencyMs = 0;
  let successToolCalls = 0;
  let failedToolCalls = 0;

  for (const toolCall of toolCalls) {
    const result = await executeSgrsToolCall(toolCall, governance);
    totalToolLatencyMs += result.latencyMs;
    if (result.success) {
      successToolCalls++;
    } else {
      failedToolCalls++;
    }
  }

  // Simulate final reasoning phase
  const finalReasoningTime = Math.random() * 30 + 5; // 5-35ms final thinking

  const totalLatencyMs = performance.now() - startTime;
  const agentReasoningTimeMs = planningTime + finalReasoningTime;

  return {
    queryId: query.id,
    agentId,
    latencyMs: totalLatencyMs,
    toolCallCount: toolCalls.length,
    successToolCalls,
    failedToolCalls,
    totalToolLatencyMs,
    agentReasoningTimeMs,
    success: failedToolCalls === 0,
  };
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
  totalQueries: number;
  successCount: number;
  errorCount: number;
  elapsedSec: number;
  throughputQueriesSec: number;
  avgToolCallsPerQuery: number;
  latencies: {
    min: number;
    max: number;
    mean: number;
    p50: number;
    p95: number;
    p99: number;
    stddev: number;
  };
  toolLatencies: {
    totalMs: number;
    avgPerQuery: number;
  };
  reasoningLatencies: {
    totalMs: number;
    avgPerQuery: number;
  };
  governanceOverhead: number;
}

async function runBenchmark(
  numAgents: number,
  queriesPerAgent: number,
  toolCallsPerQuery: number,
): Promise<RunResult> {
  const policies = loadPolicies(GOVERNANCE_PATH);
  const governance = getGovernanceForScope("benchmark-scope", policies);

  const startWall = Date.now();
  const allResults: QueryResult[] = [];

  // Run queries from each agent
  for (let agentIdx = 0; agentIdx < numAgents; agentIdx++) {
    const agentId = `langchain-agent-${agentIdx}`;

    for (let queryIdx = 0; queryIdx < queriesPerAgent; queryIdx++) {
      const result = await executeQuery(
        agentId,
        String(queryIdx),
        governance,
        toolCallsPerQuery,
      );
      allResults.push(result);
    }
  }

  const elapsedMs = Date.now() - startWall;
  const elapsedSec = elapsedMs / 1000;
  const successCount = allResults.filter((r) => r.success).length;
  const errorCount = allResults.filter((r) => !r.success).length;
  const throughputQueriesSec = allResults.length / elapsedSec;
  const avgToolCallsPerQuery = mean(allResults.map((r) => r.toolCallCount));

  const latencies = allResults.map((r) => r.latencyMs).sort((a, b) => a - b);
  const totalToolLatency = allResults.reduce((sum, r) => sum + r.totalToolLatencyMs, 0);
  const totalReasoningLatency = allResults.reduce(
    (sum, r) => sum + r.agentReasoningTimeMs,
    0,
  );

  // Governance overhead = average tool latency per query
  const govOverhead = mean(allResults.map((r) => r.totalToolLatencyMs));

  return {
    totalQueries: allResults.length,
    successCount,
    errorCount,
    elapsedSec,
    throughputQueriesSec,
    avgToolCallsPerQuery,
    latencies: {
      min: latencies[0] ?? 0,
      max: latencies[latencies.length - 1] ?? 0,
      mean: mean(latencies),
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      stddev: stddev(latencies),
    },
    toolLatencies: {
      totalMs: totalToolLatency,
      avgPerQuery: totalToolLatency / allResults.length,
    },
    reasoningLatencies: {
      totalMs: totalReasoningLatency,
      avgPerQuery: totalReasoningLatency / allResults.length,
    },
    governanceOverhead: govOverhead,
  };
}

function printRunResults(result: RunResult): void {
  console.log("--- Results ---");
  console.log("  total queries:      " + result.totalQueries);
  console.log("  successful:         " + result.successCount);
  console.log("  errors:             " + result.errorCount);
  console.log("  elapsed (s):        " + result.elapsedSec.toFixed(2));
  console.log("  throughput:         " + result.throughputQueriesSec.toFixed(1) + " queries/s");
  console.log("  avg tool calls:     " + result.avgToolCallsPerQuery.toFixed(1));
  console.log("");

  console.log("  Query Latency (ms):");
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

  console.log("  Latency Breakdown:");
  console.log("    Governance tools: " + result.toolLatencies.avgPerQuery.toFixed(2) + "ms avg");
  console.log(
    "    Agent reasoning:  " +
      result.reasoningLatencies.avgPerQuery.toFixed(2) +
      "ms avg",
  );
  console.log("    Governance Overhead: " + result.governanceOverhead.toFixed(2) + "ms");
  console.log(
    "    Overhead %:       " +
      ((result.governanceOverhead / result.latencies.mean) * 100).toFixed(1) +
      "%",
  );
}

async function main(): Promise<void> {
  const { agents, queries, runs, toolCallsPerQuery } = parseArgs();

  console.log("LangChain agent benchmark with SGRS governance tools");
  console.log("  agents:               " + agents);
  console.log("  queries per agent:    " + queries);
  console.log("  runs:                 " + runs);
  console.log("  simulated tool calls: " + toolCallsPerQuery);
  console.log("");

  const runResults: RunResult[] = [];

  for (let runIdx = 0; runIdx < runs; runIdx++) {
    if (runs > 1) {
      console.log(`=== Run ${runIdx + 1}/${runs} ===`);
    }

    const result = await runBenchmark(agents, queries, toolCallsPerQuery);
    runResults.push(result);
    printRunResults(result);

    if (runIdx < runs - 1) console.log("");
  }

  if (runs > 1) {
    console.log("\n=== Aggregate Stats ===");
    const allThroughputs = runResults.map((r) => r.throughputQueriesSec);
    const allP99s = runResults.map((r) => r.latencies.p99);
    const allOverheads = runResults.map((r) => r.governanceOverhead);

    console.log("  throughput (queries/s): avg=" + mean(allThroughputs).toFixed(1));
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
        Math.max(...allP99s).toFixed(2),
    );
    console.log("  governance overhead (ms): avg=" + mean(allOverheads).toFixed(2));
    console.log(
      "    min=" +
        Math.min(...allOverheads).toFixed(2) +
        "  max=" +
        Math.max(...allOverheads).toFixed(2),
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
