import { getPool } from "../db.js";
import { CURRENT_VIEW_EDGES, CURRENT_VIEW_NODES } from "./view.js";

/** Lightweight counts by type for feed / state graph display. */
/**
 * Returns active node content grouped by type, with counts for all statuses.
 * Canonical source for UI panels that need both counts and text.
 */
export async function getKnowledgeState(scopeId: string): Promise<{
  counts: {
    claims: number;
    goals: number;
    contradictions: number;
    risks: number;
    contradictions_resolved: number;
  };
  claims: string[];
  goals: string[];
  contradictions: string[];
  risks: string[];
}> {
  const p = getPool();
  const res = await p.query(
    `SELECT type, status, content, created_by FROM nodes
     WHERE scope_id = $1 AND type IN ('claim','goal','contradiction','risk') AND (${CURRENT_VIEW_NODES})
     ORDER BY created_at ASC`,
    [scopeId],
  );
  const claims: string[] = [];
  const claimSources: string[] = [];
  const goals: string[] = [];
  const contradictions: string[] = [];
  const risks: string[] = [];
  let contraResolved = 0;

  const KS_STOP = new Set([
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
    "just",
    "about",
    "between",
    "through",
    "during",
    "out",
    "more",
    "other",
  ]);

  function ksSigWords(s: string): Set<string> {
    return new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !KS_STOP.has(w))
        .map((w) => (w.length > 6 ? w.slice(0, 6) : w)),
    );
  }

  function isDuplicateClaim(
    existing: string[],
    candidate: string,
    candidateSource: string,
  ): boolean {
    const cw = ksSigWords(candidate);
    if (cw.size === 0) return true;
    for (let j = 0; j < existing.length; j++) {
      if (candidateSource !== "resolution" && claimSources[j] === "resolution")
        continue;
      const ew = ksSigWords(existing[j]);
      let overlap = 0;
      for (const w of cw) if (ew.has(w)) overlap++;
      const maxSz = Math.max(cw.size, ew.size);
      const minSz = Math.min(cw.size, ew.size);
      if (maxSz > 0 && overlap / maxSz >= 0.5) return true;
      if (minSz > 0 && overlap >= 2 && overlap / minSz >= 0.6) return true;
    }
    return false;
  }

  function isDuplicate(existing: string[], candidate: string): boolean {
    const cw = ksSigWords(candidate);
    if (cw.size === 0) return true;
    for (const e of existing) {
      const ew = ksSigWords(e);
      let overlap = 0;
      for (const w of cw) if (ew.has(w)) overlap++;
      const maxSz = Math.max(cw.size, ew.size);
      const minSz = Math.min(cw.size, ew.size);
      if (maxSz > 0 && overlap / maxSz >= 0.5) return true;
      if (minSz > 0 && overlap >= 2 && overlap / minSz >= 0.6) return true;
    }
    return false;
  }

  /**
   * Detect when a newer claim supersedes an older one about the same topic.
   * Returns the index of the superseded entry, or -1 if none.
   * Triggers when the candidate contains explicit correction language AND
   * shares key terms with an existing entry.
   */
  function findSuperseded(existing: string[], candidate: string): number {
    if (
      !/\b(adjust\w*|revis\w*|correct\w*|overstat\w*|downward|previously stated|not the .{3,40}previously)\b/i.test(
        candidate,
      )
    )
      return -1;
    const cw = ksSigWords(candidate);
    if (cw.size === 0) return -1;
    for (let i = 0; i < existing.length; i++) {
      const ew = ksSigWords(existing[i]);
      let overlap = 0;
      for (const w of cw) if (ew.has(w)) overlap++;
      if (overlap >= 2 && overlap / Math.min(cw.size, ew.size) >= 0.25)
        return i;
    }
    return -1;
  }

  const resolvedContraTexts: string[] = [];
  const resolutionClaimIndices: number[] = [];

  for (const r of res.rows) {
    const content = String(r.content ?? "").trim();
    if (!content) continue;
    const status = String(r.status ?? "active");
    const createdBy = String(r.created_by ?? "");
    switch (r.type) {
      case "claim":
        if (status === "active") {
          if (createdBy !== "resolution") {
            const supersededIdx = findSuperseded(claims, content);
            if (supersededIdx >= 0) {
              claims[supersededIdx] = content;
              claimSources[supersededIdx] = createdBy;
              break;
            }
          }
          if (isDuplicateClaim(claims, content, createdBy)) break;
          claims.push(content);
          claimSources.push(createdBy);
          if (createdBy === "resolution")
            resolutionClaimIndices.push(claims.length - 1);
        }
        break;
      case "goal":
        if (status === "active" && !isDuplicate(goals, content))
          goals.push(content);
        break;
      case "contradiction":
        if (status === "active" && !isDuplicate(contradictions, content))
          contradictions.push(content);
        else if (
          status === "resolved" &&
          !isDuplicate(resolvedContraTexts, content)
        ) {
          resolvedContraTexts.push(content);
          contraResolved++;
        }
        break;
      case "risk":
        if (status === "active" && !isDuplicate(risks, content))
          risks.push(content);
        break;
    }
  }

  // Suppress resolution claims whose content is collectively covered by structured claims.
  // Multi-statement resolution text may span multiple facts-sync claims, so check
  // word-level coverage across ALL non-resolution claims rather than pairwise overlap.
  const suppressedIndices = new Set<number>();
  for (const ri of resolutionClaimIndices) {
    const rw = ksSigWords(claims[ri]);
    if (rw.size === 0) continue;
    let coveredWords = 0;
    for (const w of rw) {
      for (let i = 0; i < claims.length; i++) {
        if (
          i === ri ||
          suppressedIndices.has(i) ||
          claimSources[i] === "resolution"
        )
          continue;
        if (ksSigWords(claims[i]).has(w)) {
          coveredWords++;
          break;
        }
      }
    }
    if (coveredWords >= 3 || (rw.size > 0 && coveredWords / rw.size >= 0.5))
      suppressedIndices.add(ri);
  }
  const filteredClaims = claims.filter((_, i) => !suppressedIndices.has(i));

  return {
    counts: {
      claims: filteredClaims.length,
      goals: goals.length,
      contradictions: contradictions.length,
      risks: risks.length,
      contradictions_resolved: contraResolved,
    },
    claims: filteredClaims,
    goals,
    contradictions,
    risks,
  };
}

export async function getGraphSummary(
  scopeId: string,
): Promise<{ nodes: Record<string, number>; edges: Record<string, number> }> {
  const p = getPool();
  const nodeRes = await p.query(
    `SELECT type, COUNT(*)::int AS c FROM nodes WHERE scope_id = $1 AND (${CURRENT_VIEW_NODES}) GROUP BY type`,
    [scopeId],
  );
  const nodes: Record<string, number> = {};
  for (const r of nodeRes.rows) nodes[String(r.type)] = Number(r.c ?? 0);

  const edgeRes = await p.query(
    `SELECT edge_type, COUNT(*)::int AS c FROM edges WHERE scope_id = $1 AND (${CURRENT_VIEW_EDGES}) GROUP BY edge_type`,
    [scopeId],
  );
  const edges: Record<string, number> = {};
  for (const r of edgeRes.rows) edges[String(r.edge_type)] = Number(r.c ?? 0);

  return { nodes, edges };
}
