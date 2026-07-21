import type { IncomingMessage } from "http";
import { scopeIsKnown } from "../studioCatalog.js";
import { getQuery } from "./http.js";
import { ACCEPT_ANY_SCOPE, RUNTIME_SCOPE_ID } from "./config.js";

export function readScopeIdFromRequest(
  req: IncomingMessage,
  body?: Record<string, unknown>,
): string | null {
  const query = getQuery(req.url ?? "");
  const fromQuery = typeof query.scope_id === "string" ? query.scope_id : "";
  const fromBody = typeof body?.scope_id === "string" ? body.scope_id : "";
  const scopeId = (fromBody || fromQuery).trim();
  if (!scopeId) return null;
  return scopeId;
}

export async function validateScopeAccess(
  scopeId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!scopeId) return { ok: false, status: 400, error: "scope_required" };
  if (ACCEPT_ANY_SCOPE || scopeId === RUNTIME_SCOPE_ID) return { ok: true };
  if (await scopeIsKnown(scopeId)) return { ok: true };
  return { ok: false, status: 409, error: "unsupported_scope_for_runtime" };
}

export function validateScopedRequest(
  requestUrl: string | undefined,
  body: Record<string, unknown> | undefined,
  runtimeScopeId: string = RUNTIME_SCOPE_ID,
):
  | { ok: true; scopeId: string }
  | { ok: false; status: number; error: string } {
  const query = getQuery(requestUrl ?? "");
  const fromQuery = typeof query.scope_id === "string" ? query.scope_id : "";
  const fromBody = typeof body?.scope_id === "string" ? body.scope_id : "";
  const scopeId = (fromBody || fromQuery).trim();
  if (!scopeId) return { ok: false, status: 400, error: "scope_required" };
  if (scopeId !== runtimeScopeId) {
    return { ok: false, status: 409, error: "unsupported_scope_for_runtime" };
  }
  return { ok: true, scopeId };
}
