/**
 * Shared OpenAI-compatible and Ollama model config used across the swarm (TypeScript side).
 *
 * When OLLAMA_BASE_URL is set, extraction, rationale, HITL, and embedding flows use Ollama;
 * otherwise OpenAI (or OPENAI_BASE_URL) is used for chat, and embedding may use a separate path.
 *
 * Mastra / AI SDK append "/chat/completions" to the base URL. OpenAI uses base "https://api.openai.com/v1";
 * Ollama's OpenAI-compatible API is at base "http://host:11434/v1". So we must normalize Ollama base
 * to include "/v1" when building config for Mastra/Agent use.
 *
 * Note: Mastra's default `{ id: "provider/model", url }` router uses OpenAI-compatible with
 * structured outputs enabled, which can break Ollama (json_schema in response_format). The
 * comparative benchmark builds an explicit @ai-sdk/openai-compatible client with
 * supportsStructuredOutputs: false — see baselines/scenario/mastra-topology.ts.
 */

import { z } from "zod";
import { enforceModelOnboarding } from "./modelOnboarding.js";

const DEFAULT_OPENAI_BASE = "https://api.openai.com/v1";

// ── Model settings tiers ────────────────────────────────────────────────────

/** Binary decisions, tool orchestration — no creativity needed. */
export const DETERMINISTIC_SETTINGS = { temperature: 0, maxTokens: 1024 } as const;

/** Analytical reasoning — drift causes, action planning, contradiction resolution. */
export const REASONING_SETTINGS = { temperature: 0.2, maxTokens: 1536 } as const;

/** Large text output — full status briefings. */
export const EXTENDED_SETTINGS = { temperature: 0, maxTokens: 2048 } as const;

// ── Structured output schemas ───────────────────────────────────────────────

export const PlannerOutputSchema = z.object({
  actions: z.array(z.string()).describe("Ordered list of recommended actions"),
  reasoning: z.string().describe("Brief explanation of why these actions were chosen"),
});

export const DriftOutputSchema = z.object({
  level: z.enum(["none", "low", "medium", "high", "critical"]),
  types: z.array(z.string()).describe("Drift categories detected"),
  reasoning: z.string().describe("Reasoning about potential drift causes and patterns"),
  recommend_hitl: z.boolean().optional().default(false)
    .describe("True when unresolved contradictions need human resolution"),
});

export const ResolverOutputSchema = z.object({
  resolutions: z.array(z.object({
    id: z.string(),
    judgment: z.enum(["confirmed", "resolved", "noise"]),
    reason: z.string().describe("Why this judgment — map resolution evidence to the specific contradiction"),
    requires_hitl: z.boolean().optional().default(false)
      .describe("True when resolution requires business/legal human judgment"),
  })),
});

export const StatusOutputSchema = z.object({
  summary: z.string().describe("Status briefing text"),
});

export const ExecutorOutputSchema = z.object({
  decision: z.enum(["execute", "decline"]),
  reason: z.string().optional(),
});

export const GovernanceOutputSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().optional(),
});

// ── Validation schemas for regex-parsed LLM outputs ─────────────────────────

export const ResolutionEvalItemSchema = z.object({
  node_id: z.string().optional(),
  resolved: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().optional().default(""),
});

export const GoalMatchItemSchema = z.object({
  id: z.string(),
  status: z.enum(["fully_resolved", "partially_resolved", "not_addressed"]),
  confidence: z.number().min(0).max(1).default(0.5),
});

export type ChatModelConfig = {
  id: `${string}/${string}`;
  url: string;
  apiKey: string;
};

/**
 * Base URL for OpenAI-compatible chat/completions. Mastra/AI SDK append "/chat/completions".
 * - OpenAI: base is already e.g. https://api.openai.com/v1.
 * - Ollama: base must end with /v1 (Ollama serves OpenAI-compatible at /v1/chat/completions).
 */
function openAICompatibleBaseUrl(rawBase: string, isOllama: boolean): string {
  const base = rawBase.trim().replace(/\/+$/, "");
  if (isOllama && !base.endsWith("/v1")) return `${base}/v1`;
  return base;
}

/**
 * Build a Mastra-safe model config that always uses the chat/completions path.
 * When OLLAMA_BASE_URL is set, returns Ollama url and the appropriate model for the role;
 * otherwise uses OPENAI_* env vars. Returns null when no API is configured.
 */
export function getChatModelConfig(
  defaults?: { model?: string; baseUrl?: string },
): ChatModelConfig | null {
  const ollamaBase = getOllamaBaseUrl();
  if (ollamaBase) {
    const requested = process.env.EXTRACTION_MODEL || defaults?.model || "qwen3:8b";
    const model = enforceModelOnboarding("ollama", requested, "qwen2.5:3b").model;
    const id = (model.includes("/") ? model : `openai/${model}`) as `${string}/${string}`;
    return {
      id,
      url: openAICompatibleBaseUrl(ollamaBase, true),
      apiKey: "ollama",
    };
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const requested = process.env.OPENAI_MODEL || defaults?.model || "gpt-4o-mini";
  const raw = enforceModelOnboarding("openai", requested, "gpt-4o-mini").model;
  const id = (raw.includes("/") ? raw : `openai/${raw}`) as `${string}/${string}`;
  const url = openAICompatibleBaseUrl(
    process.env.OPENAI_BASE_URL?.trim() || defaults?.baseUrl || DEFAULT_OPENAI_BASE,
    false,
  );
  return { id, url, apiKey };
}

/**
 * Model config for the oversight (routing) agent. When OVERSEE_MODEL is set, uses that model;
 * otherwise falls back to getChatModelConfig() so the oversight step can use a cheaper model.
 */
export function getOversightModelConfig(): ChatModelConfig | null {
  const base = getChatModelConfig();
  if (!base) return null;
  const overSee = process.env.OVERSEE_MODEL?.trim();
  if (!overSee) return base;
  const provider = getOllamaBaseUrl() ? "ollama" as const : "openai" as const;
  const fallback = provider === "ollama" ? "qwen2.5:3b" : "gpt-4o-mini";
  const model = enforceModelOnboarding(provider, overSee, fallback).model;
  const id = (model.includes("/") ? model : `openai/${model}`) as `${string}/${string}`;
  return { ...base, id };
}

/** Ollama base URL (e.g. http://localhost:11434 or http://host.docker.internal:11434). When set, Ollama is used for extraction/rationale/HITL/embeddings. */
export function getOllamaBaseUrl(): string | null {
  const u = process.env.OLLAMA_BASE_URL?.trim();
  return u || null;
}

export function getExtractionModel(): string {
  const requested = process.env.EXTRACTION_MODEL?.trim() || "qwen3:8b";
  const provider = getOllamaBaseUrl() ? "ollama" as const : "openai" as const;
  const fallback = provider === "ollama" ? "qwen2.5:3b" : "gpt-4o-mini";
  return enforceModelOnboarding(provider, requested, fallback).model;
}

export function getRationaleModel(): string {
  const requested = process.env.RATIONALE_MODEL?.trim() || "phi4-mini";
  const provider = getOllamaBaseUrl() ? "ollama" as const : "openai" as const;
  const fallback = provider === "ollama" ? "qwen2.5:3b" : "gpt-4o-mini";
  return enforceModelOnboarding(provider, requested, fallback).model;
}

export function getHitlModel(): string {
  const requested = process.env.HITL_MODEL?.trim() || "mistral-small:22b";
  const provider = getOllamaBaseUrl() ? "ollama" as const : "openai" as const;
  const fallback = provider === "ollama" ? "qwen2.5:3b" : "gpt-4o-mini";
  return enforceModelOnboarding(provider, requested, fallback).model;
}

export function getEmbeddingModel(): string {
  return process.env.EMBEDDING_MODEL?.trim() || "bge-m3";
}

export interface FinalityThresholds {
  nearFinalityThreshold: number;
  autoFinalityThreshold: number;
}

export function getFinalityThresholds(): FinalityThresholds {
  const near = Number(process.env.NEAR_FINALITY_THRESHOLD);
  const auto = Number(process.env.AUTO_FINALITY_THRESHOLD);
  return {
    nearFinalityThreshold: Number.isFinite(near) && near >= 0 && near <= 1 ? near : 0.75,
    autoFinalityThreshold: Number.isFinite(auto) && auto >= 0 && auto <= 1 ? auto : 0.92,
  };
}
