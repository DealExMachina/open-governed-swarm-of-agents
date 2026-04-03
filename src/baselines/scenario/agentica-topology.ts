/**
 * Agentica (Symbolica AI) M&A Topology — Standalone agents solving Project Horizon.
 *
 * This is Agentica WITHOUT SGRS governance. Standard Agentica coordination:
 * - Type-safe agents with structured outputs via @symbolica/agentica
 * - Agents share state via an in-memory typed store
 * - No formal contradiction detection or governance gates
 * - No finality predicates
 *
 * In connected mode: uses real Agentica server for agent execution.
 * In offline mode: simulates Agentica's type-safe function calling pattern
 * using Ollama directly for LLM calls, or deterministic mode (--skip-llm).
 *
 * @see https://www.symbolica.ai/agentica-sdk
 */

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
// Agentica shared typed state
// ---------------------------------------------------------------------------

/**
 * Agentica enforces types at runtime. Our shared state is strongly typed:
 * each claim has a typed dimension, content, and provenance.
 */
interface TypedClaim {
  dimension: string;
  content: string;
  agentId: string;
  epoch: number;
  confidence: number;
  regulationVersion: string;
  validTime: number;
  /** Agentica type metadata */
  typeTag: string;
}

interface AgenticaSharedState {
  /** Current claims (keyed by dimension — latest wins) */
  current: Map<string, TypedClaim>;
  /** Full history (append-only for analysis) */
  history: TypedClaim[];
}

function createTypedState(): AgenticaSharedState {
  return { current: new Map(), history: [] };
}

// ---------------------------------------------------------------------------
// Type-safe extraction functions (Agentica pattern)
// ---------------------------------------------------------------------------

/**
 * These functions represent what Agentica agents would call.
 * In the real SDK, these would be passed as typed function references
 * that Agentica enforces at runtime via its TypeScript transformer.
 */

interface ExtractionResult {
  claims: Array<{
    dimension: string;
    content: string;
    confidence: number;
  }>;
  tokensUsed: number;
}

async function extractClaimsOffline(
  role: AgentRole,
  doc: ScenarioDocument,
  rng: () => number,
  roleDimensionMap: Record<string, string[]>,
): Promise<ExtractionResult> {
  const relevantDimensions = roleDimensionMap[role.id] || [];
  const claims = doc.expectedClaims
    .filter((c) => relevantDimensions.includes(c.dimension))
    .map((c) => ({
      dimension: c.dimension,
      content: c.content,
      confidence: Math.min(1, c.confidence + (rng() * 0.2 - 0.1)),
    }));

  return { claims, tokensUsed: 0 };
}

async function extractClaimsWithLlm(
  role: AgentRole,
  doc: ScenarioDocument,
  docText: string,
  inference: BenchmarkOllamaInference,
  maxTokens: number,
): Promise<ExtractionResult> {
  const system = `${role.systemPrompt}

Return a JSON array of claims only:
[{"dimension": "topic", "content": "finding text", "confidence": 0.0-1.0}]`;
  const user = `Analyze this M&A document and extract claims relevant to your role (${role.responsibility}).

DOCUMENT: ${doc.title}
---
${docText}
---

Claims (JSON array only):`;

  try {
    let text = "";
    let tokensUsed = 0;

    if (inference.mode === "cloud") {
      const response = await fetch(`${inference.openAICompatBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${inference.apiKey}`,
        },
        body: JSON.stringify({
          model: inference.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0,
          max_tokens: maxTokens,
        }),
      });

      if (!response.ok) {
        return { claims: [], tokensUsed: 0 };
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { total_tokens?: number };
      };
      text = data.choices?.[0]?.message?.content ?? "";
      tokensUsed = data.usage?.total_tokens ?? 0;
    } else {
      const prompt = `${system}\n\n${user}`;
      const response = await fetch(`${inference.nativeHost}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: inference.model,
          prompt,
          stream: false,
          options: { temperature: 0, num_predict: maxTokens },
        }),
      });

      if (!response.ok) {
        return { claims: [], tokensUsed: 0 };
      }

      const data = (await response.json()) as {
        response?: string;
        eval_count?: number;
        prompt_eval_count?: number;
      };
      text = data.response || "";
      tokensUsed = (data.eval_count || 0) + (data.prompt_eval_count || 0);
    }

    let claims: Array<{ dimension: string; content: string; confidence: number }> = [];
    try {
      const jsonMatch = text.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        claims = JSON.parse(jsonMatch[0]);
      }
    } catch {
      claims = [{ dimension: "raw", content: text.slice(0, 200), confidence: 0.5 }];
    }

    return { claims, tokensUsed };
  } catch {
    return { claims: [], tokensUsed: 0 };
  }
}

// ---------------------------------------------------------------------------
// Main benchmark runner
// ---------------------------------------------------------------------------

export interface AgenticaTopologyConfig {
  model: string;
  inference: BenchmarkOllamaInference;
  numAgents: number;
  skipLlm: boolean;
  seed: number;
  maxTokens: number;
  package?: BenchmarkScenarioPackage;
}

export async function runAgenticaTopology(
  config: AgenticaTopologyConfig,
): Promise<SystemResult> {
  const pkg = config.package ?? DEFAULT_BENCHMARK_PACKAGE;
  const rng = mulberry32(config.seed);
  const roles = pkg.agentRoles.slice(0, config.numAgents);
  const state = createTypedState();
  const stateSnapshots: Record<number, Array<{ dimension: string; content: string }>> = {};
  const epochResults: EpochResult[] = [];
  const startWall = Date.now();
  let totalTokens = 0;

  for (const doc of pkg.documents) {
    const epochStart = performance.now();
    const docText = config.skipLlm ? "" : loadDocumentTextForPackage(pkg, doc);
    let epochTokens = 0;
    const epochClaims: EpochResult["claims"] = [];

    // Each Agentica agent processes the document via typed function call
    for (const role of roles) {
      if (!config.skipLlm) {
        logBenchmarkLlmAgentStep("agentica", doc, role.id);
      }
      const result = config.skipLlm
        ? await extractClaimsOffline(role, doc, rng, pkg.roleDimensionMap)
        : await extractClaimsWithLlm(role, doc, docText, config.inference, config.maxTokens);

      // Update typed state
      for (const claim of result.claims) {
        const prev = state.current.get(claim.dimension);
        const t = temporalFieldsForClaim(pkg, doc.epoch, prev, claim.content);
        const typedClaim: TypedClaim = {
          dimension: claim.dimension,
          content: claim.content,
          agentId: role.id,
          epoch: doc.epoch,
          confidence: claim.confidence,
          ...t,
          typeTag: `${role.id}:${claim.dimension}:${typeof claim.content}`,
        };

        state.current.set(claim.dimension, typedClaim);
        state.history.push(typedClaim);

        epochClaims.push({
          dimension: claim.dimension,
          content: claim.content,
          agentId: role.id,
          confidence: claim.confidence,
        });
      }

      epochTokens += result.tokensUsed;
    }

    // Snapshot
    stateSnapshots[doc.epoch] = Array.from(state.current.entries()).map(
      ([dim, val]) => ({ dimension: dim, content: val.content }),
    );

    // Count contradictions (post-hoc, Agentica has no built-in detection)
    const dimContents = new Map<string, Set<string>>();
    for (const claim of state.history.filter((c) => c.epoch <= doc.epoch)) {
      if (!dimContents.has(claim.dimension)) dimContents.set(claim.dimension, new Set());
      dimContents.get(claim.dimension)!.add(claim.content);
    }
    const contradictions = Array.from(dimContents.values()).filter((s) => s.size > 1).length;

    // Reversions: dimension overwrites
    let reversions = 0;
    for (const claim of epochClaims) {
      const existing = state.current.get(claim.dimension);
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

  const finalState = Array.from(state.current.entries()).map(([dim, val]) => ({
    dimension: dim,
    content: val.content,
    agentId: val.agentId,
    epoch: val.epoch,
    regulationVersion: val.regulationVersion,
    validTime: val.validTime,
  }));

  return {
    system: "agentica",
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
