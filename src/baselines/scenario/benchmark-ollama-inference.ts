/**
 * Comparative benchmark inference endpoint: local Ollama vs Ollama Cloud (OpenAI-compatible).
 *
 * Cloud: set `OLLAMA_API_KEY` (https://ollama.com/settings). Optional `OLLAMA_BASE_URL`
 * defaults to https://ollama.com. Uses `/v1/chat/completions` with Bearer auth.
 *
 * Model onboarding: `model_evals/onboarding-policy.json` lists qualified cloud ids including
 * `ollama/mistral-large-3:675b-cloud` (default for comparative benchmark when API key is set) and
 * `ollama/gemma3:27b-cloud` (override via `OLLAMA_CLOUD_MODEL` if you prefer).
 */

import { enforceModelOnboarding } from "../../modelOnboarding.js";

export type BenchmarkOllamaMode = "local" | "cloud";

export interface BenchmarkOllamaInference {
  mode: BenchmarkOllamaMode;
  /** Base URL for OpenAI-compatible calls, ending with `/v1`. */
  openAICompatBaseUrl: string;
  apiKey: string;
  /** Native Ollama host without `/v1` (local ChatOllama only). */
  nativeHost: string;
  /** Model tag for API bodies (no `ollama/` prefix). */
  model: string;
}

const OLLAMA_CLOUD_DEFAULT_ORIGIN = "https://ollama.com";

function stripTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, "");
}

function ensureOpenAICompatV1Base(originOrV1: string): { openAICompatBaseUrl: string; originWithoutV1: string } {
  const raw = stripTrailingSlashes(originOrV1);
  if (raw.endsWith("/v1")) {
    return { openAICompatBaseUrl: raw, originWithoutV1: raw.slice(0, -3) };
  }
  return { openAICompatBaseUrl: `${raw}/v1`, originWithoutV1: raw };
}

/**
 * Resolve endpoint + onboarded model for benchmark LLM systems (Mastra, LangGraph, Agentica).
 */
export function resolveBenchmarkOllamaInference(requestedModel: string): BenchmarkOllamaInference {
  const apiKey = process.env.OLLAMA_API_KEY?.trim();
  if (apiKey) {
    const hostInput =
      process.env.OLLAMA_BASE_URL?.trim() || OLLAMA_CLOUD_DEFAULT_ORIGIN;
    const { openAICompatBaseUrl, originWithoutV1 } = ensureOpenAICompatV1Base(hostInput);
    const fallback = "mistral-large-3:675b-cloud";
    const model = enforceModelOnboarding("ollama", requestedModel, fallback).model;
    return {
      mode: "cloud",
      openAICompatBaseUrl,
      apiKey,
      nativeHost: originWithoutV1,
      model,
    };
  }

  const hostInput =
    process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434";
  const { openAICompatBaseUrl, originWithoutV1 } = ensureOpenAICompatV1Base(hostInput);
  const fallback = "qwen2.5:3b";
  const model = enforceModelOnboarding("ollama", requestedModel, fallback).model;
  return {
    mode: "local",
    openAICompatBaseUrl,
    apiKey: "ollama",
    nativeHost: originWithoutV1,
    model,
  };
}
