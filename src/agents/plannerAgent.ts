import { setMaxListeners } from "events";
import { join } from "path";
import type { S3Client } from "@aws-sdk/client-s3";
import { Agent } from "@mastra/core/agent";
import { getChatModelConfig, REASONING_SETTINGS, PlannerOutputSchema } from "../modelConfig.js";
import { logger } from "../logger.js";
import { s3GetText } from "../s3.js";
import { loadPolicies, getGovernanceForScope, evaluateRules } from "../governance.js";
import { makeReadDriftTool, makeReadFactsTool, makeReadGovernanceRulesTool } from "./sharedTools.js";
import { composeInstructions } from "../skills/loader.js";
import { trackAgentTokens } from "../skills/tokenTracker.js";
import { evaluateGoalsAgainstEvidence } from "../semanticGraph.js";

const GOVERNANCE_PATH = process.env.GOVERNANCE_PATH ?? join(process.cwd(), "governance.yaml");

const PLANNER_INSTRUCTIONS = `You are a governance-aware planning agent. Given drift analysis, current facts, and governance rules, determine what actions to take.
Use the tools: readDrift, readFacts, readGovernanceRules. Respect governance constraints. Prioritize by severity.
Reply with a JSON object: { "actions": ["action1", "action2"], "reasoning": "brief explanation" }.`;

/**
 * Run planner: LLM-powered when OPENAI_API_KEY set, else rule-based evaluateRules.
 */
export async function runPlannerAgent(
  s3: S3Client,
  bucket: string,
  _payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const modelConfig = getChatModelConfig();
  if (modelConfig) {
    const timeoutMs = Number(process.env.PLANNER_LLM_TIMEOUT_MS) || 60000;
    const abortController = new AbortController();
    setMaxListeners(64, abortController.signal);
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
    try {
      const readDrift = makeReadDriftTool(s3, bucket);
      const readFacts = makeReadFactsTool(s3, bucket);
      const readGovernanceRules = makeReadGovernanceRulesTool();
      const agent = new Agent({
        id: "planner-agent",
        name: "Planner Agent",
        instructions: composeInstructions(PLANNER_INSTRUCTIONS, "planner"),
        model: modelConfig,
        tools: { readDrift, readFacts, readGovernanceRules },
      });
      const result = await agent.generate("Plan actions now.", {
        maxSteps: 4,
        abortSignal: abortController.signal,
        modelSettings: REASONING_SETTINGS,
        structuredOutput: { schema: PlannerOutputSchema as any, jsonPromptInjection: true },
      });
      trackAgentTokens("planner", result);
      clearTimeout(timeoutId);
      const obj = result?.object;
      let actions: string[] = [];
      let reasoning = "";
      if (obj) {
        actions = Array.isArray(obj.actions) ? obj.actions : [];
        reasoning = String(obj.reasoning ?? "");
      }
      const driftRaw = await s3GetText(s3, bucket, "drift/latest.json");
      const drift = driftRaw
        ? (JSON.parse(driftRaw) as { level: string; types: string[] })
        : { level: "none", types: [] as string[] };
      try {
        const scopeId = process.env.SCOPE_ID ?? "default";
        const goalEval = await evaluateGoalsAgainstEvidence(scopeId);
        if (goalEval.resolved > 0 || goalEval.in_progress > 0) {
          logger.info("planner: goal evaluation advanced", { scopeId, ...goalEval });
        }
      } catch (err) {
        logger.warn("planner: goal evaluation failed", { error: String(err) });
      }
      return { drift: { level: drift.level, types: drift.types }, actions, reasoning };
    } catch (err) {
      clearTimeout(timeoutId);
      const msg = err instanceof Error ? err.message : String(err);
      const isAbort = err instanceof Error && (err as Error & { name?: string }).name === "AbortError";
      const isRetryable = isAbort || /timeout|ECONNREFUSED|API|fetch failed|aborted/i.test(msg);
      if (isRetryable) {
        logger.warn("planner LLM unreachable or timeout, falling back to rule-based", {
          error: msg,
          ...(isAbort ? { hint: `LLM took longer than ${timeoutMs}ms. Set PLANNER_LLM_TIMEOUT_MS for heavy runs.` } : {}),
        });
      } else {
        throw err;
      }
    }
  }

  const driftRaw = await s3GetText(s3, bucket, "drift/latest.json");
  const drift = driftRaw
    ? (JSON.parse(driftRaw) as { level: string; types: string[] })
    : { level: "none", types: [] as string[] };
  const scopeId = process.env.SCOPE_ID ?? "default";
  const config = getGovernanceForScope(scopeId, loadPolicies(GOVERNANCE_PATH));
  const actions = evaluateRules(drift, config);
  try {
    const goalEval = await evaluateGoalsAgainstEvidence(scopeId);
    if (goalEval.resolved > 0 || goalEval.in_progress > 0) {
      logger.info("planner: goal evaluation advanced", { scopeId, ...goalEval });
    }
  } catch (err) {
    logger.warn("planner: goal evaluation failed", { error: String(err) });
  }
  return { drift: { level: drift.level, types: drift.types }, actions };
}
