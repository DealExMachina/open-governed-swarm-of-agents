/**
 * LangGraph M&A Topology — Standalone LangGraph agents solving Project Horizon.
 *
 * This is LangGraph WITHOUT SGRS governance. Standard LangGraph coordination:
 * - StateGraph with Annotation-based shared state
 * - Default: last-write-wins on each state key (no custom monotone reducers)
 * - Sequential agent pipeline processing each document
 * - No formal contradiction detection, no governance gates, no finality
 *
 * Per PRD Section 2.1: "Standard configuration: no custom monotone reducers,
 * last-write-wins semantics unless overridden. Production-grade."
 *
 * Uses @langchain/langgraph with @langchain/ollama (local) or @langchain/openai
 * against Ollama Cloud OpenAI-compatible `/v1` when `OLLAMA_API_KEY` is set.
 * Per-invoke token counts come from `AIMessage.usage_metadata` (or a char/4 fallback)
 * and are summed in state as `llmTokens` for M6 / scaling parity with other baselines.
 *
 * @see https://www.npmjs.com/package/@langchain/langgraph
 */

import { Annotation, StateGraph } from "@langchain/langgraph";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  HumanMessage,
  SystemMessage,
  isAIMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { BenchmarkOllamaInference } from "./benchmark-ollama-inference.js";
import type { BenchmarkScenarioPackage } from "../manifest/types.js";
import { temporalFieldsForClaim } from "../manifest/regulation.js";
import { logBenchmarkLlmGraphDoc } from "./benchmark-llm-progress.js";
import {
  DEFAULT_BENCHMARK_PACKAGE,
  mulberry32,
  loadDocumentTextForPackage,
  type SystemResult,
  type EpochResult,
  type AgentRole,
} from "./ma-scenario.js";

/** OpenAI-style usage on `response_metadata` (some providers). */
function tokensFromResponseMetadata(message: BaseMessage): number {
  const rm = (message as { response_metadata?: Record<string, unknown> }).response_metadata;
  const tu = rm?.token_usage as { total_tokens?: number } | undefined;
  if (tu && typeof tu.total_tokens === "number") return tu.total_tokens;
  return 0;
}

/**
 * Best-effort token count for benchmark M6 (aligned with Mastra/Agentica when possible).
 * Prefers LangChain `usage_metadata` from ChatOpenAI / ChatOllama; falls back to char/4 estimate.
 */
function tokensFromLlmInvoke(messages: BaseMessage[], response: BaseMessage): number {
  if (isAIMessage(response)) {
    const um = response.usage_metadata;
    if (um) {
      if (typeof um.total_tokens === "number" && um.total_tokens > 0) return um.total_tokens;
      const inT = typeof um.input_tokens === "number" ? um.input_tokens : 0;
      const outT = typeof um.output_tokens === "number" ? um.output_tokens : 0;
      if (inT + outT > 0) return inT + outT;
    }
    const fromRm = tokensFromResponseMetadata(response);
    if (fromRm > 0) return fromRm;
  }
  let promptChars = 0;
  for (const m of messages) {
    const c =
      typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    promptChars += c.length;
  }
  const text =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);
  return Math.ceil(promptChars / 4) + Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// LangGraph State Definition (Annotation API)
// ---------------------------------------------------------------------------

/**
 * M&A shared state — LangGraph standard TypedDict equivalent.
 *
 * Per PRD: No custom monotone reducers. Last-write-wins on each key.
 * This is the default LangGraph behavior when no reducer is specified.
 */
const MAStateAnnotation = Annotation.Root({
  currentDocument: Annotation<string>,
  currentEpoch: Annotation<number>,
  // Claims map: dimension -> claim object. Last-write-wins (default).
  claims: Annotation<
    Record<
      string,
      {
        content: string;
        agentId: string;
        epoch: number;
        confidence: number;
        regulationVersion: string;
        validTime: number;
      }
    >
  >,
  // Claim history: append-only for post-hoc analysis
  claimHistory: Annotation<
    Array<{
      dimension: string;
      content: string;
      agentId: string;
      epoch: number;
      confidence: number;
      regulationVersion: string;
      validTime: number;
    }>
  >({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),
  /** Sum of LLM usage for this graph run (one document); nodes add per-agent invoke. */
  llmTokens: Annotation<number>({
    reducer: (left, right) => left + right,
    default: () => 0,
  }),
});

type MAState = typeof MAStateAnnotation.State;

// ---------------------------------------------------------------------------
// Agent Node Factory
// ---------------------------------------------------------------------------

function makeAgentNode(
  role: AgentRole,
  llm: BaseChatModel | null,
  rng: () => number,
  skipLlm: boolean,
  pkg: BenchmarkScenarioPackage,
) {
  return async (state: MAState) => {
    const epoch = state.currentEpoch;
    const docId = state.currentDocument;
    const doc = pkg.documents.find((d) => d.id === docId);
    if (!doc) return { llmTokens: 0 };

    const roleMap = pkg.roleDimensionMap;
    const claimsUpdate = { ...state.claims };
    const newHistory: MAState["claimHistory"] = [];

    if (skipLlm) {
      // Deterministic mode
      const relevant = doc.expectedClaims.filter(
        (c) => (roleMap[role.id] || []).includes(c.dimension),
      );

      for (const c of relevant) {
        const conf = Math.min(1, c.confidence + (rng() * 0.2 - 0.1));
        const prev = state.claims[c.dimension];
        const t = temporalFieldsForClaim(pkg, epoch, prev, c.content);
        const claim = {
          content: c.content,
          agentId: role.id,
          epoch,
          confidence: conf,
          ...t,
        };
        claimsUpdate[c.dimension] = claim; // last-write-wins
        newHistory.push({ dimension: c.dimension, ...claim });
      }
    } else if (llm) {
      // LLM mode via Ollama (local) or OpenAI-compatible (e.g. Ollama Cloud)
      const docText = loadDocumentTextForPackage(pkg, doc);
      const messages = [
        new SystemMessage(
          role.systemPrompt +
            '\n\nRespond with a JSON array of claims: [{"dimension": "...", "content": "...", "confidence": 0.0-1.0}]',
        ),
        new HumanMessage(
          `Document: ${doc.title}\n---\n${docText}\n---\nExtract claims as JSON array.`,
        ),
      ];

      try {
        const response = await llm.invoke(messages);
        const text =
          typeof response.content === "string"
            ? response.content
            : JSON.stringify(response.content);

        const jsonMatch = text.match(/\[[\s\S]*?\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as Array<{
            dimension?: string;
            content?: string;
            confidence?: number;
          }>;
          for (const c of parsed) {
            const dim = c.dimension || "raw";
            const content = c.content || text.slice(0, 200);
            const prev = state.claims[dim];
            const t = temporalFieldsForClaim(pkg, epoch, prev, content);
            const claim = {
              content,
              agentId: role.id,
              epoch,
              confidence: c.confidence ?? 0.5,
              ...t,
            };
            claimsUpdate[dim] = claim;
            newHistory.push({ dimension: dim, ...claim });
          }
        }
        const llmTokens = tokensFromLlmInvoke(messages, response);
        return {
          claims: claimsUpdate,
          claimHistory: newHistory,
          llmTokens,
        };
      } catch {
        // LLM error — continue without claims
      }
    }

    return {
      claims: claimsUpdate,
      claimHistory: newHistory,
      llmTokens: 0,
    };
  };
}

// ---------------------------------------------------------------------------
// Graph Construction
// ---------------------------------------------------------------------------

function buildMAGraph(
  roles: AgentRole[],
  llm: BaseChatModel | null,
  rng: () => number,
  skipLlm: boolean,
  pkg: BenchmarkScenarioPackage,
) {
  const graph = new StateGraph(MAStateAnnotation);

  // Add a node for each agent role
  for (const role of roles) {
    graph.addNode(role.id, makeAgentNode(role, llm, rng, skipLlm, pkg));
  }

  // Sequential pipeline: role[0] -> role[1] -> ... -> END
  graph.addEdge("__start__", roles[0].id);
  for (let i = 0; i < roles.length - 1; i++) {
    graph.addEdge(roles[i].id, roles[i + 1].id);
  }
  graph.addEdge(roles[roles.length - 1].id, "__end__");

  return graph.compile();
}

// ---------------------------------------------------------------------------
// Main Benchmark Runner
// ---------------------------------------------------------------------------

export interface LangGraphTopologyConfig {
  model: string;
  inference: BenchmarkOllamaInference;
  numAgents: number;
  skipLlm: boolean;
  seed: number;
  maxTokens: number;
  /** Defaults to S1 (DEFAULT_BENCHMARK_PACKAGE). */
  package?: BenchmarkScenarioPackage;
}

export async function runLangGraphTopology(
  config: LangGraphTopologyConfig,
): Promise<SystemResult> {
  const pkg = config.package ?? DEFAULT_BENCHMARK_PACKAGE;
  const rng = mulberry32(config.seed);
  const roles = pkg.agentRoles.slice(0, config.numAgents);

  const llm: BaseChatModel | null = config.skipLlm
    ? null
    : config.inference.mode === "cloud"
      ? new ChatOpenAI({
          model: config.model,
          temperature: 0,
          maxTokens: config.maxTokens,
          apiKey: config.inference.apiKey,
          configuration: {
            baseURL: config.inference.openAICompatBaseUrl,
          },
        })
      : new ChatOllama({
          model: config.model,
          baseUrl: config.inference.nativeHost,
          temperature: 0,
          numPredict: config.maxTokens,
        });

  const compiled = buildMAGraph(roles, llm, rng, config.skipLlm, pkg);

  const startWall = Date.now();
  const epochResults: EpochResult[] = [];
  const stateSnapshots: Record<number, Array<{ dimension: string; content: string }>> = {};
  let totalTokens = 0;

  // Accumulate state across epochs (LangGraph processes one document at a time)
  let runningClaims: Record<
    string,
    {
      content: string;
      agentId: string;
      epoch: number;
      confidence: number;
      regulationVersion: string;
      validTime: number;
    }
  > = {};
  let runningHistory: Array<{
    dimension: string;
    content: string;
    agentId: string;
    epoch: number;
    confidence: number;
    regulationVersion: string;
    validTime: number;
  }> = [];

  for (const doc of pkg.documents) {
    const epochStart = performance.now();

    if (!config.skipLlm) {
      logBenchmarkLlmGraphDoc("langgraph", doc, roles.length);
    }

    // Invoke the graph for this document
    const result = await compiled.invoke({
      currentDocument: doc.id,
      currentEpoch: doc.epoch,
      claims: { ...runningClaims },
      claimHistory: [...runningHistory],
      llmTokens: 0,
    });

    const epochTokens =
      typeof result.llmTokens === "number" ? result.llmTokens : 0;
    totalTokens += epochTokens;

    const newClaims = result.claims || {};
    const newHistory = result.claimHistory || [];

    // Compute reversions
    let reversions = 0;
    const epochClaims: EpochResult["claims"] = [];

    for (const [dim, claim] of Object.entries(newClaims)) {
      if (
        runningClaims[dim] &&
        runningClaims[dim].content !== claim.content &&
        runningClaims[dim].epoch < doc.epoch
      ) {
        reversions++;
      }
      epochClaims.push({
        dimension: dim,
        content: claim.content,
        agentId: claim.agentId,
        confidence: claim.confidence,
      });
    }

    runningClaims = { ...newClaims };
    runningHistory = [...newHistory];

    // Snapshot
    stateSnapshots[doc.epoch] = Object.entries(runningClaims).map(
      ([dim, val]) => ({ dimension: dim, content: val.content }),
    );

    // Count contradictions from full history
    const dimContents = new Map<string, Set<string>>();
    for (const c of runningHistory.filter((c) => c.epoch <= doc.epoch)) {
      if (!dimContents.has(c.dimension)) dimContents.set(c.dimension, new Set());
      dimContents.get(c.dimension)!.add(c.content);
    }
    const contradictions = Array.from(dimContents.values()).filter(
      (s) => s.size > 1,
    ).length;

    epochResults.push({
      epoch: doc.epoch,
      document: doc.id,
      claims: epochClaims,
      contradictionsDetected: contradictions,
      semanticReversions: reversions,
      latencyMs: performance.now() - epochStart,
      tokensUsed: epochTokens,
    });
  }

  const finalState = Object.entries(runningClaims).map(([dim, val]) => ({
    dimension: dim,
    content: val.content,
    agentId: val.agentId,
    epoch: val.epoch,
    regulationVersion: val.regulationVersion,
    validTime: val.validTime,
  }));

  return {
    system: "langgraph",
    seed: config.seed,
    numAgents: config.numAgents,
    elapsedMs: Date.now() - startWall,
    totalTokens,
    epochs: epochResults,
    finalState,
    stateSnapshots,
    /** Same as documents processed; comparative harness does not instrument finality depth. */
    convergenceSteps: epochResults.length,
    bestSingleAgentScore: null,
    teamScore: null,
  };
}
