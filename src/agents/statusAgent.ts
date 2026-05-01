import type { S3Client } from "@aws-sdk/client-s3";
import { createHash } from "crypto";
import { createTool } from "@mastra/core/tools";
import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { getChatModelConfig, DETERMINISTIC_SETTINGS, EXTENDED_SETTINGS, StatusOutputSchema } from "../modelConfig.js";
import { logger } from "../logger.js";
import { s3GetText } from "../s3.js";
import { appendEvent } from "../contextWal.js";
import { emitContribution } from "../causalEmit.js";
import { createSwarmEvent } from "../events.js";
import { makeReadFactsTool, makeReadDriftTool, makeReadContextTool } from "./sharedTools.js";
import { composeInstructions } from "../skills/loader.js";
import { trackAgentTokens } from "../skills/tokenTracker.js";

const SHORT_PROMPT = "Summarize recent changes in 2-3 sentences for a short status update.";
const FULL_PROMPT = "Produce a comprehensive status report: facts confidence, drift trends, recent actions, unresolved contradictions, recommended next steps.";

function createWriteBriefingTool() {
  return createTool({
    id: "writeBriefing",
    description: "Append a status briefing to the context WAL and make it visible in the feed.",
    inputSchema: z.object({
      summary: z.string(),
      type: z.enum(["short", "full"]).optional(),
    }),
    outputSchema: z.object({
      seq: z.number(),
      type: z.string(),
    }),
    execute: async (ctx) => {
      const input = (ctx as unknown) as { context?: { summary?: string; type?: string } };
      const summary = input?.context?.summary ?? "";
      const type = input?.context?.type ?? "short";
      const event = createSwarmEvent(
        type === "full" ? "briefing_full" : "briefing_short",
        { summary, ts: new Date().toISOString() },
        { source: "status_agent" },
      );
      const seq = await appendEvent(event as unknown as Record<string, unknown>);
      await emitContribution("status-agent", "assessment", {
        type: type === "full" ? "briefing_full" : "briefing_short",
        summary_hash: createHash("sha256").update(summary).digest("hex").slice(0, 16),
      });
      return { seq, type: type === "full" ? "briefing_full" : "briefing_short" };
    },
  });
}

/**
 * Run status agent: LLM synthesis (short or full from payload) when OPENAI_API_KEY set, else raw card.
 */
export async function runStatusAgent(
  s3: S3Client,
  bucket: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const elapsedMs = (payload?.elapsedMs as number) ?? 0;
  const nextFullMs = (payload?.nextFullMs as number) ?? 600000;
  const isFull = elapsedMs >= nextFullMs;

  const modelConfig = getChatModelConfig();
  if (modelConfig) {
    try {
      const readFacts = makeReadFactsTool(s3, bucket);
      const readDrift = makeReadDriftTool(s3, bucket);
      const readRecentEvents = makeReadContextTool(50);
      const writeBriefing = createWriteBriefingTool();
      const agent = new Agent({
        id: "status-agent",
        name: "Status Agent",
        instructions: composeInstructions("You are a status synthesis agent. Use readFacts, readDrift, readContext to gather state. Then use writeBriefing with a concise summary. For short updates use 2-3 sentences; for full briefings provide a comprehensive report.", "status"),
        model: modelConfig,
        tools: { readFacts, readDrift, readRecentEvents, writeBriefing },
      });
      const prompt = isFull ? FULL_PROMPT : SHORT_PROMPT;
      const genResult = await agent.generate(prompt, {
        maxSteps: 5,
        modelSettings: isFull ? EXTENDED_SETTINGS : DETERMINISTIC_SETTINGS,
        structuredOutput: { schema: StatusOutputSchema as any, jsonPromptInjection: true },
      });
      trackAgentTokens("status", genResult);
      const factsRaw = await s3GetText(s3, bucket, "facts/latest.json");
      const driftRaw = await s3GetText(s3, bucket, "drift/latest.json");
      const facts = factsRaw ? (JSON.parse(factsRaw) as Record<string, unknown>) : null;
      const drift = driftRaw ? (JSON.parse(driftRaw) as Record<string, unknown>) : null;
      const cardPayload = {
        ts: new Date().toISOString(),
        drift_level: drift?.level ?? "unknown",
        drift_types: (drift?.types as string[]) ?? [],
        confidence: facts?.confidence ?? null,
        goals: (facts?.goals as string[]) ?? [],
        briefing_type: isFull ? "full" : "short",
      };
      await appendEvent(
        createSwarmEvent("status_card", cardPayload, { source: "status_agent" }) as unknown as Record<string, unknown>,
      );
      await emitContribution("status-agent", "assessment", {
        type: "status_card",
        drift_level: cardPayload.drift_level,
        drift_types: cardPayload.drift_types,
        confidence: cardPayload.confidence,
        briefing_type: cardPayload.briefing_type,
      });
      return { type: "status_card", ...cardPayload };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/timeout|ECONNREFUSED|API|fetch failed/i.test(msg)) {
        logger.warn("Mastra/OpenAI unreachable, falling back to raw status card", { error: msg });
      } else {
        throw err;
      }
    }
  }

  const factsRaw = await s3GetText(s3, bucket, "facts/latest.json");
  const driftRaw = await s3GetText(s3, bucket, "drift/latest.json");
  const facts = factsRaw ? (JSON.parse(factsRaw) as Record<string, unknown>) : null;
  const drift = driftRaw ? (JSON.parse(driftRaw) as Record<string, unknown>) : null;
  const cardPayload = {
    ts: new Date().toISOString(),
    drift_level: drift?.level ?? "unknown",
    drift_types: (drift?.types as string[]) ?? [],
    confidence: facts?.confidence ?? null,
    goals: (facts?.goals as string[]) ?? [],
    notes: (drift?.notes as string[]) ?? [],
  };
  await appendEvent(
    createSwarmEvent("status_card", cardPayload, { source: "status_agent" }) as unknown as Record<string, unknown>,
  );
  await emitContribution("status-agent", "assessment", {
    type: "status_card",
    drift_level: cardPayload.drift_level,
    drift_types: cardPayload.drift_types,
    confidence: cardPayload.confidence,
  });
  return { type: "status_card", ...cardPayload };
}
