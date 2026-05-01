/**
 * Minimal HTTP client for the control plane API (/v1).
 * Mirrors routes in src/controlPlaneServer.ts and openapi/v1/openapi.yaml.
 */

export interface SwarmClientOptions {
  baseUrl: string;
  /** Tenant API key (Bearer) */
  apiKey: string;
  fetchImpl?: typeof fetch;
}

async function json<T>(
  url: string,
  opts: SwarmClientOptions,
  init?: RequestInit,
): Promise<T> {
  const f = opts.fetchImpl ?? fetch;
  const r = await f(`${opts.baseUrl.replace(/\/$/, "")}${url}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      ...(init?.headers as Record<string, string>),
    },
  });
  const text = await r.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  if (!r.ok) {
    throw new Error(`HTTP ${r.status}: ${text.slice(0, 500)}`);
  }
  return body as T;
}

export function createSwarmClient(opts: SwarmClientOptions) {
  const base = opts.baseUrl.replace(/\/$/, "");
  const f = opts.fetchImpl ?? fetch;
  return {
    health: async () => {
      const r = await f(`${base}/v1/health`);
      return (await r.json()) as { ok: boolean };
    },
    listScopes: () => json<{ scopes: unknown[] }>(`/v1/scopes`, opts),
    createScope: (slug: string, displayName?: string) =>
      json<{ scope: Record<string, unknown> }>(`/v1/scopes`, opts, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, display_name: displayName ?? slug }),
      }),
    addDocument: (scopeId: string, title: string, body: string) =>
      json<Record<string, unknown>>(`/v1/scopes/${encodeURIComponent(scopeId)}/documents`, opts, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      }),
    ingest: (scopeId: string, objectKeys: string[]) =>
      json<Record<string, unknown>>(`/v1/scopes/${encodeURIComponent(scopeId)}/ingest`, opts, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ object_keys: objectKeys }),
      }),
    summary: (scopeId: string) =>
      json<Record<string, unknown>>(`/v1/scopes/${encodeURIComponent(scopeId)}/summary`, opts),
    metrics: (scopeId: string, from?: string, to?: string) => {
      const q = new URLSearchParams();
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      const qs = q.toString();
      return json<Record<string, unknown>>(
        `/v1/scopes/${encodeURIComponent(scopeId)}/metrics${qs ? `?${qs}` : ""}`,
        opts,
      );
    },
    resetScope: (scopeId: string) =>
      json<Record<string, unknown>>(`/v1/scopes/${encodeURIComponent(scopeId)}/reset`, opts, {
        method: "POST",
      }),
    runtimeStart: (scopeId: string) =>
      json<Record<string, unknown>>(`/v1/runtime/start`, opts, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope_id: scopeId }),
      }),
    runtimePause: () =>
      json<Record<string, unknown>>(`/v1/runtime/pause`, opts, { method: "POST" }),
    runtimeResume: () =>
      json<Record<string, unknown>>(`/v1/runtime/resume`, opts, { method: "POST" }),
    runtimeStop: () =>
      json<Record<string, unknown>>(`/v1/runtime/stop`, opts, { method: "POST" }),
    runtimeRestart: (scopeId: string) =>
      json<Record<string, unknown>>(`/v1/runtime/restart`, opts, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope_id: scopeId }),
      }),
    /** Server-Sent Events: calls onMessage with parsed JSON per event. */
    subscribeEvents(scopeId: string, onMessage: (data: Record<string, unknown>) => void): { close: () => void } {
      const f = opts.fetchImpl ?? fetch;
      const url = `${opts.baseUrl.replace(/\/$/, "")}/v1/scopes/${encodeURIComponent(scopeId)}/events`;
      const ac = new AbortController();
      void (async () => {
        const res = await f(url, {
          headers: { Authorization: `Bearer ${opts.apiKey}`, Accept: "text/event-stream" },
          signal: ac.signal,
        });
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const block of parts) {
            const line = block.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            const jsonStr = line.slice(6);
            try {
              onMessage(JSON.parse(jsonStr) as Record<string, unknown>);
            } catch {
              //
            }
          }
        }
      })();
      return { close: () => ac.abort() };
    },
  };
}

export function createAdminClient(baseUrl: string, adminToken: string, fetchImpl?: typeof fetch) {
  const base = baseUrl.replace(/\/$/, "");
  const f = fetchImpl ?? fetch;
  return {
    createTenant: async (name: string) => {
      const r = await f(`${base}/v1/tenants`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name }),
      });
      const text = await r.text();
      const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
      return body as { tenant_id: string; api_key: string; key_prefix: string };
    },
  };
}

export type SwarmClient = ReturnType<typeof createSwarmClient>;
