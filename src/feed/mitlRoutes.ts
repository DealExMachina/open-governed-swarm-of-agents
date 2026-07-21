import type { IncomingMessage, ServerResponse } from "http";
import { toErrorString } from "../errors.js";
import { readJsonBody, sendJson } from "./http.js";
import { readScopeIdFromRequest, validateScopeAccess } from "./scope.js";
import { MITL_URL, RUNTIME_SCOPE_ID } from "./config.js";

/** GET /pending: proxy to MITL server pending list (for finality reviews and other proposals). */
export async function handleGetPending(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const scopeId = readScopeIdFromRequest(req);
    if (!scopeId) {
      sendJson(res, 400, { error: "scope_required", pending: [] });
      return;
    }
    const valid = await validateScopeAccess(scopeId);
    if (!valid.ok) {
      sendJson(res, valid.status, {
        error: valid.error,
        pending: [],
        runtime_scope_id: RUNTIME_SCOPE_ID,
      });
      return;
    }
    const r = await fetch(
      `${MITL_URL}/pending?scope_id=${encodeURIComponent(scopeId)}`,
      { method: "GET" },
    );
    if (!r.ok) {
      sendJson(res, 502, { error: "mitl_unavailable", pending: [] });
      return;
    }
    const data = (await r.json()) as {
      pending?: Array<{
        proposal_id: string;
        proposal: Record<string, unknown>;
      }>;
    };
    sendJson(res, 200, { pending: data.pending ?? [] });
  } catch (e) {
    sendJson(res, 502, { error: toErrorString(e), pending: [] });
  }
}

/** POST /finality-response: proxy to MITL finality-response for a given proposal. Body: { proposal_id, option, days? }. */
export async function handleFinalityResponse(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const body = await readJsonBody(req);
    const scopeId = readScopeIdFromRequest(req, body);
    if (!scopeId) {
      sendJson(res, 400, { ok: false, error: "scope_required" });
      return;
    }
    const validScope = await validateScopeAccess(scopeId);
    if (!validScope.ok) {
      sendJson(res, validScope.status, {
        ok: false,
        error: validScope.error,
        runtime_scope_id: RUNTIME_SCOPE_ID,
      });
      return;
    }
    const proposalId =
      typeof body.proposal_id === "string" ? body.proposal_id : "";
    const option = body.option as string | undefined;
    const valid: string[] = [
      "approve_finality",
      "provide_resolution",
      "escalate",
      "defer",
    ];
    if (!proposalId || !option || !valid.includes(option)) {
      sendJson(res, 400, {
        ok: false,
        error:
          "proposal_id and option (one of: " + valid.join(", ") + ") required",
      });
      return;
    }
    const days =
      option === "defer" && body.days != null ? Number(body.days) : undefined;
    const r = await fetch(
      `${MITL_URL}/finality-response/${encodeURIComponent(proposalId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ option, days, scope_id: scopeId }),
      },
    );
    const data = (await r.json()) as { ok?: boolean; error?: string };
    sendJson(res, r.ok ? 200 : 404, data);
  } catch (e) {
    sendJson(res, 502, { ok: false, error: toErrorString(e) });
  }
}
