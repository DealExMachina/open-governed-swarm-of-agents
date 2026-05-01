import { recordLLMTokens, recordLLMCall } from "../metrics.js";
import { recordUsageTokensFromContext } from "../usageEvents.js";

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
  const inputT = usage.promptTokens ?? 0;
  const outputT = usage.completionTokens ?? 0;
  if (inputT) recordLLMTokens(role, "input", inputT, model);
  if (outputT) recordLLMTokens(role, "output", outputT, model);
  void recordUsageTokensFromContext(role, inputT, outputT, model);
}
