/**
 * SGRS Studio API sync — pushes governed facts and finality state to the Studio read model.
 *
 * Called after governance runs (writeFactsTool) and after each finality evaluation
 * (runFinalityCheck). This is the bridge between the swarm's semantic graph and the
 * Studio's Postgres read model.
 *
 * All functions are fire-and-forget. Errors are logged but never propagate to the
 * swarm — the governance pipeline must never fail because the Studio is unreachable.
 *
 * Configuration (env vars):
 *   SGRS_API_URL    — Studio REST API base URL   (default: http://localhost:3003)
 *   SGRS_API_TOKEN  — Bearer token               (default: empty, dev unauthenticated)
 *   SGRS_TENANT_ID  — X-Tenant-ID header         (default: deal-ex-machina demo org)
 *   SGRS_SCOPE_ID   — Scope to write into        (default: SCOPE_ID env var or "default")
 */

const SGRS_API_URL  = (process.env.SGRS_API_URL  ?? "http://localhost:3003").replace(/\/$/, "");
const SGRS_API_TOKEN = process.env.SGRS_API_TOKEN ?? "";
const SGRS_TENANT_ID = process.env.SGRS_TENANT_ID ?? "deal-ex-machina";
const SGRS_SCOPE_ID  = process.env.SGRS_SCOPE_ID  ?? process.env.SCOPE_ID ?? "default";

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function makeHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Tenant-ID": SGRS_TENANT_ID,
  };
  if (SGRS_API_TOKEN) h["Authorization"] = `Bearer ${SGRS_API_TOKEN}`;
  return h;
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${SGRS_API_URL}${path}`, {
    method: "POST",
    headers: makeHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
}

async function patch(path: string, body: unknown): Promise<Response> {
  return fetch(`${SGRS_API_URL}${path}`, {
    method: "PATCH",
    headers: makeHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
}

// ── Fact normalisers ──────────────────────────────────────────────────────────

/** Coerce a facts array entry to a plain string, regardless of payload shape. */
function toStr(item: unknown): string {
  if (typeof item === "string") return item.trim();
  if (item && typeof item === "object") {
    const o = item as Record<string, unknown>;
    return String(
      o["claim"] ?? o["risk"] ?? o["goal"] ?? o["assumption"] ??
      o["contradiction"] ?? o["text"] ?? o["content"] ?? ""
    ).trim();
  }
  return "";
}

function toList(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.map(toStr).filter(Boolean);
}

// ── Document sync ─────────────────────────────────────────────────────────────

/** Register a source document in the Studio. Returns the new document id, or null on error. */
export async function syncDocumentToSgrs(title: string, type = "txt"): Promise<string | null> {
  try {
    const res = await post("/api/documents", {
      scope_id: SGRS_SCOPE_ID,
      name: title,
      type,
      status: "processing",
    });
    if (!res.ok) return null;
    const body = await res.json() as { id?: string };
    return body.id ?? null;
  } catch {
    return null;
  }
}

/** Update a document's status and claim count after indexing. */
export async function patchDocumentInSgrs(
  docId: string,
  status: "indexed" | "failed",
  claimCount?: number,
): Promise<void> {
  try {
    await patch(`/api/documents/${docId}`, {
      status,
      ...(claimCount !== undefined ? { claim_count: claimCount } : {}),
    });
  } catch { /* non-critical */ }
}

// ── Facts sync ────────────────────────────────────────────────────────────────

export interface SyncFactsResult {
  document_id: string | null;
  claims_synced: number;
  contradictions_synced: number;
  risks_synced: number;
}

/**
 * Sync a full facts extraction result to the Studio read model.
 * Creates a document record then inserts claims, contradictions, and risks.
 * Called from factsAgent writeFactsTool AFTER syncFactsToSemanticGraph succeeds.
 */
export async function syncFactsToSgrs(
  docTitle: string,
  facts: Record<string, unknown>,
  round = 0,
  docType = "txt",
): Promise<SyncFactsResult> {
  const result: SyncFactsResult = {
    document_id: null,
    claims_synced: 0,
    contradictions_synced: 0,
    risks_synced: 0,
  };

  const confidence = typeof facts["confidence"] === "number" ? facts["confidence"] : 0.7;
  const claims        = toList(facts["claims"]);
  const contradictions = toList(facts["contradictions"]);
  const risks         = toList(facts["risks"]);

  // Register source document
  const docId = await syncDocumentToSgrs(docTitle, docType);
  result.document_id = docId;

  // Persist claims
  for (const text of claims) {
    try {
      const r = await post("/api/claims", {
        scope_id: SGRS_SCOPE_ID,
        text,
        source: docTitle,
        confidence,
        round,
      });
      if (r.ok) result.claims_synced++;
    } catch { /* non-critical */ }
  }

  // Persist contradictions — split "X vs Y" style strings into two sides
  for (const desc of contradictions) {
    try {
      const parts = desc.split(/ vs\.? | but | however /i);
      const claim_a = parts[0]?.trim() ?? desc;
      const claim_b = parts[1]?.trim() ?? `Alternative reading: ${desc}`;
      const severity =
        /critical|overstat/i.test(desc) ? "critical" :
        /high|significant/i.test(desc)  ? "high" : "medium";
      const r = await post("/api/contradictions", {
        scope_id: SGRS_SCOPE_ID,
        claim_a,
        claim_b,
        source_a: docTitle,
        source_b: docTitle,
        severity,
        round,
      });
      if (r.ok) result.contradictions_synced++;
    } catch { /* non-critical */ }
  }

  // Persist risks
  for (const description of risks) {
    try {
      const level =
        /critical|severe/i.test(description)   ? "critical" :
        /high|significant/i.test(description)  ? "high" :
        /low/i.test(description)               ? "low" : "medium";
      const r = await post("/api/risks", {
        scope_id: SGRS_SCOPE_ID,
        description,
        level,
        source: docTitle,
        round,
      });
      if (r.ok) result.risks_synced++;
    } catch { /* non-critical */ }
  }

  // Mark document as indexed with final claim count
  if (docId) {
    await patchDocumentInSgrs(docId, "indexed", result.claims_synced);
  }

  return result;
}

// ── Finality sync ─────────────────────────────────────────────────────────────

/**
 * Push the Lyapunov V(t) and finality gate state to the Studio.
 * Called from governanceAgent runFinalityCheck after evaluateFinality.
 * The Studio's ProgressCard reads this via GET /api/finality/:scopeId.
 */
/**
 * Push the Lyapunov V(t) and finality gate state to the Studio.
 * Called from governanceAgent runFinalityCheck after evaluateFinality.
 * The Studio's ProgressCard reads this via GET /api/finality/:scopeId.
 *
 * @param state  SGRS API state: "active" | "near-final" | "resolved" | "escalated" | "archived"
 *               Caller is responsible for normalising — use SGRS API conventions at the call site.
 */
export async function syncFinalityToSgrs(
  scopeId: string,
  score: number,
  state: string,
  perDimension: Record<string, number>,
  monotonicityRounds: number,
  plateauEma: number,
  convergenceRate: number,
  vetoActive: boolean,
): Promise<void> {
  try {
    const resp = await post(`/api/finality/${scopeId}`, {
      score,
      state,
      per_dimension: perDimension,
      monotonicity_rounds: monotonicityRounds,
      plateau_ema: plateauEma,
      convergence_rate: convergenceRate,
      veto_active: vetoActive,
    });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      throw new Error(`finality POST ${resp.status}: ${errBody}`);
    }
    // Mirror score+state onto the scope row so the Studio scope list stays current
    await patch(`/api/scopes/${scopeId}`, { score, state }).catch(() => {/* non-critical */});
  } catch (e) {
    // Log but never propagate — Studio unavailability must never block governance.
    const { logger } = await import("./logger.js");
    logger.warn("sgrsSync: finality POST failed", { scopeId, error: String(e) });
  }
}
