import type { Agent } from "@mastra/core/agent";
import type { z } from "zod";

/**
 * Loose shape of Mastra `generate` when using `structuredOutput`; `object` matches the Zod schema at runtime.
 */
export type MastraStructuredResult = {
  object?: unknown;
  usage?: {
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
