/**
 * Sync extracted facts (claims, goals, risks, contradictions) into the semantic graph
 * so loadFinalitySnapshot and finality evaluation have real data.
 *
 * Uses CRDT-inspired monotonic upsert strategy (CodeCRDT, arXiv:2510.18893):
 * - Claims: upsert-if-better (only update confidence when new >= existing)
 * - Contradictions: irreversible resolution (once a resolves edge exists, cannot re-open)
 * - Stale nodes: marked "irrelevant" instead of deleted (append-only semantics)
 *
 * This guarantees the goal score is a ratchet — it only moves forward, never regresses.
 *
 * Policy versioning: decisions are linked to policy version (governance/finality config hash)
 * via DecisionRecord.policy_version and finality certificate payloads (Phase 5-2, 8-5).
 *
 * Late-arriving facts: payloads with valid_from/valid_to in the past are stored as-is;
 * they contribute to time-travel queries (queryNodes with asOfValidTime) and temporal
 * contradiction uses overlap of valid-time intervals (Phase 8-2).
 */

import { runInTransaction } from "./db.js";
import {
  appendNode,
  appendEdge,
  updateNodeConfidence,
  updateNodeStatus,
  hasResolvingEdge,
  queryNodesByCreator,
  type SemanticNode,
} from "./semanticGraph.js";
import { logger } from "./logger.js";

const FACTS_SYNC_SOURCE = "facts-sync";

export interface FactsPayload {
  entities?: string[];
  claims?: string[];
  risks?: string[];
  assumptions?: string[];
  contradictions?: string[];
  goals?: string[];
  confidence?: number;
  /** Bitemporal: valid time for all nodes/edges from this payload (optional). */
  valid_from?: string | null;
  valid_to?: string | null;
  [k: string]: unknown;
}

/**
 * Parse contradiction string into two claim fragments for edge creation.
 * Handles multiple formats:
 *   - NLI: "claimA..." vs "claimB..."
 *   - X contradicts Y
 *   - Prose: "Initial briefing claimed X, which contradicts Y"
 *   - Prose with "versus/vs/while/but": "X versus Y"
 */
function parseNliContradiction(s: string): [string, string] | null {
  const trimmed = s.trim();

  const nli = /^NLI:\s*"(.*?)"\s+vs\s+"(.*?)"/s;
  const m = trimmed.match(nli);
  if (m) {
    const a = m[1].replace(/\.\.\.$/, "").trim();
    const b = m[2].replace(/\.\.\.$/, "").trim();
    if (a && b) return [a, b];
  }

  const contradicts = /^(.*?)\s+contradicts?\s+(.*)$/i.exec(trimmed);
  if (contradicts) return [contradicts[1].trim(), contradicts[2].trim()];

  const whichContradicts = /(.+?),?\s+which\s+contradicts?\s+(.+)/i.exec(trimmed);
  if (whichContradicts) return [whichContradicts[1].trim(), whichContradicts[2].trim()];

  const versus = /(.+?)\s+(?:versus|vs\.?)\s+(.+)/i.exec(trimmed);
  if (versus) return [versus[1].trim(), versus[2].trim()];

  const butWhile = /(.+?),?\s+(?:but|while|whereas|however)\s+(.+)/i.exec(trimmed);
  if (butWhile) return [butWhile[1].trim(), butWhile[2].trim()];

  return null;
}

/**
 * Find best-matching claim node id from content->nodeId map.
 * Uses exact match, prefix match, then token overlap as fallback.
 */
export function findClaimNodeId(
  contentToId: Map<string, string>,
  fragment: string,
): string | null {
  if (!fragment) return null;
  const exact = contentToId.get(fragment);
  if (exact) return exact;
  for (const [content, id] of contentToId) {
    if (content === fragment || content.startsWith(fragment) || fragment.startsWith(content))
      return id;
  }
  const fragWords = new Set(fragment.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (fragWords.size === 0) return null;
  let bestId: string | null = null;
  let bestScore = 0;
  for (const [content, id] of contentToId) {
    const contentWords = new Set(content.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    let overlap = 0;
    for (const w of fragWords) if (contentWords.has(w)) overlap++;
    const score = overlap / Math.max(fragWords.size, 1);
    if (score > bestScore && score >= 0.3) {
      bestScore = score;
      bestId = id;
    }
  }
  return bestId;
}

/**
 * Significant words for token-overlap similarity.
 * Strips punctuation/currency symbols and keeps words > 2 chars (to catch
 * short but important domain terms like "ARR", "IP"), minus stop words.
 */
const SYNC_STOP = new Set([
  "the","and","for","are","was","were","has","have","had","not","but","its",
  "that","this","from","with","they","been","which","into","also","than",
  "will","can","may","who","how","all","any","each","some","such","very",
]);

function sigWords(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !SYNC_STOP.has(w))
      .map((w) => (w.length > 6 ? w.slice(0, 6) : w)),
  );
}

/**
 * Token-overlap similarity (Jaccard-like) between two strings.
 * Returns 0..1 where 1 means identical significant words.
 */
function tokenOverlap(a: string, b: string): number {
  const wa = sigWords(a);
  const wb = sigWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap++;
  return overlap / Math.max(wa.size, wb.size);
}

/**
 * Match a new claim against existing nodes by content similarity.
 * Tries exact/prefix match first, then falls back to token overlap
 * (threshold 0.6) to catch LLM rephrasings of the same fact.
 * Returns the matched node or null.
 */
function matchExistingNode(
  existingNodes: SemanticNode[],
  content: string,
): SemanticNode | null {
  const trimmed = content.trim();
  for (const node of existingNodes) {
    if (
      node.content === trimmed ||
      node.content.startsWith(trimmed) ||
      trimmed.startsWith(node.content)
    ) {
      return node;
    }
  }
  // Fuzzy fallback: token overlap catches LLM rephrasings of the same contradiction/fact
  let bestMatch: SemanticNode | null = null;
  let bestScore = 0;
  for (const node of existingNodes) {
    const score = tokenOverlap(node.content, trimmed);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = node;
    }
  }
  return bestScore >= 0.6 ? bestMatch : null;
}

/**
 * Sync facts for a scope into the semantic graph using monotonic upserts.
 *
 * Strategy (CRDT-inspired):
 * 1. Load existing fact-sourced nodes
 * 2. For each new claim: upsert-if-better (only increase confidence)
 * 3. For goals/risks: upsert or insert
 * 4. For contradictions: only create if no resolving edge exists (irreversible resolution)
 * 5. Mark stale nodes as "irrelevant" instead of deleting
 */
export async function syncFactsToSemanticGraph(
  scopeId: string,
  facts: FactsPayload,
  opts?: { embedClaims?: boolean },
): Promise<{ nodesCreated: number; edgesCreated: number; nodesUpdated: number; nodesStaled: number }> {
  const claims = (Array.isArray(facts.claims) ? facts.claims : []).filter((c): c is string => typeof c === "string");
  const goals = (Array.isArray(facts.goals) ? facts.goals : []).filter((g): g is string => typeof g === "string");
  const risks = (Array.isArray(facts.risks) ? facts.risks : []).filter((r): r is string => typeof r === "string");
  const contradictions = (Array.isArray(facts.contradictions) ? facts.contradictions : []).filter(
    (c): c is string => typeof c === "string",
  );
  const confidence = typeof facts.confidence === "number" ? facts.confidence : 1;
  const minClaimConfidence = Number(process.env.MIN_CLAIM_CONFIDENCE ?? "0.65");
  const validFrom = facts.valid_from ?? undefined;
  const validTo = facts.valid_to ?? undefined;
  const hasValidTime = validFrom !== undefined || validTo !== undefined;

  let nodesCreated = 0;
  let nodesUpdated = 0;
  let nodesStaled = 0;
  let edgesCreated = 0;
  const claimContentToNodeId = new Map<string, string>();

  await runInTransaction(async (client) => {
    // Load existing fact-synced nodes
    const existingClaims = await queryNodesByCreator(scopeId, FACTS_SYNC_SOURCE, "claim", client);
    const existingGoals = await queryNodesByCreator(scopeId, FACTS_SYNC_SOURCE, "goal", client);
    const existingRisks = await queryNodesByCreator(scopeId, FACTS_SYNC_SOURCE, "risk", client);

    // Track which existing nodes were matched (for stale detection)
    const matchedClaimIds = new Set<string>();
    const matchedGoalIds = new Set<string>();
    const matchedRiskIds = new Set<string>();

    // --- Claims: upsert-if-better (skip low-confidence batches to reduce noise) ---
    if (confidence < minClaimConfidence) {
      /* skip claims from low-confidence extraction */
    } else for (const content of claims) {
      if (typeof content !== "string" || !content.trim()) continue;
      const trimmed = content.trim();
      const existing = matchExistingNode(existingClaims, trimmed);

      if (existing) {
        matchedClaimIds.add(existing.node_id);
        // Monotonic: only update if new confidence >= existing
        if (confidence >= existing.confidence) {
          await updateNodeConfidence(existing.node_id, confidence, client);
          nodesUpdated++;
        }
        // Ensure active status (may have been previously marked irrelevant)
        if (existing.status !== "active") {
          await updateNodeStatus(existing.node_id, "active", client);
        }
        claimContentToNodeId.set(trimmed, existing.node_id);
      } else {
        // Check if resolution or other source already added this claim (avoid duplicate)
        const dupRes = await client.query(
          `SELECT node_id, confidence FROM nodes WHERE scope_id = $1 AND type = 'claim' AND status = 'active'
           AND content = $2 AND superseded_at IS NULL LIMIT 1`,
          [scopeId, trimmed],
        );
        if (dupRes.rowCount && dupRes.rows[0]) {
          const dup = dupRes.rows[0] as { node_id: string; confidence: number };
          matchedClaimIds.add(dup.node_id);
          if (confidence >= dup.confidence) {
            await updateNodeConfidence(dup.node_id, confidence, client);
            nodesUpdated++;
          }
          claimContentToNodeId.set(trimmed, dup.node_id);
          continue;
        }
        // New claim — insert
        const nodeId = await appendNode(
          {
            scope_id: scopeId,
            type: "claim",
            content: trimmed,
            confidence,
            status: "active",
            source_ref: { source: "facts" },
            created_by: FACTS_SYNC_SOURCE,
            ...(hasValidTime && { valid_from: validFrom ?? null, valid_to: validTo ?? null }),
          },
          client,
        );
        claimContentToNodeId.set(trimmed, nodeId);
        nodesCreated++;
      }
    }

    // --- Goals: upsert by content match ---
    for (const content of goals) {
      if (typeof content !== "string" || !content.trim()) continue;
      const trimmed = content.trim();
      const existing = matchExistingNode(existingGoals, trimmed);

      if (existing) {
        matchedGoalIds.add(existing.node_id);
        if (existing.status !== "active") {
          await updateNodeStatus(existing.node_id, "active", client);
        }
      } else {
        await appendNode(
          {
            scope_id: scopeId,
            type: "goal",
            content: trimmed,
            status: "active",
            source_ref: { source: "facts" },
            created_by: FACTS_SYNC_SOURCE,
            ...(hasValidTime && { valid_from: validFrom ?? null, valid_to: validTo ?? null }),
          },
          client,
        );
        nodesCreated++;
      }
    }

    // --- Risks: upsert by content match ---
    for (const content of risks) {
      if (typeof content !== "string" || !content.trim()) continue;
      const trimmed = content.trim();
      const existing = matchExistingNode(existingRisks, trimmed);

      if (existing) {
        matchedRiskIds.add(existing.node_id);
        if (existing.status !== "active") {
          await updateNodeStatus(existing.node_id, "active", client);
        }
      } else {
        await appendNode(
          {
            scope_id: scopeId,
            type: "risk",
            content: trimmed,
            ...(hasValidTime && { valid_from: validFrom ?? null, valid_to: validTo ?? null }),
            status: "active",
            metadata: { severity: "high" },
            source_ref: { source: "facts" },
            created_by: FACTS_SYNC_SOURCE,
          },
          client,
        );
        nodesCreated++;
      }
    }

    // --- Mark stale nodes as "irrelevant" (not deleted — CRDT append-only) ---
    // Only stale nodes that are "active" AND created by facts-sync. Never stale
    // nodes that were resolved/in_progress by human resolution or other sources.
    //
    // Goals and risks are PROTECTED from stale marking: they are accumulative
    // across documents (a goal from doc 1 is still valid when doc 2 is extracted).
    // Staling goals caused goal_completion to be permanently stuck at 0.00 in all
    // experiments — see Exp 9 (confluence) and the paper Section 8 corollary.
    const STALEABLE_STATUSES = new Set(["active"]);
    const PROTECTED_CREATORS = new Set(["resolution"]);
    for (const node of existingClaims) {
      if (!matchedClaimIds.has(node.node_id) && STALEABLE_STATUSES.has(node.status) && !PROTECTED_CREATORS.has(node.created_by ?? "")) {
        await updateNodeStatus(node.node_id, "irrelevant", client);
        nodesStaled++;
      }
    }
    // Goals: skip stale marking — goals accumulate across extractions.
    // Risks: skip stale marking — risks accumulate across extractions.

    // --- Contradictions: create nodes AND edges ---
    // Load existing contradiction nodes to avoid duplicates
    const existingContras = await queryNodesByCreator(scopeId, FACTS_SYNC_SOURCE, "contradiction", client);
    const matchedContraIds = new Set<string>();

    // Load resolved contradictions to skip re-creating them
    let resolvedContents = new Set<string>();
    try {
      const resolvedContras = await client.query(
        `SELECT content FROM nodes WHERE scope_id = $1 AND type = 'contradiction' AND status = 'resolved'
         AND superseded_at IS NULL LIMIT 50`,
        [scopeId],
      );
      resolvedContents = new Set(
        resolvedContras.rows.map((r: { content: string }) => r.content.toLowerCase().trim()),
      );
    } catch {
      // resolved query may fail in tests or if schema differs
    }

    for (const raw of contradictions) {
      const str = typeof raw === "string" ? raw : String(raw);
      if (!str.trim()) continue;

      let matchesResolved = false;
      try {
        const { isResolved } = await import("./resolutionService.js");
        const result = await isResolved(str.trim(), scopeId);
        matchesResolved = result.resolved;
      } catch {
        const lowerStr = str.trim().toLowerCase();
        matchesResolved = resolvedContents.has(lowerStr);
        if (!matchesResolved) {
          const newWords = new Set(lowerStr.split(/\s+/).filter((w) => w.length > 3));
          for (const resolved of resolvedContents) {
            const resWords = new Set(resolved.split(/\s+/).filter((w: string) => w.length > 3));
            let overlap = 0;
            for (const w of newWords) if (resWords.has(w)) overlap++;
            if (newWords.size > 0 && overlap / newWords.size >= 0.5) {
              matchesResolved = true;
              break;
            }
          }
        }
      }
      if (matchesResolved) continue;

      // Always create/upsert a contradiction node so it's counted in finality
      const existingContra = matchExistingNode(existingContras, str.trim());
      let contraNodeId: string | null = null;
      if (existingContra) {
        contraNodeId = existingContra.node_id;
        matchedContraIds.add(existingContra.node_id);
        if (existingContra.status !== "active") {
          await updateNodeStatus(existingContra.node_id, "active", client);
        }
      } else {
        contraNodeId = await appendNode(
          {
            scope_id: scopeId,
            type: "contradiction",
            content: str.trim(),
            status: "active",
            source_ref: { source: "facts" },
            created_by: FACTS_SYNC_SOURCE,
            ...(hasValidTime && { valid_from: validFrom ?? null, valid_to: validTo ?? null }),
          },
          client,
        );
        nodesCreated++;
      }

      // Try to create edge between the conflicting claims
      const pair = parseNliContradiction(str);
      if (!pair) continue;
      const [a, b] = pair;
      const sourceId = findClaimNodeId(claimContentToNodeId, a);
      const targetId = findClaimNodeId(claimContentToNodeId, b);
      if (sourceId && targetId && sourceId !== targetId) {
        const resolved = await hasResolvingEdge(scopeId, sourceId, targetId, client);
        if (!resolved) {
          await appendEdge(
            {
              scope_id: scopeId,
              source_id: sourceId,
              target_id: targetId,
              edge_type: "contradicts",
              weight: 1,
              metadata: { raw: str },
              created_by: FACTS_SYNC_SOURCE,
              ...(hasValidTime && { valid_from: validFrom ?? null, valid_to: validTo ?? null }),
            },
            client,
          );
          edgesCreated++;

          // Store structural claim link on the contradiction node
          if (contraNodeId) {
            await client.query(
              `UPDATE nodes SET metadata = metadata || $2::jsonb, updated_at = now()
               WHERE node_id = $1`,
              [contraNodeId, JSON.stringify({ claim_source_id: sourceId, claim_target_id: targetId })],
            );
          }
        }
      }
    }

    // Contradictions: skip stale marking — contradictions accumulate across extractions
    // and should only be resolved via the resolution flow (HITL, resolver agent, or MCP).
    // Staling contradictions caused them to disappear before the user could address them.
  });

  if (opts?.embedClaims && nodesCreated > 0) {
    const { embedAndPersistNode } = await import("./embeddingPipeline.js");
    const claimContents = [...claimContentToNodeId.entries()];
    for (const [content, nodeId] of claimContents) {
      try {
        await embedAndPersistNode(nodeId, scopeId, content);
      } catch (e) {
        logger.warn("facts-sync: embed claim failed", { nodeId, error: String(e) });
      }
    }
  }

  logger.info("facts-sync: synced facts to semantic graph", {
    scopeId,
    nodesCreated,
    nodesUpdated,
    nodesStaled,
    edgesCreated,
  });
  return { nodesCreated, edgesCreated, nodesUpdated, nodesStaled };
}
