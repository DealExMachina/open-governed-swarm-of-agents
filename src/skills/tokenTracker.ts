import { recordLLMTokens, recordLLMCall } from "../metrics.js";

interface MastraUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

interface GenerateResultLike {
  usage?: MastraUsage;
}

/**
 * Record token usage from a Mastra agent.generate() result.
 * Safe to call with any result shape -- silently ignores missing usage data.
 */
export function trackAgentTokens(role: string, result: unknown, model?: string): void {
  if (!result || typeof result !== "object") return;
  const usage = (result as GenerateResultLike).usage;
  if (!usage) return;
  recordLLMCall(role, model);
  if (usage.promptTokens) {
    recordLLMTokens(role, "input", usage.promptTokens, model);
  }
  if (usage.completionTokens) {
    recordLLMTokens(role, "output", usage.completionTokens, model);
  }
}
