import { recordLLMTokens, recordLLMCall } from "../metrics.js";
import { recordUsageTokensFromContext } from "../usageEvents.js";

interface MastraUsage {
  // AI SDK v5 (Mastra 1.x) usage field names.
  inputTokens?: number;
  outputTokens?: number;
  // AI SDK v4 (Mastra 0.x) usage field names — kept for backward compatibility.
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
 * Accepts both AI SDK v5 (inputTokens/outputTokens) and legacy v4
 * (promptTokens/completionTokens) usage shapes.
 */
export function trackAgentTokens(
  role: string,
  result: unknown,
  model?: string,
): void {
  if (!result || typeof result !== "object") return;
  const usage = (result as GenerateResultLike).usage;
  if (!usage) return;
  recordLLMCall(role, model);
  const inputT = usage.inputTokens ?? usage.promptTokens ?? 0;
  const outputT = usage.outputTokens ?? usage.completionTokens ?? 0;
  if (inputT) recordLLMTokens(role, "input", inputT, model);
  if (outputT) recordLLMTokens(role, "output", outputT, model);
  void recordUsageTokensFromContext(role, inputT, outputT, model);
}
