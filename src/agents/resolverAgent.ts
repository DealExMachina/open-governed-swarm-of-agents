import type { S3Client } from "@aws-sdk/client-s3";
import { createTool } from "@mastra/core/tools";
import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { setMaxListeners } from "events";
import { getChatModelConfig, REASONING_SETTINGS, ResolverOutputSchema } from "../modelConfig.js";
import { logger } from "../logger.js";
import { s3GetText } from "../s3.js";
import { loadUnresolvedContradictionDetails } from "../semanticGraph.js";
import { markResolved } from "../resolutionService.js";
import { addPending } from "../mitlServer.js";
import { emitContribution } from "../causalEmit.js";
import { composeInstructions } from "../skills/loader.js";
import { trackAgentTokens } from "../skills/tokenTracker.js";

const RESOLVER_LLM_TIMEOUT_MS = 60_000;
const RESOLVER_BATCH_SIZE = 15;
const SCOPE_ID = process.env.SCOPE_ID ?? "default";

const RESOLVER_INSTRUCTIONS = `You are a contradiction resolver agent. Your job is to examine active contradictions in a semantic graph and determine which are genuinely unresolved vs which have been addressed by available evidence.

For each contradiction, you must judge:
1. "confirmed" — the contradiction is real and genuinely unresolved. Evidence supports both sides.
2. "resolved" — later evidence, resolutions, or context clarifies the contradiction. One side is clearly correct or the issue has been addressed.
3. "noise" — the contradiction is an artifact of ambiguous language, hedging, or LLM extraction error. Not a real conflict.

Be conservative: only mark "resolved" or "noise" when the evidence clearly supports it. When in doubt, mark "confirmed".

Use tools: readContradictions to see active contradictions and evidence, then writeResolutions with your judgments.`;

interface ContradictionInfo {
  node_id: string;
  content: string;
  related_claims: string[];
}

async function loadActiveContradictions(): Promise<ContradictionInfo[]> {
  const details = await loadUnresolvedContradictionDetails(SCOPE_ID);
  return details.map((d) => ({
    node_id: d.node_id,
    content: d.content,
    related_claims: d.related_claims ?? [],
  }));
}

export async function runResolverAgent(
  s3: S3Client,
  bucket: string,
  _payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const modelConfig = getChatModelConfig();
  if (!modelConfig) {
    logger.info("resolver: no LLM configured, skipping");
    return { resolved: 0, confirmed: 0, noise: 0 };
  }

  const contradictions = await loadActiveContradictions();
  if (contradictions.length === 0) {
    logger.info("resolver: no active contradictions");
    return { resolved: 0, confirmed: 0, noise: 0 };
  }

  const factsRaw = await s3GetText(s3, bucket, "facts/latest.json");
  const facts = factsRaw ? JSON.parse(factsRaw) : {};
  const driftRaw = await s3GetText(s3, bucket, "drift/latest.json");
  const drift = driftRaw ? JSON.parse(driftRaw) : {};

  const resolutionResults: Array<{ id: string; judgment: string; reason: string; requires_hitl?: boolean }> = [];

  // Mutable ref so the readContradictions tool returns the current batch
  let currentBatch: ContradictionInfo[] = [];

  const readContradictionsTool = createTool({
    id: "readContradictions",
    description: "Read active contradictions, related claims, and current evidence.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      contradictions: z.array(z.object({
        id: z.string(),
        content: z.string(),
        related_claims: z.array(z.string()),
      })),
      drift_level: z.string(),
      facts_summary: z.string(),
    }),
    execute: async () => ({
      contradictions: currentBatch.map((c) => ({
        id: c.node_id,
        content: c.content,
        related_claims: c.related_claims.slice(0, 5),
      })),
      drift_level: String(drift.level ?? "unknown"),
      facts_summary: JSON.stringify({
        claims: (facts.claims ?? []).slice(0, 10),
        risks: (facts.risks ?? []).slice(0, 5),
      }),
    }),
  });

  const writeResolutionsTool = createTool({
    id: "writeResolutions",
    description: "Write resolution judgments for each contradiction. Each must have id, judgment (confirmed|resolved|noise), reason, and optionally requires_hitl.",
    inputSchema: z.object({
      resolutions: z.array(z.object({
        id: z.string(),
        judgment: z.enum(["confirmed", "resolved", "noise"]),
        reason: z.string(),
        requires_hitl: z.boolean().optional().default(false)
          .describe("True when resolution requires business/legal human judgment"),
      })),
    }),
    outputSchema: z.object({ ok: z.boolean(), count: z.number() }),
    execute: async ({ context }) => {
      const resolutions = (context as { resolutions: Array<{ id: string; judgment: string; reason: string; requires_hitl?: boolean }> }).resolutions;
      for (const r of resolutions) {
        resolutionResults.push(r);
      }
      return { ok: true, count: resolutions.length };
    },
  });

  const agent = new Agent({
    id: "resolver-agent",
    name: "Contradiction Resolver",
    instructions: composeInstructions(RESOLVER_INSTRUCTIONS, "resolver"),
    model: modelConfig,
    tools: { readContradictions: readContradictionsTool, writeResolutions: writeResolutionsTool },
  });

  // Process contradictions in batches to stay within LLM token/timeout budget
  const totalBatches = Math.ceil(contradictions.length / RESOLVER_BATCH_SIZE);
  for (let batchStart = 0; batchStart < contradictions.length; batchStart += RESOLVER_BATCH_SIZE) {
    currentBatch = contradictions.slice(batchStart, batchStart + RESOLVER_BATCH_SIZE);
    const batchLabel = `batch ${batchStart / RESOLVER_BATCH_SIZE + 1}/${totalBatches}`;
    const prompt = `${currentBatch.length} contradictions (${batchLabel}). Analyze and resolve.`;

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), RESOLVER_LLM_TIMEOUT_MS);
    setMaxListeners(64, abortController.signal);
    try {
      const genResult = await agent.generate(prompt, {
        maxSteps: 5,
        abortSignal: abortController.signal,
        modelSettings: REASONING_SETTINGS,
        structuredOutput: { schema: ResolverOutputSchema, jsonPromptInjection: true },
      });
      trackAgentTokens("resolver", genResult);
    } catch (e) {
      logger.warn("resolver LLM failed", { error: String(e), batch: batchLabel });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  let resolved = 0;
  let noise = 0;
  let confirmed = 0;
  let hitlRequested = 0;

  for (const r of resolutionResults) {
    const contra = contradictions.find((c) => c.node_id === r.id);
    if (!contra) continue;

    if (r.requires_hitl) {
      hitlRequested++;
      const proposalId = `hitl-resolver-${contra.node_id}-${Date.now()}`;
      try {
        await addPending(proposalId, {
          proposal_id: proposalId,
          agent: "resolver-agent",
          proposed_action: "resolve_contradiction",
          target_node: contra.node_id,
          payload: {
            scope_id: SCOPE_ID,
            node_id: contra.node_id,
            content: contra.content,
            judgment: r.judgment,
            reason: r.reason,
          },
        } as Record<string, unknown> & { proposal_id: string; agent: string; proposed_action: string; target_node: string; payload: Record<string, unknown> }, {
          scope_id: SCOPE_ID,
          node_id: contra.node_id,
          content: contra.content,
          reason: r.reason,
        });
        await emitContribution("resolver-agent", "resolution", {
          type: "resolver_hitl_requested",
          proposal_id: proposalId,
          node_id: contra.node_id,
          reason: r.reason,
        }, { authorityTier: 1 });
      } catch (err) {
        logger.warn("resolver: HITL pending creation failed", { error: String(err), node_id: contra.node_id });
      }
      logger.info("resolver: HITL requested", { node_id: contra.node_id, reason: r.reason });
      confirmed++;
      continue;
    }

    if (r.judgment === "resolved" || r.judgment === "noise") {
      try {
        await markResolved({
          scope_id: SCOPE_ID,
          node_id: contra.node_id,
          judgment: r.judgment,
          reason: r.reason,
          s3Client: s3,
          bucket,
        });
      } catch (err) {
        logger.warn("resolver: markResolved failed", { error: String(err), node_id: contra.node_id });
      }
      await emitContribution("resolver-agent", "resolution", {
        type: "contradiction_resolved",
        node_id: contra.node_id,
        judgment: r.judgment,
        reason: r.reason,
      }, { authorityTier: 1 });
      if (r.judgment === "resolved") resolved++;
      else noise++;
      logger.info("resolver: contradiction resolved", { node_id: contra.node_id, judgment: r.judgment, reason: r.reason });
    } else {
      confirmed++;
    }
  }

  logger.info("resolver: completed", { resolved, noise, confirmed, hitlRequested, total: contradictions.length });
  return { resolved, noise, confirmed, hitlRequested };
}
