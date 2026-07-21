import type { IncomingMessage, ServerResponse } from "http";
import { S3Client } from "@aws-sdk/client-s3";
import { startDemoSession, closeDemoSession } from "../../src/demoSessions.js";
import { resetScopeAndReinit } from "../../src/scopeReset.js";
import { scopeStoragePrefix } from "../../src/scopeStorage.js";
import { getPool } from "../../src/db.js";
import { requestRuntimeControl } from "../../src/runtimeControlRpc.js";
import {
  type DemoScenarioId,
  SCENARIO_SCOPES,
  isDemoScenarioId,
  scopeIdForScenario,
} from "../../src/scenarioScopes.js";
import { ensureScenarioCatalogScope } from "../../src/studioCatalog.js";
import { FEED_URL } from "./config.js";
import { authHeaders, readBody, sendJson, proxyGet, proxyPost } from "./http.js";
import { SCENARIOS } from "./scenarios.js";
import { demoState } from "./state.js";
import { sseClients } from "./sse.js";

export function getActiveScopeOrThrow(): string {
  if (!demoState.activeScopeId) {
    throw new Error("scope_not_initialized");
  }
  return demoState.activeScopeId;
}

export async function bindHatcheryToScope(
  scopeId: string,
): Promise<{ ok: boolean; error?: string }> {
  const rpc = await requestRuntimeControl({
    action: "start",
    scope_id: scopeId,
    tenant_id: null,
  });
  return { ok: rpc.ok, error: rpc.ok ? undefined : rpc.error };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/** GET /api/scenarios — list available scenarios (each with its Studio catalog scope). */
export function handleScenarios(res: ServerResponse): void {
  sendJson(
    res,
    200,
    Object.values(SCENARIOS).map(({ meta }) => {
      const scopeDef = isDemoScenarioId(meta.id)
        ? SCENARIO_SCOPES[meta.id as DemoScenarioId]
        : null;
      return {
        ...meta,
        scope_id: scopeDef?.scopeId ?? scopeIdForScenario(meta.id),
        scope_name: scopeDef?.name,
      };
    }),
  );
}

/** GET /api/status — feed readiness + active demo session scope (no graph read). */
export async function handleStatus(res: ServerResponse): Promise<void> {
  let feedOk = false;
  try {
    const r = await fetch(`${FEED_URL}/health`, { headers: authHeaders() });
    feedOk = r.ok;
  } catch {
    feedOk = false;
  }
  sendJson(res, 200, {
    feed_ok: feedOk,
    scenario_id: demoState.activeScenarioId,
    scope_id: demoState.activeScopeId,
  });
}

/** POST /api/select-scenario — switch to a different scenario. Resets scope state first so facts from other demos are not mixed in. */
export async function handleSelectScenario(body: string, res: ServerResponse): Promise<void> {
  try {
    const { id } = JSON.parse(body) as { id: string };
    const scenario = SCENARIOS[id];
    if (!scenario) {
      sendJson(res, 404, { error: `Unknown scenario: ${id}` });
      return;
    }
    if (demoState.activeSessionId) {
      await closeDemoSession(demoState.activeSessionId).catch(() => {});
      demoState.activeSessionId = null;
    }
    const targetScopeId = scopeIdForScenario(id);
    const resetErrors = await resetScopeState(targetScopeId);
    if (resetErrors.length > 0) {
      sendJson(res, 500, { error: "scenario_reset_failed", details: resetErrors });
      return;
    }
    const session = await startDemoSession(id, targetScopeId);
    demoState.activeScenarioId = id;
    demoState.activeDocs = scenario.docs;
    demoState.activeSessionId = session.session_id;
    demoState.activeScopeId = session.scope_id;
    // Bind hatchery to the demo runtime scope so graph builds here (not a leftover Studio scope).
    const rpc = await bindHatcheryToScope(session.scope_id);
    sendJson(res, 200, {
      ok: true,
      scenario: scenario.meta,
      session_id: session.session_id,
      scope_id: session.scope_id,
      hatchery_bound: rpc.ok,
      hatchery_error: rpc.ok ? undefined : rpc.error,
    });
  } catch (e) {
    sendJson(res, 400, { error: String(e) });
  }
}

/** POST /api/demo-session/start — explicitly create a new demo session for a scenario */
export async function handleDemoSessionStart(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw || "{}") as { scenario_id?: string };
    const scenarioId = String(body.scenario_id ?? "").trim();
    const scenario = SCENARIOS[scenarioId];
    if (!scenario) {
      sendJson(res, 404, { error: `Unknown scenario: ${scenarioId}` });
      return;
    }
    if (demoState.activeSessionId) {
      await closeDemoSession(demoState.activeSessionId).catch(() => {});
      demoState.activeSessionId = null;
    }
    const targetScopeId = scopeIdForScenario(scenarioId);
    const resetErrors = await resetScopeState(targetScopeId);
    if (resetErrors.length > 0) {
      sendJson(res, 500, { error: "scenario_reset_failed", details: resetErrors });
      return;
    }
    const session = await startDemoSession(scenarioId, targetScopeId);
    demoState.activeScenarioId = scenarioId;
    demoState.activeDocs = scenario.docs;
    demoState.activeSessionId = session.session_id;
    demoState.activeScopeId = session.scope_id;
    const rpc = await bindHatcheryToScope(session.scope_id);
    sendJson(res, 200, {
      ok: true,
      session_id: session.session_id,
      scope_id: session.scope_id,
      scenario: scenario.meta,
      hatchery_bound: rpc.ok,
      hatchery_error: rpc.ok ? undefined : rpc.error,
    });
  } catch (e) {
    sendJson(res, 400, { error: String(e) });
  }
}

/** POST /api/demo-session/close — close current demo session */
export async function handleDemoSessionClose(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw || "{}") as { session_id?: string };
    const sid = String(body.session_id ?? demoState.activeSessionId ?? "").trim();
    if (!sid) {
      sendJson(res, 400, { error: "session_id_required" });
      return;
    }
    const ok = await closeDemoSession(sid);
    if (demoState.activeSessionId === sid) {
      demoState.activeSessionId = null;
      demoState.activeScopeId = null;
      demoState.fedSteps.clear();
    }
    sendJson(res, 200, { ok });
  } catch (e) {
    sendJson(res, 400, { error: String(e) });
  }
}

/** GET /api/docs — return document metadata (not body) */
export function handleDocs(res: ServerResponse): void {
  sendJson(
    res,
    200,
    demoState.activeDocs.map(({ index, filename, title, excerpt }) => ({
      index,
      filename,
      title,
      excerpt,
    })),
  );
}

/** POST /api/step/:n — feed document n to the swarm feed server */
export async function handleStep(n: number, res: ServerResponse): Promise<void> {
  if (demoState.fedSteps.has(n)) {
    sendJson(res, 200, { ok: true, already_fed: true, doc: { index: n, title: demoState.activeDocs[n]?.title } });
    return;
  }
  const doc = demoState.activeDocs[n];
  if (!doc) {
    sendJson(res, 404, { error: `No document at index ${n}` });
    return;
  }
  try {
    const scopeId = getActiveScopeOrThrow();
    const result = await proxyPost(`${FEED_URL}/context/docs`, {
      scope_id: scopeId,
      title: doc.title,
      body: doc.body,
    });
    demoState.fedSteps.add(n);
    sendJson(res, 200, { ok: true, doc: { index: n, title: doc.title }, feed: result });
  } catch (e) {
    sendJson(res, 502, { error: String(e) });
  }
}

/** POST /api/run-all — feed all scenario documents at once for concurrent processing */
export async function handleRunAll(res: ServerResponse): Promise<void> {
  const scopeId = getActiveScopeOrThrow();
  const results: Array<{ index: number; title: string; ok: boolean; error?: string }> = [];
  for (const doc of demoState.activeDocs) {
    if (demoState.fedSteps.has(doc.index)) {
      results.push({ index: doc.index, title: doc.title, ok: true });
      continue;
    }
    try {
      await proxyPost(`${FEED_URL}/context/docs`, { scope_id: scopeId, title: doc.title, body: doc.body });
      demoState.fedSteps.add(doc.index);
      results.push({ index: doc.index, title: doc.title, ok: true });
    } catch (e) {
      results.push({ index: doc.index, title: doc.title, ok: false, error: String(e) });
    }
  }
  sendJson(res, 200, { ok: true, fed: results.length, results });
}

/** GET /api/summary — proxy to feed server */
export async function handleSummary(res: ServerResponse): Promise<void> {
  try {
    const scopeId = getActiveScopeOrThrow();
    const data = await proxyGet(`${FEED_URL}/summary?raw=1&scope_id=${encodeURIComponent(scopeId)}`);
    sendJson(res, 200, data as Record<string, unknown>);
  } catch {
    sendJson(res, 502, { error: "feed_unavailable" });
  }
}

/** GET /api/situation — watchdog situation summary with ranked questions */
export async function handleSituation(res: ServerResponse): Promise<void> {
  try {
    const { buildSituationSummary } = await import("../src/watchdog.js");
    const scopeId = getActiveScopeOrThrow();
    const situation = await buildSituationSummary(scopeId);
    sendJson(res, 200, situation);
  } catch (e) {
    sendJson(res, 500, { error: String(e) });
  }
}

/** GET /api/knowledge — canonical knowledge state from semantic graph (single source of truth) */
export async function handleKnowledge(res: ServerResponse): Promise<void> {
  try {
    const { getKnowledgeState } = await import("../src/semanticGraph.js");
    const scopeId = getActiveScopeOrThrow();
    const knowledge = await getKnowledgeState(scopeId);
    sendJson(res, 200, knowledge);
  } catch (e) {
    sendJson(res, 200, { counts: { claims: 0, goals: 0, contradictions: 0, risks: 0, contradictions_resolved: 0 }, claims: [], goals: [], contradictions: [], risks: [] });
  }
}

/** GET /api/contradictions — unresolved contradictions with sides for HITL */
export async function handleContradictions(res: ServerResponse): Promise<void> {
  try {
    const { loadUnresolvedContradictionDetails } = await import("../src/semanticGraph.js");
    const scopeId = getActiveScopeOrThrow();
    const details = await loadUnresolvedContradictionDetails(scopeId);
    sendJson(res, 200, { contradictions: details });
  } catch (e) {
    sendJson(res, 200, { contradictions: [] });
  }
}

/** GET /api/pending — proxy to MITL server */
export async function handlePending(res: ServerResponse): Promise<void> {
  try {
    const scopeId = getActiveScopeOrThrow();
    const data = await proxyGet(`${MITL_URL}/pending?scope_id=${encodeURIComponent(scopeId)}`);
    sendJson(res, 200, data as Record<string, unknown>);
  } catch {
    sendJson(res, 200, { pending: [] });
  }
}

/** POST /api/finality-response — proxy to feed server */
export async function handleFinalityResponse(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw) as Record<string, unknown>;
    const scopeId = getActiveScopeOrThrow();
    const data = await proxyPost(`${FEED_URL}/finality-response`, { ...body, scope_id: scopeId });
    sendJson(res, 200, data as Record<string, unknown>);
  } catch (e) {
    sendJson(res, 502, { error: String(e) });
  }
}

/** POST /api/resolution — proxy to feed /context/resolution */
export async function handleResolution(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw) as Record<string, unknown>;
    const scopeId = getActiveScopeOrThrow();
    const decision = typeof body.decision === "string" ? body.decision : typeof body.text === "string" ? body.text : "";
    const nodeIds = Array.isArray(body.node_ids) ? (body.node_ids as string[]) : [];

    // Fire-and-forget to feed so it records the event in the WAL and triggers the pipeline
    proxyPost(`${FEED_URL}/context/resolution`, { ...body, scope_id: scopeId }).catch(() => {});

    // Call the resolution MCP directly to get LLM evaluation results back to the UI.
    // When node_ids are provided (from the contradiction HITL modal), pass them so the
    // MCP evaluates against those specific contradictions even if the resolver agent
    // already marked them resolved in the background (race condition protection).
    const mcpPort = process.env.RESOLUTION_MCP_PORT ?? "3006";
    let evaluation: Record<string, unknown> = {};
    try {
      if (nodeIds.length > 0 && !decision.trim()) {
        // Explicit A/B choice with no free-text — mark directly
        const resolved: string[] = [];
        for (const nodeId of nodeIds) {
          const r = await fetch(`http://127.0.0.1:${mcpPort}/mark-resolved`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scope_id: scopeId, node_id: nodeId, judgment: "resolved", reason: "HITL resolution (Choose A/B)" }),
          });
          if (r.ok) resolved.push(nodeId);
        }
        evaluation = { method: "explicit_node_ids", marked: resolved };
      } else if (decision.trim()) {
        // Free-text resolution — use LLM evaluation, passing node_ids if available
        const payload: Record<string, unknown> = { scope_id: scopeId, resolution_text: decision.trim() };
        if (nodeIds.length > 0) payload.node_ids = nodeIds;
        const r = await fetch(`http://127.0.0.1:${mcpPort}/mark-resolved-by-text`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (r.ok) evaluation = await r.json() as Record<string, unknown>;
      }
    } catch (e) {
      evaluation = { error: String(e) };
    }

    sendJson(res, 200, { ok: true, evaluation });
  } catch (e) {
    sendJson(res, 502, { error: String(e) });
  }
}

/**
 * Clear persisted state for one scenario catalog scope (graph + catalog badge).
 * Used by reset and select-scenario so each demo scenario stays isolated.
 */
export async function ensureDemoScopeCatalog(scopeId: string): Promise<void> {
  const def = Object.values(SCENARIO_SCOPES).find((s) => s.scopeId === scopeId);
  if (!def) return;
  await ensureScenarioCatalogScope({
    id: def.scopeId,
    name: def.name,
    tag: def.tag,
  });
}

export async function resetScopeState(scopeIdOverride?: string): Promise<string[]> {
  const errors: string[] = [];
  const scopeId =
    scopeIdOverride ??
    demoState.activeScopeId ??
    (demoState.activeScenarioId ? scopeIdForScenario(demoState.activeScenarioId) : null);

  if (!scopeId) {
    errors.push("scope_not_selected");
    return errors;
  }

  try {
    await ensureDemoScopeCatalog(scopeId);
  } catch (e) {
    errors.push(`catalog: ${e}`);
  }

  const s3Endpoint = process.env.S3_ENDPOINT;
  const s3Bucket = process.env.S3_BUCKET ?? "swarm";
  let s3: S3Client | undefined;
  if (s3Endpoint) {
    s3 = new S3Client({
      region: process.env.S3_REGION || "us-east-1",
      endpoint: s3Endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? "minioadmin",
        secretAccessKey: process.env.S3_SECRET_KEY ?? "minioadmin",
      },
    });
  }

  try {
    const pool = getPool();
    await resetScopeAndReinit(pool, scopeId, {
      s3,
      bucket: s3 ? s3Bucket : undefined,
      storagePrefix: scopeStoragePrefix(scopeId),
    });
  } catch (e) {
    errors.push(`db: ${e}`);
  } finally {
    s3?.destroy();
  }

  demoState.fedSteps.clear();
  return errors;
}

/** POST /api/reset — clear swarm state for the active scenario scope and re-bind hatchery */
export async function handleReset(res: ServerResponse): Promise<void> {
  if (!demoState.activeScopeId || !demoState.activeScenarioId) {
    sendJson(res, 400, { error: "scenario_not_selected" });
    return;
  }
  const errors = await resetScopeState();
  const scopeId = demoState.activeScopeId;
  const rpc = await bindHatcheryToScope(scopeId);
  sendJson(res, 200, {
    ok: true,
    scope_id: scopeId,
    hatchery_bound: rpc.ok,
    hatchery_error: rpc.ok ? undefined : rpc.error,
    errors: errors.length ? errors : undefined,
  });
}

/** GET /api/events — SSE stream proxied from feed server */
export function handleEvents(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  res.write(
    `data: ${JSON.stringify({ type: "demo_connected", ts: new Date().toISOString() })}\n\n`,
  );

  sseClients.add(res);
  const keepalive = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(keepalive);
      sseClients.delete(res);
      return;
    }
    res.write(": keepalive\n\n");
  }, 20000);

  req.on("close", () => {
    clearInterval(keepalive);
    sseClients.delete(res);
  });
}
