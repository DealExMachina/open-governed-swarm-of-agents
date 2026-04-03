/**
 * Resolution service: singleton module for contradiction resolution logic.
 *
 * All resolution operations (query, check, mark, evaluate) are pure async functions
 * that operate directly on the shared Postgres pool and embedding pipeline.
 * No HTTP, no serialization overhead.
 *
 * The HTTP facade in resolutionMcp.ts delegates to these functions for external callers.
 */
import type { S3Client } from "@aws-sdk/client-s3";
import { getPool } from "./db.js";
import { getEmbedding, embedAndPersistNode, cosineSimilarity } from "./embeddingPipeline.js";
import { updateNodeStatus, appendEdge, loadUnresolvedContradictionDetails, type UnresolvedContradictionDetail } from "./semanticGraph.js";
import { s3PutJson, s3GetText } from "./s3.js";
import { logger } from "./logger.js";
import { getChatModelConfig, REASONING_SETTINGS, ResolutionEvalItemSchema } from "./modelConfig.js";
import { z } from "zod";

const SIMILARITY_THRESHOLD = 0.7;
const RESOLUTION_MATCH_THRESHOLD = 0.55;
const MARK_RESOLVED_BY_TEXT_MAX = 10;
const LLM_RESOLVE_CONFIDENCE_THRESHOLD = 0.7;

// ── Types ──────────────────────────────────────────────────────────────────

export interface ResolvedContradiction {
  node_id: string;
  content: string;
}

export interface IsResolvedResult {
  resolved: boolean;
  similarity?: number;
  match?: string;
  match_node_id?: string;
  reason?: string;
}

export interface MarkResolvedParams {
  scope_id?: string;
  node_id: string;
  judgment?: string;
  reason?: string;
  s3Client?: S3Client | null;
  bucket?: string;
}

export interface MarkResolvedResult {
  ok: boolean;
  node_id: string;
  embedded: boolean;
}

export interface MarkResolvedByTextParams {
  scope_id?: string;
  resolution_text: string;
  node_ids?: string[];
  s3Client?: S3Client | null;
  bucket?: string;
}

export interface MarkResolvedByTextResult {
  ok: boolean;
  marked: string[];
  evaluations: Array<{ node_id: string; resolved: boolean; confidence: number; reason: string; content?: string }>;
  method: string;
}

export interface ResolutionEvaluation {
  node_id: string;
  resolved: boolean;
  confidence: number;
  reason: string;
}

// ── Core functions ─────────────────────────────────────────────────────────

export async function getResolutions(scopeId: string): Promise<ResolvedContradiction[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT node_id, content FROM nodes
     WHERE scope_id = $1 AND type = 'contradiction' AND status = 'resolved'
       AND superseded_at IS NULL
     ORDER BY updated_at DESC LIMIT 100`,
    [scopeId],
  );
  return result.rows.map((r: { node_id: string; content: string }) => ({
    node_id: r.node_id,
    content: r.content,
  }));
}

export async function isResolved(text: string, scopeId: string = "default"): Promise<IsResolvedResult> {
  const embedding = await getEmbedding(text);
  if (embedding.length === 0) {
    return { resolved: false, reason: "embedding_unavailable" };
  }

  const pool = getPool();
  const vec = `[${embedding.join(",")}]`;
  const result = await pool.query(
    `SELECT node_id, content, 1 - (embedding <=> $2::vector) AS similarity
     FROM nodes
     WHERE scope_id = $1 AND type = 'contradiction' AND status = 'resolved'
       AND superseded_at IS NULL AND embedding IS NOT NULL
     ORDER BY embedding <=> $2::vector ASC
     LIMIT 1`,
    [scopeId, vec],
  );

  if (result.rowCount && result.rows[0]) {
    const row = result.rows[0] as { node_id: string; content: string; similarity: number };
    const similarity = Number(row.similarity);
    if (similarity >= SIMILARITY_THRESHOLD) {
      return {
        resolved: true,
        similarity: Math.round(similarity * 1000) / 1000,
        match: row.content,
        match_node_id: row.node_id,
      };
    }
    return { resolved: false, similarity };
  }

  return { resolved: false, similarity: 0 };
}

async function markContradictionResolved(
  nodeId: string,
  scopeId: string,
  judgment: string,
  reason: string,
  s3: S3Client | null,
  bucket: string,
): Promise<string | null> {
  const pool = getPool();
  const nodeRes = await pool.query(
    "SELECT content, metadata, source_ref FROM nodes WHERE node_id = $1",
    [nodeId],
  );
  const row = nodeRes.rows[0] as { content?: string; metadata?: { claim_source_id?: string; claim_target_id?: string }; source_ref?: Record<string, unknown> } | undefined;
  const content = row?.content ?? null;
  const metadata = (row?.metadata as Record<string, unknown> | undefined) ?? {};
  const claimSourceId = metadata.claim_source_id as string | undefined;
  const claimTargetId = metadata.claim_target_id as string | undefined;

  await updateNodeStatus(nodeId, "resolved");

  const resolutionRef = {
    resolved_by: judgment,
    resolution_reason: reason,
    resolved_at: new Date().toISOString(),
    source: "resolution-service",
  };
  await pool.query(
    `UPDATE nodes SET source_ref = source_ref || $2::jsonb, updated_at = now(), version = version + 1 WHERE node_id = $1`,
    [nodeId, JSON.stringify(resolutionRef)],
  );

  if (claimSourceId && claimTargetId) {
    try {
      await appendEdge({
        scope_id: scopeId,
        source_id: nodeId,
        target_id: claimSourceId,
        edge_type: "resolves",
        weight: 1,
        metadata: { source: "resolution-service", judgment, reason },
        created_by: "resolution-service",
      });
      await appendEdge({
        scope_id: scopeId,
        source_id: nodeId,
        target_id: claimTargetId,
        edge_type: "resolves",
        weight: 1,
        metadata: { source: "resolution-service", judgment, reason },
        created_by: "resolution-service",
      });
    } catch { /* optional topological edges */ }
  }

  if (content) {
    await embedAndPersistNode(nodeId, scopeId, content);
  }

  if (s3 && content) {
    try {
      let existing: Array<{ content: string; judgment: string; reason: string }> = [];
      const raw = await s3GetText(s3, bucket, "resolutions/latest.json");
      if (raw) {
        const parsed = JSON.parse(raw) as { resolved_contradictions?: Array<{ content: string; judgment: string; reason: string }> };
        existing = parsed.resolved_contradictions ?? [];
      }
      if (!existing.some((r) => r.content === content)) {
        existing.push({ content, judgment, reason });
      }
      await s3PutJson(s3, bucket, "resolutions/latest.json", {
        resolved_contradictions: existing,
        updated_at: new Date().toISOString(),
      });
    } catch { /* S3 write is best-effort */ }
  }

  return content;
}

export async function markResolved(params: MarkResolvedParams): Promise<MarkResolvedResult> {
  const scopeId = params.scope_id ?? "default";
  const judgment = params.judgment ?? "resolved";
  const reason = params.reason ?? "";

  if (!params.node_id) {
    throw new Error("node_id required");
  }

  const content = await markContradictionResolved(
    params.node_id, scopeId, judgment, reason,
    params.s3Client ?? null, params.bucket ?? "swarm",
  );
  logger.info("resolution-service: marked resolved", { node_id: params.node_id, judgment, reason: reason.slice(0, 80) });
  return { ok: true, node_id: params.node_id, embedded: !!content };
}

/**
 * Use the LLM to evaluate a human resolution against each active contradiction.
 */
export async function evaluateResolutionWithLLM(
  resolutionText: string,
  contradictions: Array<{ node_id: string; content: string; side_a?: string | null; side_b?: string | null }>,
): Promise<ResolutionEvaluation[]> {
  const modelConfig = getChatModelConfig();
  if (!modelConfig) return [];

  const contraList = contradictions.map((c, i) => {
    const parts = [`[${i + 1}] id=${c.node_id}`];
    parts.push(`Contradiction: ${c.content}`);
    if (c.side_a) parts.push(`Side A: ${c.side_a}`);
    if (c.side_b) parts.push(`Side B: ${c.side_b}`);
    return parts.join("\n");
  }).join("\n\n");

  const systemPrompt = `You are a contradiction resolution evaluator for an M&A due diligence system.
A human reviewer has provided a resolution statement. This is typically a free-form paragraph written
by a domain expert (analyst, lawyer, auditor). A single resolution message often addresses several
contradictions at once -- for example: "The ARR discrepancy is due to unaudited figures; the patents
are pending, not granted." You must evaluate EVERY listed contradiction independently against the
ENTIRE resolution text.

For each contradiction, determine:
- Does any part of the resolution provide information that explains, clarifies, or resolves this contradiction?
- How confident are you? (0.0 = no relation, 1.0 = definitively resolves it)

A resolution "resolves" a contradiction when it:
- Explains why both sides appeared to conflict (e.g. one figure was unaudited, the other was restated)
- Confirms which side is correct with an explanation
- Provides context that makes the contradiction no longer material
- Directly addresses the subject matter of the contradiction, even briefly

Be generous with matching: if the resolution clearly refers to the same topic as the contradiction,
even with different wording, treat it as addressing it. Humans write naturally, not formally.

Respond ONLY with a JSON array, one object per contradiction, in order:
[{"node_id":"...","resolved":true/false,"confidence":0.0-1.0,"reason":"brief explanation"}]`;

  const userPrompt = `Human resolution (may address one, several, or all contradictions):
"""
${resolutionText}
"""

Active contradictions to evaluate (${contradictions.length}):
${contraList}

Evaluate EACH contradiction independently against the full resolution text. Return JSON array only.`;

  try {
    const baseUrl = modelConfig.url.replace(/\/+$/, "");
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${modelConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: modelConfig.id.replace(/^openai\//, ""),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: REASONING_SETTINGS.temperature,
        max_tokens: REASONING_SETTINGS.maxTokens,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!resp.ok) {
      logger.warn("resolution-service: LLM evaluation failed", { status: resp.status });
      return [];
    }
    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content ?? "";
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.warn("resolution-service: LLM returned no JSON array", { raw: raw.slice(0, 200) });
      return [];
    }
    const validated = z.array(ResolutionEvalItemSchema).safeParse(JSON.parse(jsonMatch[0]));
    if (!validated.success) {
      logger.warn("resolution-service: LLM output failed schema validation", { error: validated.error.message });
      return [];
    }
    return validated.data.map((item, i) => ({
      node_id: item.node_id ?? contradictions[i]?.node_id ?? "",
      resolved: item.resolved,
      confidence: item.confidence,
      reason: item.reason ?? "",
    }));
  } catch (e) {
    logger.warn("resolution-service: LLM evaluation error", { error: String(e) });
    return [];
  }
}

/**
 * Embedding-based fallback: match resolution text to contradiction sides by cosine similarity.
 */
export async function evaluateResolutionWithEmbeddings(
  resolutionText: string,
  contradictions: Array<{ node_id: string; content: string; side_a?: string | null; side_b?: string | null }>,
): Promise<ResolutionEvaluation[]> {
  const resEmbedding = await getEmbedding(resolutionText);
  if (resEmbedding.length === 0) return [];

  const results: ResolutionEvaluation[] = [];
  for (const d of contradictions) {
    const sides = [d.side_a, d.side_b].filter((s): s is string => !!s?.trim());
    if (sides.length === 0) sides.push(d.content);
    let bestSim = 0;
    for (const side of sides) {
      const sideEmb = await getEmbedding(side);
      if (sideEmb.length > 0) {
        const sim = cosineSimilarity(resEmbedding, sideEmb);
        if (sim > bestSim) bestSim = sim;
      }
    }
    results.push({
      node_id: d.node_id,
      resolved: bestSim >= RESOLUTION_MATCH_THRESHOLD,
      confidence: bestSim,
      reason: `embedding similarity ${(bestSim * 100).toFixed(0)}%`,
    });
  }
  return results;
}

export async function markResolvedByText(params: MarkResolvedByTextParams): Promise<MarkResolvedByTextResult> {
  const scopeId = params.scope_id ?? "default";
  const resolutionText = params.resolution_text?.trim() ?? "";
  const explicitNodeIds = params.node_ids ?? [];
  const s3 = params.s3Client ?? null;
  const bucket = params.bucket ?? "swarm";

  if (!resolutionText) {
    throw new Error("resolution_text required");
  }

  let details: UnresolvedContradictionDetail[];
  if (explicitNodeIds.length > 0) {
    const pool = getPool();
    const placeholders = explicitNodeIds.map((_: string, i: number) => `$${i + 2}`).join(",");
    const rows = await pool.query(
      `SELECT node_id, content, metadata FROM nodes
       WHERE scope_id = $1 AND node_id::text IN (${placeholders}) AND type = 'contradiction'
       AND superseded_at IS NULL LIMIT ${MARK_RESOLVED_BY_TEXT_MAX}`,
      [scopeId, ...explicitNodeIds],
    );
    details = rows.rows.map((r: { node_id: string; content: string; metadata?: Record<string, unknown> }) => ({
      node_id: r.node_id,
      content: r.content,
      side_a: "",
      side_b: "",
    }));
  } else {
    details = await loadUnresolvedContradictionDetails(scopeId);
  }

  if (details.length === 0) {
    return { ok: true, marked: [], evaluations: [], method: "none" };
  }

  const toProcess = details.slice(0, MARK_RESOLVED_BY_TEXT_MAX);

  let evaluations = await evaluateResolutionWithLLM(resolutionText, toProcess);
  let method = "llm";
  if (evaluations.length === 0) {
    evaluations = await evaluateResolutionWithEmbeddings(resolutionText, toProcess);
    method = "embedding";
  }

  const marked: string[] = [];
  const contentMap = new Map(toProcess.map((d) => [d.node_id, d.content]));
  const evalResults: Array<{ node_id: string; resolved: boolean; confidence: number; reason: string; content?: string }> = [];

  for (const ev of evaluations) {
    evalResults.push({ ...ev, content: contentMap.get(ev.node_id) });
    if (ev.resolved && ev.confidence >= LLM_RESOLVE_CONFIDENCE_THRESHOLD && ev.node_id) {
      const reason = `HITL resolution (${method}, confidence=${(ev.confidence * 100).toFixed(0)}%): ${ev.reason}`;
      await markContradictionResolved(ev.node_id, scopeId, "resolved", reason, s3, bucket);
      marked.push(ev.node_id);
    }
  }

  if (marked.length > 0) {
    logger.info("resolution-service: marked resolved by text", {
      method,
      marked,
      resolution_preview: resolutionText.slice(0, 120),
    });
  } else {
    logger.info("resolution-service: resolution did not address any contradiction above threshold", {
      method,
      evaluations: evalResults.map((e) => ({ node_id: e.node_id, confidence: e.confidence, resolved: e.resolved })),
    });
  }

  return { ok: true, marked, evaluations: evalResults, method };
}
