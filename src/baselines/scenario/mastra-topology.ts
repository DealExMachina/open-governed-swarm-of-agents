/**
 * Mastra M&A Topology — Standalone Mastra agents solving Project Horizon.
 *
 * This is Mastra WITHOUT SGRS governance. Standard Mastra coordination:
 * - Each agent processes documents independently
 * - Shared state via simple key-value store (last-write-wins)
 * - No formal contradiction detection
 * - No governance gates or finality predicates
 *
 * LLM calls use `@ai-sdk/openai-compatible` against Ollama’s OpenAI-compatible API
 * (`…/v1/chat/completions`). The comparative runner passes `BenchmarkOllamaInference`:
 * **local** (`OLLAMA_API_KEY` unset): native host + dummy key `ollama`; **cloud**
 * (`OLLAMA_API_KEY` set): `openAICompatBaseUrl` (e.g. `https://ollama.com/v1`) + Bearer token.
 * `supportsStructuredOutputs` stays false so Ollama is not sent `json_schema` response_format.
 *
 * Measures what happens when you use a standard agent framework
 * without structured governance for long-horizon shared state.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Agent } from "@mastra/core/agent";
import type { BenchmarkScenarioPackage } from "../manifest/types.js";
import type { BenchmarkOllamaInference } from "./benchmark-ollama-inference.js";
import { temporalFieldsForClaim } from "../manifest/regulation.js";
import { logBenchmarkLlmAgentStep } from "./benchmark-llm-progress.js";
import {
  DEFAULT_BENCHMARK_PACKAGE,
  loadDocumentTextForPackage,
  mulberry32,
  type SystemResult,
  type EpochResult,
  type AgentRole,
  type ScenarioDocument,
} from "./ma-scenario.js";

// ---------------------------------------------------------------------------
// Mastra shared state (simple key-value, last-write-wins)
// ---------------------------------------------------------------------------

interface SharedState {
  claims: Map<
    string,
    {
      content: string;
      agentId: string;
      epoch: number;
      confidence: number;
      regulationVersion: string;
      validTime: number;
    }
  >;
  allClaims: Array<{
    dimension: string;
    content: string;
    agentId: string;
    epoch: number;
    confidence: number;
    regulationVersion: string;
    validTime: number;
  }>;
}

function createSharedState(): SharedState {
  return {
    claims: new Map(),
    allClaims: [],
  };
}

// ---------------------------------------------------------------------------
// Agent creation
// ---------------------------------------------------------------------------

interface MastraAgentConfig {
  model: string;
  baseUrl: string;
  apiKey: string;
}

/**
 * Model id for Ollama's OpenAI-compatible `/v1/chat/completions` body — must be the
 * Ollama tag only (e.g. qwen3:4b), not Mastra's provider/model router form.
 */
function ollamaOpenAICompatModelId(model: string): string {
  const m = model.trim();
  if (!m.includes("/")) return m;
  return m.split("/").slice(1).join("/");
}

/**
 * Mastra's built-in `{ id: "ollama/…", url }` path uses OpenAI-compatible with
 * supportsStructuredOutputs=true, which sends json_schema response_format that Ollama
 * often rejects. Use AI SDK's compatible client with structured outputs disabled.
 */
function createOllamaLanguageModelForMastra(config: MastraAgentConfig) {
  const baseURL = config.baseUrl.replace(/\/+$/, "");
  return createOpenAICompatible({
    name: "ollama",
    apiKey: config.apiKey,
    baseURL,
    supportsStructuredOutputs: false,
  }).chatModel(ollamaOpenAICompatModelId(config.model));
}

function createMastraAgent(role: AgentRole, config: MastraAgentConfig): Agent {
  return new Agent({
    id: `mastra-${role.id}`,
    name: role.name,
    instructions: role.systemPrompt +
      "\n\nIMPORTANT: Respond in JSON format with an array of claims:" +
      '\n[{"dimension": "...", "content": "...", "confidence": 0.0-1.0}]' +
      "\nEach claim should be a factual finding from the document.",
    model: createOllamaLanguageModelForMastra(config),
  });
}

// ---------------------------------------------------------------------------
// Document processing
// ---------------------------------------------------------------------------

async function processDocumentWithAgent(
  agent: Agent,
  role: AgentRole,
  doc: ScenarioDocument,
  docText: string,
  state: SharedState,
  skipLlm: boolean,
  rng: () => number,
  pkg: BenchmarkScenarioPackage,
): Promise<{
  claims: Array<{ dimension: string; content: string; confidence: number }>;
  tokensUsed: number;
  latencyMs: number;
}> {
  const start = performance.now();

  if (skipLlm) {
    const roleMap = pkg.roleDimensionMap;
    const relevantClaims = doc.expectedClaims.filter((c) => {
      return (roleMap[role.id] || []).includes(c.dimension);
    });

    // Add some noise based on seed
    const claims = relevantClaims.map((c) => ({
      dimension: c.dimension,
      content: c.content,
      confidence: Math.min(1, c.confidence + (rng() * 0.2 - 0.1)),
    }));

    // Update shared state (last-write-wins)
    for (const claim of claims) {
      const prev = state.claims.get(claim.dimension);
      const t = temporalFieldsForClaim(pkg, doc.epoch, prev, claim.content);
      const row = {
        content: claim.content,
        agentId: role.id,
        epoch: doc.epoch,
        confidence: claim.confidence,
        ...t,
      };
      state.claims.set(claim.dimension, row);
      state.allClaims.push({ dimension: claim.dimension, ...row });
    }

    return {
      claims,
      tokensUsed: 0,
      latencyMs: performance.now() - start,
    };
  }

  // LLM mode: use Mastra agent
  const prompt = `Analyze this M&A due diligence document from your perspective as ${role.name}:

DOCUMENT: ${doc.title}
---
${docText}
---

Extract all relevant claims for your role. Return JSON array of claims.`;

  try {
    const result = await agent.generate(prompt, { maxSteps: 1 });
    const text = result.text || "";

    // Parse claims from LLM response
    let claims: Array<{ dimension: string; content: string; confidence: number }> = [];
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        claims = JSON.parse(jsonMatch[0]);
      }
    } catch {
      // Fallback: extract as unstructured claims
      claims = [{ dimension: "raw", content: text.slice(0, 200), confidence: 0.5 }];
    }

    // Update shared state
    for (const claim of claims) {
      const prev = state.claims.get(claim.dimension);
      const t = temporalFieldsForClaim(pkg, doc.epoch, prev, claim.content);
      const row = {
        content: claim.content,
        agentId: role.id,
        epoch: doc.epoch,
        confidence: claim.confidence ?? 0.5,
        ...t,
      };
      state.claims.set(claim.dimension, row);
      state.allClaims.push({ dimension: claim.dimension, ...row });
    }

    // Estimate tokens from response length
    const tokensUsed = Math.ceil(text.length / 4) + Math.ceil(prompt.length / 4);

    return {
      claims,
      tokensUsed,
      latencyMs: performance.now() - start,
    };
  } catch {
    return {
      claims: [],
      tokensUsed: 0,
      latencyMs: performance.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Main benchmark runner
// ---------------------------------------------------------------------------

export interface MastraTopologyConfig {
  /** Endpoint + model (local Ollama vs Ollama Cloud); same object as LangGraph/Agentica baselines. */
  inference: BenchmarkOllamaInference;
  numAgents: number;
  skipLlm: boolean;
  seed: number;
  package?: BenchmarkScenarioPackage;
}

export async function runMastraTopology(
  config: MastraTopologyConfig,
): Promise<SystemResult> {
  const pkg = config.package ?? DEFAULT_BENCHMARK_PACKAGE;
  const rng = mulberry32(config.seed);
  const roles = pkg.agentRoles.slice(0, config.numAgents);

  const agentConfig: MastraAgentConfig = {
    model: config.inference.model,
    baseUrl: config.inference.openAICompatBaseUrl,
    apiKey: config.inference.apiKey,
  };

  const agents = roles.map((role) => ({
    role,
    agent: createMastraAgent(role, agentConfig),
  }));

  const state = createSharedState();
  const stateSnapshots: Record<number, Array<{ dimension: string; content: string }>> = {};
  const epochResults: EpochResult[] = [];
  const startWall = Date.now();
  let totalTokens = 0;

  // Process each document (epoch) sequentially
  for (const doc of pkg.documents) {
    const epochStart = performance.now();
    const docText = loadDocumentTextForPackage(pkg, doc);
    let epochTokens = 0;
    const epochClaims: EpochResult["claims"] = [];

    // Each agent processes the document independently
    for (const { role, agent } of agents) {
      if (!config.skipLlm) {
        logBenchmarkLlmAgentStep("mastra", doc, role.id);
      }
      const result = await processDocumentWithAgent(
        agent,
        role,
        doc,
        docText,
        state,
        config.skipLlm,
        rng,
        pkg,
      );

      for (const claim of result.claims) {
        epochClaims.push({
          dimension: claim.dimension,
          content: claim.content,
          agentId: role.id,
          confidence: claim.confidence,
        });
      }
      epochTokens += result.tokensUsed;
    }

    // Snapshot state after this epoch
    stateSnapshots[doc.epoch] = Array.from(state.claims.entries()).map(
      ([dim, val]) => ({ dimension: dim, content: val.content }),
    );

    // Count contradictions: multiple different contents for same dimension
    const dimContents = new Map<string, Set<string>>();
    for (const claim of state.allClaims.filter((c) => c.epoch <= doc.epoch)) {
      if (!dimContents.has(claim.dimension)) dimContents.set(claim.dimension, new Set());
      dimContents.get(claim.dimension)!.add(claim.content);
    }
    const contradictions = Array.from(dimContents.values()).filter((s) => s.size > 1).length;

    // Semantic reversions: count overwrites in the last-write-wins map
    // (When a new claim overwrites an old one on the same dimension)
    let reversions = 0;
    for (const claim of epochClaims) {
      const existing = state.claims.get(claim.dimension);
      if (existing && existing.content !== claim.content && existing.epoch < doc.epoch) {
        reversions++;
      }
    }

    totalTokens += epochTokens;

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

  // Build final state
  const finalState = Array.from(state.claims.entries()).map(([dim, val]) => ({
    dimension: dim,
    content: val.content,
    agentId: val.agentId,
    epoch: val.epoch,
    regulationVersion: val.regulationVersion,
    validTime: val.validTime,
  }));

  return {
    system: "mastra",
    seed: config.seed,
    numAgents: config.numAgents,
    elapsedMs: Date.now() - startWall,
    totalTokens,
    epochs: epochResults,
    finalState,
    stateSnapshots,
    /** Same as documents processed; comparative harness does not instrument finality depth. */
    convergenceSteps: epochResults.length,
    bestSingleAgentScore: null, // Computed by evaluator
    teamScore: null, // Computed by evaluator
  };
}
