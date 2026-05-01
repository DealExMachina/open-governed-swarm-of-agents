/**
 * HTTP control plane (default port 3006): tenants, scopes, runtime, metrics, SSE.
 */
import "dotenv/config";
import { createHash, randomBytes, randomUUID } from "crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { getPool } from "./db.js";
import { toErrorString } from "./errors.js";
import { getHatcheryInstance } from "./hatchery.js";
import { makeS3, s3GetText, s3PutText } from "./s3.js";
import { appendEvent } from "./contextWal.js";
import { createSwarmEvent } from "./events.js";
import { makeEventBus, type EventBus } from "./eventBus.js";
import { resetScopeData } from "./scopeReset.js";
import { buildScopeSummaryForScope } from "./feed.js";
import { pathToFileURL } from "url";
import { setActiveBillingContext } from "./billingContext.js";

/** Default avoids Grafana host port 3004 in docker-compose.yml. */
const PORT = parseInt(process.env.CONTROL_PLANE_PORT ?? "3006", 10);
const NATS_STREAM = process.env.NATS_STREAM ?? "SWARM_JOBS";
const ADMIN_TOKEN = process.env.SWARM_ADMIN_TOKEN ?? "";
const S3_BUCKET = process.env.S3_BUCKET ?? "";

let _cpBus: EventBus | null = null;

async function getCpBus(): Promise<EventBus> {
  if (!_cpBus) {
    _cpBus = await makeEventBus();
    await _cpBus.ensureStream(NATS_STREAM, ["swarm.events.>"]);
  }
  return _cpBus;
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = `sw_${randomBytes(24).toString("base64url")}`;
  const prefix = raw.slice(0, 12);
  return { raw, prefix, hash: hashApiKey(raw) };
}

function newScopeId(): string {
  return `scp_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function sendJson(res: ServerResponse, status: number, data: Record<string, unknown>): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function getPathname(url: string): string {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url.split("?")[0] ?? "/";
  }
}

function getQuery(url: string): Record<string, string> {
  try {
    const u = new URL(url, "http://localhost");
    const out: Record<string, string> = {};
    u.searchParams.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  } catch {
    return {};
  }
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function bearerToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7).trim() || null;
}

async function resolveTenantId(token: string): Promise<string | null> {
  const h = hashApiKey(token);
  try {
    const r = await getPool().query<{ tenant_id: string }>(
      `SELECT tenant_id::text AS tenant_id FROM tenant_api_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
      [h],
    );
    return r.rows[0]?.tenant_id ?? null;
  } catch {
    return null;
  }
}

function requireAdmin(req: IncomingMessage, res: ServerResponse): boolean {
  if (!ADMIN_TOKEN) {
    sendJson(res, 503, { error: "admin_token_not_configured" });
    return false;
  }
  const t = bearerToken(req);
  if (!t || t !== ADMIN_TOKEN) {
    sendJson(res, 401, { error: "unauthorized" });
    return false;
  }
  return true;
}

async function requireTenant(req: IncomingMessage, res: ServerResponse): Promise<string | null> {
  const t = bearerToken(req);
  if (!t) {
    sendJson(res, 401, { error: "missing_bearer" });
    return null;
  }
  const tenantId = await resolveTenantId(t);
  if (!tenantId) {
    sendJson(res, 401, { error: "invalid_api_key" });
    return null;
  }
  return tenantId;
}

async function loadScopeForTenant(
  scopeId: string,
  tenantId: string,
): Promise<{ id: string; tenant_id: string; storage_prefix: string; slug: string } | null> {
  const r = await getPool().query(
    `SELECT id, tenant_id::text AS tenant_id, storage_prefix, slug FROM scopes WHERE id = $1 AND tenant_id = $2::uuid`,
    [scopeId, tenantId],
  );
  return (r.rows[0] as { id: string; tenant_id: string; storage_prefix: string; slug: string }) ?? null;
}

async function updateRuntimeLease(scopeId: string | null, tenantId: string | null, paused: boolean): Promise<void> {
  try {
    await getPool().query(
      `UPDATE cluster_runtime_lease SET
        active_scope_id = $1,
        active_tenant_id = $2::uuid,
        paused = $3,
        updated_at = now()
       WHERE id = 1`,
      [scopeId, tenantId, paused],
    );
  } catch {
    //
  }
}

async function loadRuntimeLease(): Promise<{
  active_scope_id: string | null;
  active_tenant_id: string | null;
  paused: boolean;
} | null> {
  try {
    const r = await getPool().query(
      `SELECT active_scope_id, active_tenant_id::text AS active_tenant_id, paused FROM cluster_runtime_lease WHERE id = 1`,
    );
    return r.rows[0] as {
      active_scope_id: string | null;
      active_tenant_id: string | null;
      paused: boolean;
    };
  } catch {
    return null;
  }
}

async function scopeMetrics(
  scopeId: string,
  fromIso: string | undefined,
  toIso: string | undefined,
): Promise<Record<string, unknown>> {
  const from = fromIso ? new Date(fromIso) : new Date(Date.now() - 86400000);
  const to = toIso ? new Date(toIso) : new Date();
  let tokens = { input_tokens: 0, output_tokens: 0, llm_event_rows: 0 };
  try {
    const r = await getPool().query(
      `SELECT COALESCE(SUM(input_tokens),0)::bigint AS i, COALESCE(SUM(output_tokens),0)::bigint AS o, COUNT(*)::int AS c
       FROM usage_events WHERE scope_id = $1 AND ts >= $2 AND ts <= $3`,
      [scopeId, from.toISOString(), to.toISOString()],
    );
    tokens = {
      input_tokens: Number(r.rows[0]?.i ?? 0),
      output_tokens: Number(r.rows[0]?.o ?? 0),
      llm_event_rows: Number(r.rows[0]?.c ?? 0),
    };
  } catch {
    //
  }
  let convergence_delta: Record<string, unknown> | null = null;
  try {
    const h = await getPool().query(
      `SELECT epoch, goal_score, lyapunov_v FROM convergence_history
       WHERE scope_id = $1 ORDER BY epoch DESC LIMIT 2`,
      [scopeId],
    );
    if (h.rows.length >= 2) {
      const a = h.rows[0] as { goal_score: number; lyapunov_v: number; epoch: number };
      const b = h.rows[1] as { goal_score: number; lyapunov_v: number; epoch: number };
      convergence_delta = {
        latest_epoch: a.epoch,
        goal_score_delta: Number(a.goal_score) - Number(b.goal_score),
        lyapunov_delta: Number(a.lyapunov_v) - Number(b.lyapunov_v),
      };
    } else if (h.rows.length === 1) {
      const a = h.rows[0] as { goal_score: number; lyapunov_v: number; epoch: number };
      convergence_delta = { latest_epoch: a.epoch, goal_score_delta: null, lyapunov_delta: null };
    }
  } catch {
    //
  }
  const lease = await loadRuntimeLease();
  const hatchery = getHatcheryInstance();
  return {
    scope_id: scopeId,
    period: { from: from.toISOString(), to: to.toISOString() },
    tokens,
    convergence_delta,
    hatchery: hatchery ? hatchery.getSnapshot() : null,
    lease,
  };
}

async function handleScopeEventsSse(req: IncomingMessage, res: ServerResponse, scopeId: string, tenantId: string): Promise<void> {
  const bus = await getCpBus();
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  const socket = res.socket;
  if (socket) socket.setNoDelay(true);

  res.write(`data: ${JSON.stringify({ type: "control_plane_connected", scope_id: scopeId })}\n\n`);

  const sub = await bus.subscribeEphemeral(NATS_STREAM, "swarm.events.>", async (msg) => {
    if (res.writableEnded) return;
    const d = msg.data as Record<string, unknown>;
    const evScope = String(d.scope_id ?? (d.payload as Record<string, unknown> | undefined)?.scope_id ?? "");
    const evTenant = String(d.tenant_id ?? "");
    if (evScope && evScope !== scopeId) return;
    if (evTenant && evTenant !== tenantId) return;
    res.write(`id: ${msg.id}\ndata: ${JSON.stringify(d)}\n\n`);
  });

  req.on("close", () => {
    void sub.unsubscribe();
  });
}

/** Start listening; idempotent if server already started. */
let _server: ReturnType<typeof createServer> | null = null;

export function startControlPlaneServer(): void {
  if (_server) return;
  _server = createServer((req, res) => {
    void handleControlRequest(req, res);
  });
  _server.listen(PORT, "0.0.0.0", () => {
    process.stdout.write(
      JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "control_plane_listening", port: PORT }) + "\n",
    );
  });
}

async function handleControlRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? "/";
  const pathname = getPathname(url);
  const parts = pathname.split("/").filter(Boolean);
  const q = getQuery(url);

  try {
    if (req.method === "GET" && pathname === "/v1/health") {
      sendJson(res, 200, { ok: true, service: "control-plane" });
      return;
    }

    if (req.method === "POST" && pathname === "/v1/tenants") {
      if (!requireAdmin(req, res)) return;
      const body = await readJsonBody(req);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) {
        sendJson(res, 400, { error: "name_required" });
        return;
      }
      const { raw, prefix, hash } = generateApiKey();
      const pool = getPool();
      const t = await pool.query(`INSERT INTO tenants (name) VALUES ($1) RETURNING id::text`, [name]);
      const tenantId = t.rows[0].id as string;
      await pool.query(
        `INSERT INTO tenant_api_keys (tenant_id, key_hash, key_prefix) VALUES ($1::uuid, $2, $3)`,
        [tenantId, hash, prefix],
      );
      sendJson(res, 201, {
        tenant_id: tenantId,
        api_key: raw,
        key_prefix: prefix,
        message: "Store api_key securely; shown only once.",
      });
      return;
    }

    if (req.method === "GET" && pathname === "/v1/scopes") {
      const tenantId = await requireTenant(req, res);
      if (!tenantId) return;
      const r = await getPool().query(
        `SELECT id, slug, display_name, status, storage_prefix, created_at FROM scopes WHERE tenant_id = $1::uuid ORDER BY created_at DESC`,
        [tenantId],
      );
      sendJson(res, 200, { scopes: r.rows });
      return;
    }

    if (req.method === "POST" && pathname === "/v1/scopes") {
      const tenantId = await requireTenant(req, res);
      if (!tenantId) return;
      const body = await readJsonBody(req);
      const slug = typeof body.slug === "string" ? body.slug.trim().replace(/\s+/g, "-") : "";
      if (!slug) {
        sendJson(res, 400, { error: "slug_required" });
        return;
      }
      const displayName = typeof body.display_name === "string" ? body.display_name : slug;
      const id = newScopeId();
      const storagePrefix = `tenants/${tenantId}/scopes/${id}`;
      await getPool().query(
        `INSERT INTO scopes (id, tenant_id, slug, display_name, storage_prefix) VALUES ($1, $2::uuid, $3, $4, $5)`,
        [id, tenantId, slug, displayName, storagePrefix],
      );
      sendJson(res, 201, {
        scope: { id, slug, display_name: displayName, storage_prefix: storagePrefix, tenant_id: tenantId },
      });
      return;
    }

    if (
      parts.length === 4 &&
      parts[0] === "v1" &&
      parts[1] === "scopes" &&
      parts[3] === "documents" &&
      req.method === "POST"
    ) {
      const scopeId = parts[2]!;
      const tenantId = await requireTenant(req, res);
      if (!tenantId) return;
      const row = await loadScopeForTenant(scopeId, tenantId);
      if (!row) {
        sendJson(res, 404, { error: "scope_not_found" });
        return;
      }
      const body = await readJsonBody(req);
      const title = typeof body.title === "string" ? body.title : "doc";
      const text = typeof body.body === "string" ? body.body : typeof body.text === "string" ? body.text : "";
      if (!text) {
        sendJson(res, 400, { error: "body_or_text_required" });
        return;
      }
      if (!S3_BUCKET) {
        sendJson(res, 503, { error: "s3_not_configured" });
        return;
      }
      const docKey = `docs/${Date.now()}_${randomUUID().slice(0, 8)}.txt`;
      const objectKey = `${row.storage_prefix.replace(/\/$/, "")}/${docKey}`;
      const s3 = makeS3();
      await s3PutText(s3, S3_BUCKET, objectKey, text);
      await getPool().query(
        `INSERT INTO scope_documents (scope_id, object_key, title, meta)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (scope_id, object_key) DO UPDATE SET title = EXCLUDED.title`,
        [scopeId, objectKey, title, JSON.stringify({ uploaded_at: new Date().toISOString() })],
      );
      sendJson(res, 201, { ok: true, object_key: objectKey, title });
      return;
    }

    if (parts.length === 4 && parts[0] === "v1" && parts[1] === "scopes" && parts[3] === "ingest" && req.method === "POST") {
      const scopeId = parts[2]!;
      const tenantId = await requireTenant(req, res);
      if (!tenantId) return;
      const row = await loadScopeForTenant(scopeId, tenantId);
      if (!row) {
        sendJson(res, 404, { error: "scope_not_found" });
        return;
      }
      if (!S3_BUCKET) {
        sendJson(res, 503, { error: "s3_not_configured" });
        return;
      }
      const body = await readJsonBody(req);
      const keys = Array.isArray(body.object_keys) ? body.object_keys.map(String) : [];
      if (keys.length === 0) {
        sendJson(res, 400, { error: "object_keys_required" });
        return;
      }
      setActiveBillingContext(tenantId, scopeId);
      const bus = await getCpBus();
      const s3 = makeS3();
      const published: string[] = [];
      for (const objectKey of keys) {
        const txt = await s3GetText(s3, S3_BUCKET, objectKey);
        if (!txt) continue;
        const title = objectKey.split("/").pop() ?? "doc";
        const event = createSwarmEvent(
          "context_doc",
          { title, text: txt, source: "control_plane", scope_id: scopeId },
          { source: "control_plane", tenant_id: tenantId, scope_id: scopeId },
        );
        await appendEvent(event as unknown as Record<string, unknown>);
        await bus.publishEvent(event);
        await getPool().query(
          `UPDATE scope_documents SET ingested_at = now() WHERE scope_id = $1 AND object_key = $2`,
          [scopeId, objectKey],
        );
        published.push(objectKey);
      }
      sendJson(res, 200, { ok: true, ingested: published.length, object_keys: published });
      return;
    }

    if (parts.length === 4 && parts[0] === "v1" && parts[1] === "scopes" && parts[3] === "summary" && req.method === "GET") {
      const scopeId = parts[2]!;
      const tenantId = await requireTenant(req, res);
      if (!tenantId) return;
      const row = await loadScopeForTenant(scopeId, tenantId);
      if (!row) {
        sendJson(res, 404, { error: "scope_not_found" });
        return;
      }
      const summary = await buildScopeSummaryForScope(scopeId);
      sendJson(res, 200, summary as unknown as Record<string, unknown>);
      return;
    }

    if (parts.length === 4 && parts[0] === "v1" && parts[1] === "scopes" && parts[3] === "metrics" && req.method === "GET") {
      const scopeId = parts[2]!;
      const tenantId = await requireTenant(req, res);
      if (!tenantId) return;
      const row = await loadScopeForTenant(scopeId, tenantId);
      if (!row) {
        sendJson(res, 404, { error: "scope_not_found" });
        return;
      }
      const m = await scopeMetrics(scopeId, q.from, q.to);
      sendJson(res, 200, m);
      return;
    }

    if (parts.length === 4 && parts[0] === "v1" && parts[1] === "scopes" && parts[3] === "events" && req.method === "GET") {
      const scopeId = parts[2]!;
      const tenantId = await requireTenant(req, res);
      if (!tenantId) return;
      const row = await loadScopeForTenant(scopeId, tenantId);
      if (!row) {
        sendJson(res, 404, { error: "scope_not_found" });
        return;
      }
      await handleScopeEventsSse(req, res, scopeId, tenantId);
      return;
    }

    if (parts.length === 4 && parts[0] === "v1" && parts[1] === "scopes" && parts[3] === "reset" && req.method === "POST") {
      const scopeId = parts[2]!;
      const tenantId = await requireTenant(req, res);
      if (!tenantId) return;
      const row = await loadScopeForTenant(scopeId, tenantId);
      if (!row) {
        sendJson(res, 404, { error: "scope_not_found" });
        return;
      }
      const hatchery = getHatcheryInstance();
      if (hatchery?.getActiveScopeId() === scopeId) {
        sendJson(res, 409, { error: "scope_active_stop_runtime_first" });
        return;
      }
      const s3 = S3_BUCKET ? makeS3() : undefined;
      await resetScopeData(getPool(), scopeId, {
        s3,
        bucket: S3_BUCKET || undefined,
        storagePrefix: row.storage_prefix,
      });
      sendJson(res, 200, { ok: true, scope_id: scopeId });
      return;
    }

    if (req.method === "POST" && pathname === "/v1/runtime/start") {
      const tenantId = await requireTenant(req, res);
      if (!tenantId) return;
      const body = await readJsonBody(req);
      const scopeId = typeof body.scope_id === "string" ? body.scope_id : "";
      if (!scopeId) {
        sendJson(res, 400, { error: "scope_required" });
        return;
      }
      const row = await loadScopeForTenant(scopeId, tenantId);
      if (!row) {
        sendJson(res, 404, { error: "scope_not_found" });
        return;
      }
      const hatchery = getHatcheryInstance();
      if (!hatchery) {
        sendJson(res, 503, { error: "hatchery_not_in_process", hint: "Run swarm with ROLE=hatchery in the same process or wire RPC." });
        return;
      }
      const lease = await loadRuntimeLease();
      if (lease?.active_tenant_id && lease.active_tenant_id !== tenantId) {
        sendJson(res, 403, { error: "another_tenant_holds_cluster", active_tenant_id: lease.active_tenant_id });
        return;
      }
      setActiveBillingContext(tenantId, scopeId);
      await hatchery.rebindActiveScope(scopeId, tenantId);
      await updateRuntimeLease(scopeId, tenantId, false);
      await getPool().query(`UPDATE scopes SET status = 'active_processing', updated_at = now() WHERE id = $1`, [scopeId]);
      sendJson(res, 200, { ok: true, scope_id: scopeId, hatchery: hatchery.getSnapshot() });
      return;
    }

    if (req.method === "POST" && pathname === "/v1/runtime/pause") {
      const tenantId = await requireTenant(req, res);
      if (!tenantId) return;
      const hatchery = getHatcheryInstance();
      if (!hatchery) {
        sendJson(res, 503, { error: "hatchery_not_in_process" });
        return;
      }
      const lease = await loadRuntimeLease();
      if (lease?.active_tenant_id && lease.active_tenant_id !== tenantId) {
        sendJson(res, 403, { error: "not_lease_holder" });
        return;
      }
      await hatchery.pauseAll();
      await updateRuntimeLease(lease?.active_scope_id ?? null, lease?.active_tenant_id ?? null, true);
      sendJson(res, 200, { ok: true, hatchery: hatchery.getSnapshot() });
      return;
    }

    if (req.method === "POST" && pathname === "/v1/runtime/resume") {
      const tenantId = await requireTenant(req, res);
      if (!tenantId) return;
      const hatchery = getHatcheryInstance();
      if (!hatchery) {
        sendJson(res, 503, { error: "hatchery_not_in_process" });
        return;
      }
      const lease = await loadRuntimeLease();
      if (lease?.active_tenant_id && lease.active_tenant_id !== tenantId) {
        sendJson(res, 403, { error: "not_lease_holder" });
        return;
      }
      await hatchery.resume();
      await updateRuntimeLease(lease?.active_scope_id ?? null, lease?.active_tenant_id ?? null, false);
      sendJson(res, 200, { ok: true, hatchery: hatchery.getSnapshot() });
      return;
    }

    if (req.method === "POST" && pathname === "/v1/runtime/stop") {
      const tenantId = await requireTenant(req, res);
      if (!tenantId) return;
      const hatchery = getHatcheryInstance();
      if (!hatchery) {
        sendJson(res, 503, { error: "hatchery_not_in_process" });
        return;
      }
      const lease = await loadRuntimeLease();
      if (lease?.active_tenant_id && lease.active_tenant_id !== tenantId) {
        sendJson(res, 403, { error: "not_lease_holder" });
        return;
      }
      await hatchery.shutdown();
      await updateRuntimeLease(null, null, false);
      sendJson(res, 200, { ok: true, message: "hatchery_shutdown" });
      return;
    }

    if (req.method === "POST" && pathname === "/v1/runtime/restart") {
      const tenantId = await requireTenant(req, res);
      if (!tenantId) return;
      const body = await readJsonBody(req);
      const scopeId = typeof body.scope_id === "string" ? body.scope_id : "";
      if (!scopeId) {
        sendJson(res, 400, { error: "scope_required" });
        return;
      }
      const row = await loadScopeForTenant(scopeId, tenantId);
      if (!row) {
        sendJson(res, 404, { error: "scope_not_found" });
        return;
      }
      const hatchery = getHatcheryInstance();
      if (!hatchery) {
        sendJson(res, 503, { error: "hatchery_not_in_process" });
        return;
      }
      setActiveBillingContext(tenantId, scopeId);
      await hatchery.rebindActiveScope(scopeId, tenantId);
      await hatchery.resume();
      await updateRuntimeLease(scopeId, tenantId, false);
      sendJson(res, 200, { ok: true, scope_id: scopeId, hatchery: hatchery.getSnapshot() });
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  } catch (e) {
    sendJson(res, 500, { error: toErrorString(e) });
  }
}

const isDirectRun = (() => {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return pathToFileURL(argv1).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  startControlPlaneServer();
}
