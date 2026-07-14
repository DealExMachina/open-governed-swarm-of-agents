import type { Agent } from "@mastra/core/agent";
import type { z } from "zod";

/**
 * Loose shape of Mastra `generate` when using `structuredOutput`; `object` matches the Zod schema at runtime.
 */
export type MastraStructuredResult = {
  object?: unknown;
  usage?: {
    // AI SDK v5 (Mastra 1.x) usage field names.
    inputTokens?: number;
    outputTokens?: number;
    // AI SDK v4 (Mastra 0.x) usage field names — kept for backward compatibility.
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};

/**
 * Mastra `Agent.generate` + `structuredOutput`: runtime stays Zod + structured JSON,
 * but Mastra's `OutputSchema` TypeScript type is narrower than `z.ZodTypeAny` (effects,
 * deep inference). All escapers live here — callers pass any Zod schema without `as any`.
 */
export function generateWithStructuredOutput(
  agent: Agent,
  prompt: string,
  schema: z.ZodTypeAny,
  options: Record<string, unknown> = {},
): Promise<MastraStructuredResult> {
  return agent.generate(prompt, {
    ...options,
    structuredOutput: { schema, jsonPromptInjection: true },
  } as any) as Promise<MastraStructuredResult>;
}
