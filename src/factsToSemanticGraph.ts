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
  queryNodesByCreator,
  type SemanticNode,
} from "./semanticGraph.js";
import { logger } from "./logger.js";
import { canonicalizeClaimText } from "./canonicalValue.js";
import type { EquivalenceCandidate } from "./equivalenceGate.js";
import { findRelatedNodeIds } from "./studioGraphEdges.js";

const FACTS_SYNC_SOURCE = "facts-sync";

export interface StructuredClaim {
  dimension: string;
  content: string;
}

/**
 * Per-item document provenance emitted by the facts-worker (issue #6).
 * document_seq is the primary originating WAL context_doc seq; document_seqs
 * lists all matched sources (>1 for multi-source items like contradictions).
 */
export interface NodeProvenance {
  document_seq?: number | null;
  document_seqs?: number[];
  document_title?: string | null;
  document_content_hash?: string | null;
}

export interface FactsProvenance {
  documents?: Array<{ seq: number; title?: string | null; content_hash?: string | null }>;
  claims?: NodeProvenance[];
  structured_claims?: NodeProvenance[];
  goals?: NodeProvenance[];
  risks?: NodeProvenance[];
  contradictions?: NodeProvenance[];
  analyzed_seq_range?: [number, number] | null;
}

export interface FactsPayload {
  entities?: string[];
  claims?: string[];
  /** Dimension-keyed claims from structured extraction (preferred over flat `claims`). */
  structured_claims?: StructuredClaim[];
  risks?: string[];
  assumptions?: string[];
  contradictions?: string[];
  goals?: string[];
  confidence?: number;
  /** Per-item document provenance (issue #6); parallel arrays to the lists above. */
  provenance?: FactsProvenance;
  /** Bitemporal: valid time for all nodes/edges from this payload (optional). */
  valid_from?: string | null;
  valid_to?: string | null;
  [k: string]: unknown;
}

/**
 * Build a facts-derived node's source_ref from optional per-item provenance.
 * Always carries `source: "facts"`. document_seqs is only included when the item
 * has more than one source (superset of issue #6's singular document_seq).
 */
export function factsSourceRef(prov?: NodeProvenance | null): Record<string, unknown> {
  const ref: Record<string, unknown> = { source: "facts" };
  if (!prov) return ref;
  if (typeof prov.document_seq === "number") ref.document_seq = prov.document_seq;
  if (Array.isArray(prov.document_seqs) && prov.document_seqs.length > 1) {
    ref.document_seqs = prov.document_seqs;
  }
  if (typeof prov.document_title === "string" && prov.document_title) {
    ref.document_title = prov.document_title;
  }
  if (typeof prov.document_content_hash === "string" && prov.document_content_hash) {
    ref.document_content_hash = prov.document_content_hash;
  }
  return ref;
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

  const whichContradicts = /(.+?),?\s+which\s+contradicts?\s+(.+)/i.exec(
    trimmed,
  );
  if (whichContradicts)
    return [whichContradicts[1].trim(), whichContradicts[2].trim()];

  const versus = /(.+?)\s+(?:versus|vs\.?)\s+(.+)/i.exec(trimmed);
  if (versus) return [versus[1].trim(), versus[2].trim()];

  const butWhile = /(.+?),?\s+(?:but|while|whereas|however)\s+(.+)/i.exec(
    trimmed,
  );
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
    if (
      content === fragment ||
      content.startsWith(fragment) ||
      fragment.startsWith(content)
    )
      return id;
  }
  const fragWords = new Set(
    fragment
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
  if (fragWords.size === 0) return null;
  let bestId: string | null = null;
  let bestScore = 0;
  for (const [content, id] of contentToId) {
    const contentWords = new Set(
      content
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
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
  "the",
  "and",
  "for",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
  "not",
  "but",
  "its",
  "that",
  "this",
  "from",
  "with",
  "they",
  "been",
  "which",
  "into",
  "also",
  "than",
  "will",
  "can",
  "may",
  "who",
  "how",
  "all",
  "any",
  "each",
  "some",
  "such",
  "very",
]);

function sigWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
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

function matchExistingByDimension(
  existingNodes: SemanticNode[],
  dimension: string,
): SemanticNode | null {
  for (const node of existingNodes) {
    const dim = node.metadata?.dimension;
    if (typeof dim === "string" && dim === dimension) return node;
  }
  return null;
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
  opts?: { embedClaims?: boolean; docTitle?: string; contextSeq?: number },
): Promise<{
  nodesCreated: number;
  edgesCreated: number;
  nodesUpdated: number;
  nodesStaled: number;
  claimNodeIds: string[];
  /** Claims that fuzzy-matched an existing node but whose content differs. */
  equivalenceCandidates: EquivalenceCandidate[];
  /** Count of newly created nodes carrying an exact document_seq (issue #6). */
  nodesWithProvenance: number;
}> {
  const structuredClaims = (
    Array.isArray(facts.structured_claims) ? facts.structured_claims : []
  ).filter(
    (c): c is StructuredClaim =>
      typeof c === "object" &&
      c !== null &&
      typeof (c as StructuredClaim).dimension === "string" &&
      typeof (c as StructuredClaim).content === "string",
  );
  const claims = (Array.isArray(facts.claims) ? facts.claims : []).filter(
    (c): c is string => typeof c === "string",
  );
  const goals = (Array.isArray(facts.goals) ? facts.goals : []).filter(
    (g): g is string => typeof g === "string",
  );
  const risks = (Array.isArray(facts.risks) ? facts.risks : []).filter(
    (r): r is string => typeof r === "string",
  );
  const contradictions = (
    Array.isArray(facts.contradictions) ? facts.contradictions : []
  ).filter((c): c is string => typeof c === "string");
  const confidence =
    typeof facts.confidence === "number" ? facts.confidence : 1;
  const minClaimConfidence = Number(process.env.MIN_CLAIM_CONFIDENCE ?? "0.65");
  const validFrom = facts.valid_from ?? undefined;
  const validTo = facts.valid_to ?? undefined;
  const hasValidTime = validFrom !== undefined || validTo !== undefined;

  // Per-item document provenance (issue #6), parallel to the lists above.
  const provenance: FactsProvenance =
    facts.provenance && typeof facts.provenance === "object" ? facts.provenance : {};
  const claimProv = Array.isArray(provenance.claims) ? provenance.claims : [];
  const structuredClaimProv = Array.isArray(provenance.structured_claims)
    ? provenance.structured_claims
    : [];
  const goalProv = Array.isArray(provenance.goals) ? provenance.goals : [];
  const riskProv = Array.isArray(provenance.risks) ? provenance.risks : [];
  const contradictionProv = Array.isArray(provenance.contradictions)
    ? provenance.contradictions
    : [];

  let nodesCreated = 0;
  let nodesUpdated = 0;
  let nodesStaled = 0;
  let edgesCreated = 0;
  let nodesWithProvenance = 0;
  const claimContentToNodeId = new Map<string, string>();
  const equivalenceCandidates: EquivalenceCandidate[] = [];

  // Backfill provenance onto an existing facts-sync node when it currently has
  // none. Cheap partial-retroactive coverage: a re-extraction that now matches
  // a source document heals a pre-migration node without a full replay.
  async function enrichNodeProvenance(
    nodeId: string,
    prov: NodeProvenance | undefined,
    client: import("pg").PoolClient,
  ): Promise<void> {
    const ref = factsSourceRef(prov);
    if (typeof ref.document_seq !== "number") return;
    await client.query(
      `UPDATE nodes SET source_ref = source_ref || $2::jsonb, updated_at = now()
       WHERE node_id = $1 AND (source_ref->>'document_seq') IS NULL`,
      [nodeId, JSON.stringify(ref)],
    );
  }

  await runInTransaction(async (client) => {
    // Load existing fact-synced nodes
    const existingClaims = await queryNodesByCreator(
      scopeId,
      FACTS_SYNC_SOURCE,
      "claim",
      client,
    );
    const existingGoals = await queryNodesByCreator(
      scopeId,
      FACTS_SYNC_SOURCE,
      "goal",
      client,
    );
    const existingRisks = await queryNodesByCreator(
      scopeId,
      FACTS_SYNC_SOURCE,
      "risk",
      client,
    );

    // Track which existing nodes were matched (for stale detection)
    const matchedClaimIds = new Set<string>();
    const matchedGoalIds = new Set<string>();
    const matchedRiskIds = new Set<string>();

    // --- Claims: upsert-if-better (skip low-confidence batches to reduce noise) ---
    if (confidence >= minClaimConfidence) {
      const claimEntries: Array<{
        content: string;
        dimension?: string;
        prov?: NodeProvenance;
      }> =
        structuredClaims.length > 0
          ? structuredClaims.map((c, i) => ({
              content: c.content,
              dimension: c.dimension.trim(),
              prov: structuredClaimProv[i],
            }))
          : claims.map((content, i) => ({ content, prov: claimProv[i] }));

      for (const entry of claimEntries) {
        if (!entry.content?.trim()) continue;
        const trimmed = canonicalizeClaimText(entry.content).trim();
        const existing =
          entry.dimension !== undefined
            ? (matchExistingByDimension(existingClaims, entry.dimension) ??
              matchExistingNode(existingClaims, trimmed))
            : matchExistingNode(existingClaims, trimmed);

        if (existing) {
          matchedClaimIds.add(existing.node_id);
          await enrichNodeProvenance(existing.node_id, entry.prov, client);
          if (existing.content !== trimmed) {
            equivalenceCandidates.push({
              node_type: "claim",
              existing_node_id: existing.node_id,
              existing_content: existing.content,
              new_content: trimmed,
              ...(entry.dimension ? { dimension: entry.dimension } : {}),
            });
          }
          if (confidence >= existing.confidence) {
            await updateNodeConfidence(existing.node_id, confidence, client);
            nodesUpdated++;
          }
          if (existing.status !== "active") {
            await updateNodeStatus(existing.node_id, "active", client);
          }
          claimContentToNodeId.set(trimmed, existing.node_id);
        } else {
          const dupRes = await client.query(
            `SELECT node_id, confidence FROM nodes WHERE scope_id = $1 AND type = 'claim' AND status = 'active'
           AND content = $2 AND superseded_at IS NULL LIMIT 1`,
            [scopeId, trimmed],
          );
          if (dupRes.rowCount && dupRes.rows[0]) {
            const dup = dupRes.rows[0] as {
              node_id: string;
              confidence: number;
            };
            matchedClaimIds.add(dup.node_id);
            await enrichNodeProvenance(dup.node_id, entry.prov, client);
            if (confidence >= dup.confidence) {
              await updateNodeConfidence(dup.node_id, confidence, client);
              nodesUpdated++;
            }
            claimContentToNodeId.set(trimmed, dup.node_id);
            continue;
          }
          const claimSourceRef = factsSourceRef(entry.prov);
          if (typeof claimSourceRef.document_seq === "number") nodesWithProvenance++;
          const nodeId = await appendNode(
            {
              scope_id: scopeId,
              type: "claim",
              content: trimmed,
              confidence,
              status: "active",
              source_ref: claimSourceRef,
              metadata: entry.dimension ? { dimension: entry.dimension } : {},
              created_by: FACTS_SYNC_SOURCE,
              ...(hasValidTime && {
                valid_from: validFrom ?? null,
                valid_to: validTo ?? null,
              }),
            },
            client,
          );
          claimContentToNodeId.set(trimmed, nodeId);
          nodesCreated++;
        }
      }
    }

    // --- Goals: upsert by content match ---
    for (let gi = 0; gi < goals.length; gi++) {
      const content = goals[gi];
      if (typeof content !== "string" || !content.trim()) continue;
      const trimmed = canonicalizeClaimText(content).trim();
      const existing = matchExistingNode(existingGoals, trimmed);

      if (existing) {
        matchedGoalIds.add(existing.node_id);
        await enrichNodeProvenance(existing.node_id, goalProv[gi], client);
        if (existing.status !== "active") {
          await updateNodeStatus(existing.node_id, "active", client);
        }
      } else {
        const goalSourceRef = factsSourceRef(goalProv[gi]);
        if (typeof goalSourceRef.document_seq === "number") nodesWithProvenance++;
        await appendNode(
          {
            scope_id: scopeId,
            type: "goal",
            content: trimmed,
            status: "active",
            source_ref: goalSourceRef,
            created_by: FACTS_SYNC_SOURCE,
            ...(hasValidTime && {
              valid_from: validFrom ?? null,
              valid_to: validTo ?? null,
            }),
          },
          client,
        );
        nodesCreated++;
      }
    }

    // --- Risks: upsert by content match ---
    for (let ri = 0; ri < risks.length; ri++) {
      const content = risks[ri];
      if (typeof content !== "string" || !content.trim()) continue;
      const trimmed = canonicalizeClaimText(content).trim();
      const existing = matchExistingNode(existingRisks, trimmed);

      if (existing) {
        matchedRiskIds.add(existing.node_id);
        await enrichNodeProvenance(existing.node_id, riskProv[ri], client);
        if (existing.status !== "active") {
          await updateNodeStatus(existing.node_id, "active", client);
        }
      } else {
        const riskSourceRef = factsSourceRef(riskProv[ri]);
        if (typeof riskSourceRef.document_seq === "number") nodesWithProvenance++;
        await appendNode(
          {
            scope_id: scopeId,
            type: "risk",
            content: trimmed,
            ...(hasValidTime && {
              valid_from: validFrom ?? null,
              valid_to: validTo ?? null,
            }),
            status: "active",
            metadata: { severity: "high" },
            source_ref: riskSourceRef,
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
      if (
        !matchedClaimIds.has(node.node_id) &&
        STALEABLE_STATUSES.has(node.status) &&
        !PROTECTED_CREATORS.has(node.created_by ?? "")
      ) {
        await updateNodeStatus(node.node_id, "irrelevant", client);
        nodesStaled++;
      }
    }
    // Goals: skip stale marking — goals accumulate across extractions.
    // Risks: skip stale marking — risks accumulate across extractions.

    // --- Contradictions: create nodes AND edges ---
    // Load existing contradiction nodes to avoid duplicates
    const existingContras = await queryNodesByCreator(
      scopeId,
      FACTS_SYNC_SOURCE,
      "contradiction",
      client,
    );
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
        resolvedContras.rows.map((r: { content: string }) =>
          r.content.toLowerCase().trim(),
        ),
      );
    } catch {
      // resolved query may fail in tests or if schema differs
    }

    for (let ci = 0; ci < contradictions.length; ci++) {
      const raw = contradictions[ci];
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
          const newWords = new Set(
            lowerStr.split(/\s+/).filter((w) => w.length > 3),
          );
          for (const resolved of resolvedContents) {
            const resWords = new Set(
              resolved.split(/\s+/).filter((w: string) => w.length > 3),
            );
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
        await enrichNodeProvenance(existingContra.node_id, contradictionProv[ci], client);
        if (existingContra.status !== "active") {
          await updateNodeStatus(existingContra.node_id, "active", client);
        }
      } else {
        const contraSourceRef = factsSourceRef(contradictionProv[ci]);
        if (typeof contraSourceRef.document_seq === "number") nodesWithProvenance++;
        contraNodeId = await appendNode(
          {
            scope_id: scopeId,
            type: "contradiction",
            content: str.trim(),
            status: "active",
            source_ref: contraSourceRef,
            created_by: FACTS_SYNC_SOURCE,
            ...(hasValidTime && {
              valid_from: validFrom ?? null,
              valid_to: validTo ?? null,
            }),
          },
          client,
        );
        nodesCreated++;
      }

      // Link contradiction node to related claims (Studio graph topology).
      let linkedClaimIds: string[] = [];
      const pair = parseNliContradiction(str);
      if (pair) {
        const aId = findClaimNodeId(claimContentToNodeId, pair[0]);
        const bId = findClaimNodeId(claimContentToNodeId, pair[1]);
        if (aId) linkedClaimIds.push(aId);
        if (bId && bId !== aId) linkedClaimIds.push(bId);
      }
      if (linkedClaimIds.length === 0) {
        linkedClaimIds = findRelatedNodeIds(
          [...claimContentToNodeId.entries()].map(([content, id]) => ({
            id,
            type: "claim",
            content,
          })),
          str,
          2,
          0.2,
        );
      }
      if (contraNodeId && linkedClaimIds.length) {
        for (const claimId of linkedClaimIds) {
          await appendEdge(
            {
              scope_id: scopeId,
              source_id: contraNodeId,
              target_id: claimId,
              edge_type: "contradicts",
              weight: 1,
              metadata: { raw: str },
              created_by: FACTS_SYNC_SOURCE,
              ...(hasValidTime && {
                valid_from: validFrom ?? null,
                valid_to: validTo ?? null,
              }),
            },
            client,
          );
          edgesCreated++;
        }
        await client.query(
          `UPDATE nodes SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb, updated_at = now()
           WHERE node_id = $1`,
          [
            contraNodeId,
            JSON.stringify({
              claim_source_id: linkedClaimIds[0],
              ...(linkedClaimIds[1]
                ? { claim_target_id: linkedClaimIds[1] }
                : {}),
            }),
          ],
        );
      }
    }

    // Contradictions: skip stale marking — contradictions accumulate across extractions
    // and should only be resolved via the resolution flow (HITL, resolver agent, or MCP).
    // Staling contradictions caused them to disappear before the user could address them.

    if (opts?.docTitle?.trim()) {
      const title = opts.docTitle.trim();
      const claimIds = [...claimContentToNodeId.values()];
      const docMeta: Record<string, unknown> = { claim_ids: claimIds };
      if (typeof opts.contextSeq === "number") {
        docMeta.context_seq = opts.contextSeq;
      }
      const existingDocRes = await client.query(
        `SELECT node_id, content FROM nodes
         WHERE scope_id = $1 AND type = 'doc' AND superseded_at IS NULL AND status = 'active'`,
        [scopeId],
      );
      const normTitle = title
        .trim()
        .toLowerCase()
        .replace(/\.[^.]+$/i, "");
      const existing = (
        existingDocRes.rows as Array<{ node_id: string; content: string }>
      ).find(
        (r) =>
          String(r.content)
            .trim()
            .toLowerCase()
            .replace(/\.[^.]+$/i, "") === normTitle,
      );
      if (existing) {
        await client.query(
          `UPDATE nodes SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb, updated_at = now()
           WHERE node_id = $1`,
          [existing.node_id, JSON.stringify(docMeta)],
        );
        nodesUpdated++;
      } else {
        await appendNode(
          {
            scope_id: scopeId,
            type: "doc",
            content: title,
            status: "active",
            metadata: docMeta,
            source_ref: {
              source: "facts",
              ...(typeof opts.contextSeq === "number"
                ? { context_seq: opts.contextSeq }
                : {}),
            },
            created_by: FACTS_SYNC_SOURCE,
          },
          client,
        );
        nodesCreated++;
      }
    }
  });

  if (opts?.embedClaims && nodesCreated > 0) {
    const { embedAndPersistNode } = await import("./embeddingPipeline.js");
    const claimContents = [...claimContentToNodeId.entries()];
    for (const [content, nodeId] of claimContents) {
      try {
        await embedAndPersistNode(nodeId, scopeId, content);
      } catch (e) {
        logger.warn("facts-sync: embed claim failed", {
          nodeId,
          error: String(e),
        });
      }
    }
  }

  logger.info("facts-sync: synced facts to semantic graph", {
    scopeId,
    nodesCreated,
    nodesUpdated,
    nodesStaled,
    edgesCreated,
    equivalenceCandidates: equivalenceCandidates.length,
    // Issue #6 provenance coverage: fraction of newly created nodes that carry an
    // exact document_seq. Low coverage indicates LLM paraphrase / synthesis or
    // missing WAL seq plumbing.
    nodesWithProvenance,
    provenanceCoverage:
      nodesCreated > 0 ? Number((nodesWithProvenance / nodesCreated).toFixed(3)) : null,
  });
  return {
    nodesCreated,
    edgesCreated,
    nodesUpdated,
    nodesStaled,
    claimNodeIds: [...claimContentToNodeId.values()],
    equivalenceCandidates,
    nodesWithProvenance,
  };
}

export type ContextDocMarker = { title: string; contextSeq: number };

function normalizeDocTitleForStorage(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\.[^.]+$/i, "");
}

async function upsertDocMarker(
  scopeId: string,
  title: string,
  contextSeq: number,
  claimIds: string[],
  client: import("pg").PoolClient,
): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) return;
  const docMeta: Record<string, unknown> = {
    context_seq: contextSeq,
    analyzed_at: new Date().toISOString(),
  };
  if (claimIds.length) docMeta.claim_ids = claimIds;

  const existingDocRes = await client.query(
    `SELECT node_id, content FROM nodes
     WHERE scope_id = $1 AND type = 'doc' AND superseded_at IS NULL AND status = 'active'`,
    [scopeId],
  );
  const normTitle = normalizeDocTitleForStorage(trimmed);
  const existing = (
    existingDocRes.rows as Array<{ node_id: string; content: string }>
  ).find(
    (r) => normalizeDocTitleForStorage(String(r.content || "")) === normTitle,
  );
  if (existing) {
    await client.query(
      `UPDATE nodes SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb, updated_at = now()
       WHERE node_id = $1`,
      [existing.node_id, JSON.stringify(docMeta)],
    );
    return;
  }
  await appendNode(
    {
      scope_id: scopeId,
      type: "doc",
      content: trimmed,
      status: "active",
      metadata: docMeta,
      source_ref: { source: "facts", context_seq: contextSeq },
      created_by: FACTS_SYNC_SOURCE,
    },
    client,
  );
}

/** Mark WAL context_doc rows as analyzed (Studio document progress). */
export async function markContextDocsAnalyzed(
  scopeId: string,
  docs: ContextDocMarker[],
  claimIds: string[] = [],
  opts?: { claimContextSeq?: number; attachClaimsToAll?: boolean },
): Promise<void> {
  if (!docs.length) return;
  await runInTransaction(async (client) => {
    for (const doc of docs) {
      const attachClaims = opts?.attachClaimsToAll
        ? claimIds
        : opts?.claimContextSeq != null
          ? opts.claimContextSeq === doc.contextSeq
            ? claimIds
            : []
          : claimIds;
      await upsertDocMarker(
        scopeId,
        doc.title,
        doc.contextSeq,
        attachClaims,
        client,
      );
    }
  });
}
