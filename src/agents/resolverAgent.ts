import type { S3Client } from "@aws-sdk/client-s3";
import { createTool } from "@mastra/core/tools";
import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { setMaxListeners } from "events";
import { getChatModelConfig } from "../modelConfig.js";
import { logger } from "../logger.js";
import { s3GetText, s3PutJson } from "../s3.js";
import { getPool } from "../db.js";
import { appendEdge, updateNodeStatus } from "../semanticGraph.js";

const RESOLVER_LLM_TIMEOUT_MS = 60_000;
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
  const pool = getPool();
  const res = await pool.query(
    `SELECT n.node_id, n.content
     FROM nodes n
     WHERE n.scope_id = $1 AND n.type = 'contradiction' AND n.status = 'active'
       AND n.superseded_at IS NULL AND (n.valid_to IS NULL OR n.valid_to > now())
     ORDER BY n.created_at DESC
     LIMIT 10`,
    [SCOPE_ID],
  );

  const contradictions: ContradictionInfo[] = [];
  for (const row of res.rows) {
    const claimsRes = await pool.query(
      `SELECT n.content FROM nodes n
       WHERE n.scope_id = $1 AND n.type = 'claim' AND n.status = 'active'
         AND n.superseded_at IS NULL AND (n.valid_to IS NULL OR n.valid_to > now())
       ORDER BY n.confidence DESC
       LIMIT 10`,
      [SCOPE_ID],
    );
    contradictions.push({
      node_id: row.node_id,
      content: row.content,
      related_claims: claimsRes.rows.map((r: { content: string }) => r.content),
    });
  }
  return contradictions;
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
      contradictions: contradictions.map((c) => ({
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

  const resolutionResults: Array<{ id: string; judgment: string; reason: string }> = [];

  const writeResolutionsTool = createTool({
    id: "writeResolutions",
    description: "Write resolution judgments for each contradiction. Each must have id, judgment (confirmed|resolved|noise), and reason.",
    inputSchema: z.object({
      resolutions: z.array(z.object({
        id: z.string(),
        judgment: z.enum(["confirmed", "resolved", "noise"]),
        reason: z.string(),
      })),
    }),
    outputSchema: z.object({ ok: z.boolean(), count: z.number() }),
    execute: async ({ context }) => {
      const resolutions = (context as { resolutions: Array<{ id: string; judgment: string; reason: string }> }).resolutions;
      for (const r of resolutions) {
        resolutionResults.push(r);
      }
      return { ok: true, count: resolutions.length };
    },
  });

  const agent = new Agent({
    id: "resolver-agent",
    name: "Contradiction Resolver",
    instructions: RESOLVER_INSTRUCTIONS,
    model: modelConfig,
    tools: { readContradictions: readContradictionsTool, writeResolutions: writeResolutionsTool },
  });

  const prompt = `There are ${contradictions.length} active contradictions. Read them with readContradictions, analyze each against the available evidence, then call writeResolutions with your judgments.`;

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), RESOLVER_LLM_TIMEOUT_MS);
  setMaxListeners(64, abortController.signal);
  try {
    await agent.generate(prompt, { maxSteps: 5, abortSignal: abortController.signal });
  } catch (e) {
    logger.warn("resolver LLM failed", { error: String(e) });
  } finally {
    clearTimeout(timeoutId);
  }

  let resolved = 0;
  let noise = 0;
  let confirmed = 0;

  for (const r of resolutionResults) {
    const contra = contradictions.find((c) => c.node_id === r.id);
    if (!contra) continue;

    if (r.judgment === "resolved" || r.judgment === "noise") {
      await updateNodeStatus(contra.node_id, "resolved");
      // Create a resolves edge from self to self (marks as resolved in graph queries)
      try {
        await appendEdge({
          scope_id: SCOPE_ID,
          source_id: contra.node_id,
          target_id: contra.node_id,
          edge_type: "resolves",
          weight: 1,
          metadata: {
            source: "resolver-agent",
            judgment: r.judgment,
            reason: r.reason,
          },
          created_by: "resolver-agent",
        });
      } catch {
        // edge creation may fail if self-referencing is blocked
      }
      if (r.judgment === "resolved") resolved++;
      else noise++;
      logger.info("resolver: contradiction resolved", { node_id: contra.node_id, judgment: r.judgment, reason: r.reason });
    } else {
      confirmed++;
    }
  }

  // Write resolution artifact to S3 so facts-worker can avoid re-extracting resolved contradictions
  const allResolved = resolutionResults
    .filter((r) => r.judgment === "resolved" || r.judgment === "noise")
    .map((r) => {
      const c = contradictions.find((x) => x.node_id === r.id);
      return { content: c?.content ?? "", judgment: r.judgment, reason: r.reason };
    });

  // Merge with existing resolutions (append-only)
  let existingResolutions: Array<{ content: string; judgment: string; reason: string }> = [];
  try {
    const raw = await s3GetText(s3, bucket, "resolutions/latest.json");
    if (raw) {
      const parsed = JSON.parse(raw) as { resolved_contradictions?: Array<{ content: string; judgment: string; reason: string }> };
      existingResolutions = parsed.resolved_contradictions ?? [];
    }
  } catch { /* no existing file */ }

  const mergedContents = new Set(existingResolutions.map((r) => r.content));
  for (const r of allResolved) {
    if (!mergedContents.has(r.content)) {
      existingResolutions.push(r);
      mergedContents.add(r.content);
    }
  }

  await s3PutJson(s3, bucket, "resolutions/latest.json", {
    resolved_contradictions: existingResolutions,
    updated_at: new Date().toISOString(),
  });

  logger.info("resolver: completed", { resolved, noise, confirmed, total: contradictions.length, s3_resolutions: existingResolutions.length });
  return { resolved, noise, confirmed };
}
