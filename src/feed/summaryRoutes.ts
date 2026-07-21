import type { IncomingMessage, ServerResponse } from "http";
import { toErrorString } from "../errors.js";
import { loadFinalityConfig } from "../finalityEvaluator.js";
import { getConvergenceState } from "../convergenceTracker.js";
import { getQuery, sendJson } from "./http.js";
import { readScopeIdFromRequest, validateScopeAccess } from "./scope.js";
import { buildScopeSummaryForScope } from "./summary.js";
import { RUNTIME_SCOPE_ID } from "./config.js";

export async function handleSummary(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const scopeId = readScopeIdFromRequest(req);
    if (!scopeId) {
      sendJson(res, 400, { error: "scope_required" });
      return;
    }
    const valid = await validateScopeAccess(scopeId);
    if (!valid.ok) {
      sendJson(res, valid.status, {
        error: valid.error,
        runtime_scope_id: RUNTIME_SCOPE_ID,
      });
      return;
    }
    const summary = await buildScopeSummaryForScope(scopeId);
    sendJson(res, 200, summary);
  } catch (e) {
    sendJson(res, 500, { error: toErrorString(e) });
  }
}

/** GET /convergence?scope=<id>: full convergence state for a scope (debugging + benchmark). */
export async function handleConvergence(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const query = getQuery(req.url ?? "");
    const scopeId = query.scope ?? query.scope_id ?? "";
    if (!scopeId) {
      sendJson(res, 400, { error: "scope_required" });
      return;
    }
    const config = loadFinalityConfig();
    const convConfig = config.convergence ?? {};
    const auto = config.goal_gradient?.auto_finality_threshold ?? 0.92;
    const convState = await getConvergenceState(scopeId, convConfig, auto);
    sendJson(res, 200, {
      scope_id: scopeId,
      convergence_rate: convState.convergence_rate,
      estimated_rounds: convState.estimated_rounds,
      is_monotonic: convState.is_monotonic,
      is_plateaued: convState.is_plateaued,
      plateau_rounds: convState.plateau_rounds,
      highest_pressure_dimension: convState.highest_pressure_dimension,
      history: convState.history,
    });
  } catch (e) {
    sendJson(res, 500, { error: toErrorString(e) });
  }
}
