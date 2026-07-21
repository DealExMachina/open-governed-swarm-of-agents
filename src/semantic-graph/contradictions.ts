import pg from "pg";
import { getPool } from "../db.js";
import { appendNode } from "./nodes.js";
import type {
  ContradictionWithResolution,
  UnresolvedContradictionDetail,
} from "./types.js";

/** Parse contradiction content into two sides for "choose A" / "choose B" UI. */
function parseContradictionSides(content: string): [string, string] | null {
  const s = content.trim();
  const nli = /^NLI:\s*"(.*?)"\s+vs\s+"(.*?)"/s.exec(s);
  if (nli)
    return [
      nli[1].replace(/\.\.\.$/, "").trim(),
      nli[2].replace(/\.\.\.$/, "").trim(),
    ];
  const contradicts = /^(.*?)\s+contradicts?\s+(.*)$/i.exec(s);
  if (contradicts) return [contradicts[1].trim(), contradicts[2].trim()];
  const versus = /(.+?)\s+(?:versus|vs\.?)\s+(.+)/i.exec(s);
  if (versus) return [versus[1].trim(), versus[2].trim()];
  const butWhile = /(.+?),?\s+(?:but|while|whereas|however)\s+(.+)/i.exec(s);
  if (butWhile) return [butWhile[1].trim(), butWhile[2].trim()];
  return null;
}

/** Load unresolved contradiction details for HITL, resolver, and finality.
 * Canonical source: contradiction nodes with status='active'.
 * For contradicts edges without a matching node, creates the missing node
 * so that all contradictions have a single resolution path via node. */
export async function loadUnresolvedContradictionDetails(
  scopeId: string,
  pool?: pg.Pool,
): Promise<UnresolvedContradictionDetail[]> {
  const p = pool ?? getPool();
  const seenPairs = new Set<string>();

  function pairKey(a: string, b: string): string {
    const [x, y] = [a.trim().toLowerCase(), b.trim().toLowerCase()];
    return x <= y ? `${x}::${y}` : `${y}::${x}`;
  }

  const out: UnresolvedContradictionDetail[] = [];

  const HITL_STOP = new Set([
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
  function hitlSigWords(s: string): Set<string> {
    return new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !HITL_STOP.has(w))
        .map((w) => (w.length > 6 ? w.slice(0, 6) : w)),
    );
  }
  function isDuplicateContent(candidate: string): boolean {
    const cWords = hitlSigWords(candidate);
    if (cWords.size === 0) return false;
    for (const existing of out) {
      const eWords = hitlSigWords(existing.content);
      let overlap = 0;
      for (const w of cWords) if (eWords.has(w)) overlap++;
      if (overlap / Math.max(cWords.size, eWords.size) >= 0.5) return true;
    }
    return false;
  }

  // 1. Load contradiction nodes (canonical)
  const nodeRes = await p.query(
    `SELECT node_id, content, metadata FROM nodes
     WHERE scope_id = $1 AND type = 'contradiction' AND status = 'active'
     AND superseded_at IS NULL AND (valid_to IS NULL OR valid_to > now())
     ORDER BY created_at DESC LIMIT 20`,
    [scopeId],
  );
  for (const row of nodeRes.rows) {
    const r = row as {
      node_id: string;
      content: string;
      metadata?: { claim_source_id?: string; claim_target_id?: string };
    };
    if (isDuplicateContent(r.content)) continue;
    const sides = parseContradictionSides(r.content);
    const sa = sides?.[0] ?? "";
    const sb = sides?.[1] ?? "";
    if (sa || sb) seenPairs.add(pairKey(sa, sb));
    let related_claims: string[] | undefined;
    const srcId = (r.metadata as Record<string, unknown> | undefined)
      ?.claim_source_id as string | undefined;
    const tgtId = (r.metadata as Record<string, unknown> | undefined)
      ?.claim_target_id as string | undefined;
    if (srcId && tgtId) {
      const claimRes = await p.query(
        `SELECT content FROM nodes WHERE node_id = ANY($1::uuid[]) AND scope_id = $2`,
        [[srcId, tgtId], scopeId],
      );
      related_claims = claimRes.rows
        .map((c: { content: string }) => c.content)
        .filter(Boolean);
    }
    out.push({
      node_id: r.node_id,
      content: r.content,
      side_a: sides?.[0],
      side_b: sides?.[1],
      related_claims,
    });
  }

  // 2. Find contradicts edges without a matching node — create missing nodes
  const edgeRes = await p.query(
    `SELECT e.source_id, e.target_id, n1.content AS claim_a, n2.content AS claim_b
     FROM edges e
     JOIN nodes n1 ON n1.node_id = e.source_id AND n1.scope_id = e.scope_id AND n1.superseded_at IS NULL
     JOIN nodes n2 ON n2.node_id = e.target_id AND n2.scope_id = e.scope_id AND n2.superseded_at IS NULL
     WHERE e.scope_id = $1 AND e.edge_type = 'contradicts' AND e.superseded_at IS NULL
     AND (e.valid_to IS NULL OR e.valid_to > now())
     AND (
       (n1.valid_from IS NULL AND n1.valid_to IS NULL) OR (n2.valid_from IS NULL AND n2.valid_to IS NULL)
       OR (n1.valid_from < COALESCE(n2.valid_to, 'infinity'::timestamptz) AND n2.valid_from < COALESCE(n1.valid_to, 'infinity'::timestamptz))
     )
     AND NOT EXISTS (
       SELECT 1 FROM edges r WHERE r.scope_id = e.scope_id AND r.edge_type = 'resolves'
       AND r.superseded_at IS NULL AND (r.valid_to IS NULL OR r.valid_to > now())
       AND (r.target_id = e.source_id OR r.target_id = e.target_id)
     )
     ORDER BY e.created_at DESC LIMIT 20`,
    [scopeId],
  );

  for (const row of edgeRes.rows) {
    const r = row as {
      source_id: string;
      target_id: string;
      claim_a: string;
      claim_b: string;
    };
    const key = pairKey(r.claim_a || "", r.claim_b || "");
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    const sideA = (r.claim_a || "").trim();
    const sideB = (r.claim_b || "").trim();
    const content = `${sideA} contradicts ${sideB}`;
    if (!content.trim() || content === " contradicts ") continue;

    // Create the missing contradiction node so it becomes the canonical record
    const nodeId = await appendNode({
      scope_id: scopeId,
      type: "contradiction",
      content,
      status: "active",
      source_ref: { source: "edge-backfill" },
      metadata: { claim_source_id: r.source_id, claim_target_id: r.target_id },
      created_by: "edge-backfill",
    });

    if (nodeId) {
      out.push({
        node_id: nodeId,
        content,
        side_a: sideA,
        side_b: sideB,
        related_claims: [sideA, sideB].filter(Boolean),
      });
    }
  }

  return out;
}

/** Load all contradiction nodes (active + resolved) with resolution info for narrative/story. */
export async function loadAllContradictionsWithResolutions(
  scopeId: string,
  pool?: pg.Pool,
): Promise<ContradictionWithResolution[]> {
  const p = pool ?? getPool();
  const res = await p.query(
    `SELECT node_id, content, status, source_ref, metadata, updated_at
     FROM nodes WHERE scope_id = $1 AND type = 'contradiction'
     AND superseded_at IS NULL AND (valid_to IS NULL OR valid_to > now())
     ORDER BY created_at ASC`,
    [scopeId],
  );
  return res.rows.map(
    (r: {
      node_id: string;
      content: string;
      status: string;
      source_ref?: Record<string, unknown>;
    }) => {
      const sides = parseContradictionSides(r.content);
      const src = (r.source_ref as Record<string, unknown> | undefined) ?? {};
      const resolution =
        r.status === "resolved" &&
        (src.resolved_by != null || src.resolution_reason != null)
          ? {
              by: String(src.resolved_by ?? ""),
              reason: String(src.resolution_reason ?? ""),
              resolved_at: String(src.resolved_at ?? ""),
            }
          : undefined;
      return {
        node_id: r.node_id,
        content: r.content,
        status: r.status,
        side_a: sides?.[0],
        side_b: sides?.[1],
        resolution,
      };
    },
  );
}
