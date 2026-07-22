/**
 * Studio graph edge helpers — link contradictions/risks/goals to claims for Cytoscape.
 */

export type StudioLinkNode = {
  id: string;
  type: string;
  content: string;
  metadata?: Record<string, unknown> | null;
  source_ref?: Record<string, unknown> | null;
};

const STOP = new Set([
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
  "now",
  "previously",
  "before",
  "after",
]);

function sigWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => (w.length > 6 ? w.slice(0, 6) : w)),
  );
}

export function tokenOverlap(a: string, b: string): number {
  const wa = sigWords(a);
  const wb = sigWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap++;
  return overlap / Math.max(wa.size, wb.size);
}

export function findRelatedNodeIds(
  candidates: StudioLinkNode[],
  text: string,
  max = 2,
  minScore = 0.22,
): string[] {
  const scored = candidates
    .map((c) => ({ id: c.id, score: tokenOverlap(text, c.content) }))
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score);
  const picked: string[] = [];
  for (const row of scored) {
    if (picked.includes(row.id)) continue;
    picked.push(row.id);
    if (picked.length >= max) break;
  }
  return picked;
}

export type StudioEdgeData = {
  source: string;
  target: string;
  type: string;
};

export function docTitleSearchText(title: string): string {
  return title
    .trim()
    .replace(/^\d+[-_. ]?/i, "")
    .replace(/[-_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function claimDocAffinity(docContent: string, claimContent: string): number {
  const slugScore = tokenOverlap(docTitleSearchText(docContent), claimContent);
  const fullScore = tokenOverlap(docContent, claimContent);
  return Math.max(slugScore, fullScore);
}

function asDocumentSeq(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function docContextSeq(doc: StudioLinkNode): number | undefined {
  const meta = doc.metadata ?? {};
  const src = doc.source_ref ?? {};
  return asDocumentSeq(meta.context_seq) ?? asDocumentSeq(src.context_seq);
}

function claimDocumentSeqs(claim: StudioLinkNode): number[] {
  const src = claim.source_ref ?? {};
  const seqs = new Set<number>();
  const primary = asDocumentSeq(src.document_seq);
  if (primary !== undefined) seqs.add(primary);
  if (Array.isArray(src.document_seqs)) {
    for (const raw of src.document_seqs) {
      const seq = asDocumentSeq(raw);
      if (seq !== undefined) seqs.add(seq);
    }
  }
  return [...seqs];
}

function pickDocClaimIds(
  doc: StudioLinkNode,
  claims: StudioLinkNode[],
  claimIds: string[],
  max = 3,
  minScore = 0.22,
): string[] {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const ranked = claimIds
    .map((id) => {
      const claim = byId.get(id);
      return {
        id,
        score: claim ? claimDocAffinity(doc.content, claim.content) : 0,
      };
    })
    .filter((row) => row.score >= minScore)
    .sort((a, b) => b.score - a.score);
  const picked: string[] = [];
  for (const row of ranked) {
    if (picked.includes(row.id)) continue;
    picked.push(row.id);
    if (picked.length >= max) break;
  }
  return picked;
}

export function synthesizeStudioEdges(
  nodes: StudioLinkNode[],
  existing: StudioEdgeData[],
): StudioEdgeData[] {
  const out: StudioEdgeData[] = [];
  const keys = new Set(
    existing.map((e) => `${e.source}|${e.target}|${e.type}`),
  );
  const push = (source: string, target: string, type: string): void => {
    if (!source || !target || source === target) return;
    const key = `${source}|${target}|${type}`;
    if (keys.has(key)) return;
    keys.add(key);
    out.push({ source, target, type });
  };

  const claims = nodes.filter((n) => n.type === "claim");
  const risks = nodes.filter((n) => n.type === "risk");
  const goals = nodes.filter((n) => n.type === "goal");
  const docs = nodes.filter((n) => n.type === "doc");

  const docsByContextSeq = new Map<number, StudioLinkNode[]>();
  for (const doc of docs) {
    const seq = docContextSeq(doc);
    if (seq === undefined) continue;
    const bucket = docsByContextSeq.get(seq) ?? [];
    bucket.push(doc);
    docsByContextSeq.set(seq, bucket);
  }

  for (const claim of claims) {
    for (const seq of claimDocumentSeqs(claim)) {
      for (const doc of docsByContextSeq.get(seq) ?? []) {
        push(doc.id, claim.id, "refers");
      }
    }
  }

  for (const doc of docs) {
    const rawClaimIds = doc.metadata?.claim_ids;
    const explicitIds = Array.isArray(rawClaimIds)
      ? rawClaimIds.filter((cid): cid is string => typeof cid === "string")
      : [];
    const poolIds =
      explicitIds.length > 0 ? explicitIds : claims.map((c) => c.id);
    if (poolIds.length > 0) {
      for (const cid of pickDocClaimIds(doc, claims, poolIds)) {
        push(doc.id, cid, "refers");
      }
    }
  }

  for (const contra of nodes.filter((n) => n.type === "contradiction")) {
    const meta = contra.metadata ?? {};
    const a = String(meta.claim_source_id ?? "");
    const b = String(meta.claim_target_id ?? "");
    if (a) push(contra.id, a, "contradicts");
    if (b && b !== a) push(contra.id, b, "contradicts");
    if (!a && !b) {
      for (const claimId of findRelatedNodeIds(
        claims,
        contra.content,
        2,
        0.35,
      )) {
        push(contra.id, claimId, "contradicts");
      }
    }
  }

  for (const risk of risks) {
    const related = findRelatedNodeIds(claims, risk.content, 2, 0.18);
    for (const claimId of related) {
      push(claimId, risk.id, "supports");
    }
  }

  for (const goal of goals) {
    const fromRisk = findRelatedNodeIds(risks, goal.content, 1, 0.18);
    if (fromRisk.length) {
      push(fromRisk[0], goal.id, "refers");
      continue;
    }
    const fromClaim = findRelatedNodeIds(claims, goal.content, 1, 0.18);
    for (const claimId of fromClaim) {
      push(claimId, goal.id, "supports");
    }
  }

  for (const res of nodes.filter((n) => n.type === "resolution")) {
    const meta = res.metadata ?? {};
    const srcRef = res.source_ref ?? {};
    const target = String(
      meta.targetsContradiction ?? srcRef.contradiction_id ?? "",
    );
    if (target) push(res.id, target, "resolves");
  }

  return out;
}
