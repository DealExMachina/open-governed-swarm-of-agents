/**
 * Regression coverage for the @mastra/core 0.24.x -> 1.x (AI SDK v5) migration.
 *
 * These tests exercise the runtime contracts that the upgrade changed and that
 * a plain typecheck does NOT catch:
 *  - `createTool` execute signature is `(inputData, context)` (was `{ context }`).
 *  - `new Agent({ model: { id, url, apiKey } })` still accepts the OpenAI-compatible
 *    router config shape used across the swarm.
 *  - `generateWithStructuredOutput` forwards `structuredOutput.schema` and surfaces
 *    the parsed `.object`.
 *  - Token usage accounting reads AI SDK v5 (`inputTokens`/`outputTokens`) as well as
 *    the legacy v4 (`promptTokens`/`completionTokens`) shapes.
 *  - The facts agent tool pipeline runs end-to-end through the new tool signature.
 *
 * No live LLM / network is required: models are never invoked and all IO is mocked.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import { Agent } from "@mastra/core/agent";

import { generateWithStructuredOutput } from "../../src/mastraStructured.js";

// ── metrics + usage events are mocked so token accounting can be asserted ─────
const recordLLMTokens = vi.fn();
const recordLLMCall = vi.fn();
const recordUsageTokensFromContext = vi.fn(async () => {});

vi.mock("../../src/metrics.js", () => ({
  recordLLMTokens: (...args: unknown[]) => recordLLMTokens(...args),
  recordLLMCall: (...args: unknown[]) => recordLLMCall(...args),
}));
vi.mock("../../src/usageEvents.js", () => ({
  recordUsageTokensFromContext: (...args: unknown[]) =>
    recordUsageTokensFromContext(...args),
}));

// ── s3 / WAL / graph / sgrs / causal are mocked for the facts pipeline test ───
const s3GetText = vi.fn(async () => null as string | null);
const s3PutJson = vi.fn(async () => {});
const s3PutText = vi.fn(async () => {});
const s3ListKeys = vi.fn(async () => [] as string[]);
const tailEvents = vi.fn(async () => [] as Array<{ data: unknown }>);
const emitContribution = vi.fn(async () => {});
const syncFactsToSemanticGraph = vi.fn(async () => ({
  nodesCreated: 0,
  edgesCreated: 0,
  nodesUpdated: 0,
  nodesStaled: 0,
}));
const syncFactsToSgrs = vi.fn(async () => ({
  claims_synced: 0,
  contradictions_synced: 0,
  risks_synced: 0,
}));

vi.mock("../../src/s3.js", () => ({
  makeS3: () => ({}),
  s3GetText: (...args: unknown[]) => s3GetText(...(args as [])),
  s3PutJson: (...args: unknown[]) => s3PutJson(...(args as [])),
  s3PutText: (...args: unknown[]) => s3PutText(...(args as [])),
  s3ListKeys: (...args: unknown[]) => s3ListKeys(...(args as [])),
}));
vi.mock("../../src/contextWal.js", () => ({
  tailEvents: (...args: unknown[]) => tailEvents(...(args as [])),
  appendEvent: vi.fn(async () => 1),
}));
vi.mock("../../src/causalEmit.js", () => ({
  emitContribution: (...args: unknown[]) => emitContribution(...(args as [])),
}));
vi.mock("../../src/factsToSemanticGraph.js", () => ({
  syncFactsToSemanticGraph: (...args: unknown[]) =>
    syncFactsToSemanticGraph(...(args as [])),
}));
vi.mock("../../src/sgrsSync.js", () => ({
  syncFactsToSgrs: (...args: unknown[]) => syncFactsToSgrs(...(args as [])),
}));

// Imported after mocks are declared (vi.mock is hoisted regardless).
import { trackAgentTokens } from "../../src/skills/tokenTracker.js";
import { runFactsPipelineDirect } from "../../src/agents/factsAgent.js";
import { makeReadFactsTool, makeReadContextTool } from "../../src/agents/sharedTools.js";

describe("Mastra v1 createTool execute contract", () => {
  it("passes validated input as the first positional argument (inputData, context)", async () => {
    const seen: { input?: unknown; hasContextArg?: boolean } = {};
    const tool = createTool({
      id: "echo",
      description: "echo the input back",
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.object({ value: z.string() }),
      execute: async (inputData, context) => {
        seen.input = inputData;
        seen.hasContextArg = context !== undefined;
        return { value: inputData.value };
      },
    });

    const result = await tool.execute?.({ value: "hello" }, {});

    // The pre-1.x contract wrapped input as `{ context: {...} }`; v1 passes it directly.
    expect(seen.input).toEqual({ value: "hello" });
    expect((seen.input as { context?: unknown }).context).toBeUndefined();
    expect(seen.hasContextArg).toBe(true);
    expect(result).toEqual({ value: "hello" });
  });

  it("validates tool output against outputSchema at runtime (v1 behaviour)", async () => {
    const tool = createTool({
      id: "bad-output",
      description: "returns output that violates its schema",
      inputSchema: z.object({}),
      outputSchema: z.object({ required: z.string() }),
      // Intentionally missing `required`.
      execute: async () => ({}) as { required: string },
    });

    const result = (await tool.execute?.({}, {})) as Record<string, unknown>;
    // v1 returns a ValidationError object instead of silently passing invalid output.
    expect(result).toBeDefined();
    expect("error" in result).toBe(true);
  });
});

describe("Agent construction with OpenAI-compatible router config", () => {
  it("accepts the { id, url, apiKey } model shape used across the swarm", () => {
    const tool = createTool({
      id: "noop",
      description: "noop",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true }),
    });

    const agent = new Agent({
      id: "test-agent",
      name: "Test Agent",
      instructions: "You are a test agent.",
      model: {
        id: "openai/gpt-4o-mini",
        url: "http://localhost:11434/v1",
        apiKey: "test",
      },
      tools: { noop: tool },
    });

    expect(agent.id).toBe("test-agent");
  });
});

describe("generateWithStructuredOutput", () => {
  afterEach(() => vi.restoreAllMocks());

  it("forwards structuredOutput.schema + jsonPromptInjection and returns .object", async () => {
    const schema = z.object({ answer: z.string() });
    const calls: Array<{ prompt: unknown; options: Record<string, unknown> }> =
      [];
    const fakeAgent = {
      generate: (prompt: unknown, options: Record<string, unknown>) => {
        calls.push({ prompt, options });
        return Promise.resolve({
          object: { answer: "42" },
          usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
        });
      },
    } as unknown as Agent;

    const result = await generateWithStructuredOutput(
      fakeAgent,
      "What is the answer?",
      schema,
      { maxSteps: 4, modelSettings: { temperature: 0 } },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toBe("What is the answer?");
    const structured = calls[0].options.structuredOutput as {
      schema: unknown;
      jsonPromptInjection: boolean;
    };
    expect(structured.schema).toBe(schema);
    expect(structured.jsonPromptInjection).toBe(true);
    expect(calls[0].options.maxSteps).toBe(4);
    expect(result.object).toEqual({ answer: "42" });
  });
});

describe("trackAgentTokens usage-field compatibility", () => {
  beforeEach(() => {
    recordLLMTokens.mockClear();
    recordLLMCall.mockClear();
    recordUsageTokensFromContext.mockClear();
  });

  it("reads AI SDK v5 inputTokens/outputTokens", () => {
    trackAgentTokens("planner", {
      usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
    });

    expect(recordLLMCall).toHaveBeenCalledWith("planner", undefined);
    expect(recordLLMTokens).toHaveBeenCalledWith(
      "planner",
      "input",
      100,
      undefined,
    );
    expect(recordLLMTokens).toHaveBeenCalledWith(
      "planner",
      "output",
      40,
      undefined,
    );
    expect(recordUsageTokensFromContext).toHaveBeenCalledWith(
      "planner",
      100,
      40,
      undefined,
    );
  });

  it("falls back to legacy v4 promptTokens/completionTokens", () => {
    trackAgentTokens("drift", {
      usage: { promptTokens: 70, completionTokens: 25 },
    });

    expect(recordLLMTokens).toHaveBeenCalledWith(
      "drift",
      "input",
      70,
      undefined,
    );
    expect(recordLLMTokens).toHaveBeenCalledWith(
      "drift",
      "output",
      25,
      undefined,
    );
  });

  it("no-ops on results without usage", () => {
    trackAgentTokens("status", { object: { summary: "x" } });
    expect(recordLLMCall).not.toHaveBeenCalled();
    expect(recordLLMTokens).not.toHaveBeenCalled();
  });
});

describe("shared read tools receive inputData under v1", () => {
  beforeEach(() => {
    s3GetText.mockReset().mockResolvedValue(null);
    tailEvents.mockReset().mockResolvedValue([]);
  });

  it("readFacts parses stored JSON and returns { facts }", async () => {
    s3GetText.mockResolvedValueOnce(JSON.stringify({ claims: ["a", "b"] }));
    const tool = makeReadFactsTool({} as never, "bucket");
    const out = (await tool.execute?.({}, {})) as { facts: unknown };
    expect(out.facts).toEqual({ claims: ["a", "b"] });
  });

  it("readContext honours the limit passed as inputData (not wrapped in context)", async () => {
    tailEvents.mockResolvedValueOnce([{ data: { seq: 1 } }, { data: { seq: 2 } }]);
    const tool = makeReadContextTool(200);
    const out = (await tool.execute?.({ limit: 5 }, {})) as {
      context: unknown[];
    };
    expect(tailEvents).toHaveBeenCalledWith(5);
    expect(out.context).toEqual([{ seq: 1 }, { seq: 2 }]);
  });
});

describe("facts agent tool pipeline (runFactsPipelineDirect)", () => {
  beforeEach(() => {
    process.env.FACTS_WORKER_URL = "http://facts-worker.test";
    s3GetText.mockReset().mockResolvedValue(null);
    s3PutJson.mockReset().mockResolvedValue(undefined);
    tailEvents.mockReset().mockResolvedValue([]);
    emitContribution.mockReset().mockResolvedValue(undefined);
    syncFactsToSemanticGraph.mockClear();
    syncFactsToSgrs.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs readContext -> extractFacts -> writeFacts and persists via the v1 signature", async () => {
    const extracted = {
      facts: { claims: ["ARR is 38M"], hash: "abc123" },
      drift: { level: "low", types: ["factual"] },
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(extracted), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runFactsPipelineDirect({} as never, "swarm-facts");

    // The worker was called exactly once with the extract endpoint.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://facts-worker.test/extract");

    // writeFacts persisted facts, drift, and a history snapshot.
    const persistedKeys = s3PutJson.mock.calls.map((c) => c[2]);
    expect(persistedKeys).toContain("facts/latest.json");
    expect(persistedKeys).toContain("drift/latest.json");

    // Downstream propagation (semantic graph + causal DAG) ran.
    expect(syncFactsToSemanticGraph).toHaveBeenCalledTimes(1);
    expect(emitContribution).toHaveBeenCalled();

    // Pipeline surfaces the write result + facts hash.
    expect(result.wrote).toEqual(
      expect.arrayContaining(["facts/latest.json", "drift/latest.json"]),
    );
    expect(result.facts_hash).toBe("abc123");
  });
});
