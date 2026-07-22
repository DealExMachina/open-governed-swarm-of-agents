import { request as httpRequest, type ServerResponse } from "http";
import { FEED_URL } from "./config.js";
import { authHeaders } from "./http.js";
import { demoState } from "./state.js";

// ---------------------------------------------------------------------------
// SSE proxy: forward feed server events to connected demo UI clients
// ---------------------------------------------------------------------------

export const sseClients = new Set<ServerResponse>();

export function startSseProxy(): void {
  const feedEventUrl = new URL(`${FEED_URL}/events`);
  if (demoState.activeScopeId) {
    feedEventUrl.searchParams.set("scope_id", demoState.activeScopeId);
  }
  const req = httpRequest(
    {
      hostname: feedEventUrl.hostname,
      port: feedEventUrl.port || 80,
      path: feedEventUrl.pathname,
      method: "GET",
      headers: { Accept: "text/event-stream", "Cache-Control": "no-cache", ...authHeaders() },
    },
    (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        res.on("end", () => setTimeout(startSseProxy, 3000));
        return;
      }
      let buffer = "";
      res.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          if (!sseBlockMatchesActiveScope(block)) continue;
          for (const client of sseClients) {
            if (!client.writableEnded) client.write(`${block}\n\n`);
            else sseClients.delete(client);
          }
        }
      });
      res.on("end", () => {
        setTimeout(startSseProxy, 3000);
      });
      res.on("error", () => {
        setTimeout(startSseProxy, 3000);
      });
    },
  );
  req.on("error", () => {
    setTimeout(startSseProxy, 3000);
  });
  req.end();
}

export function sseEventScopeId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.scope_id === "string") return o.scope_id;
  const payload = o.payload;
  if (payload && typeof payload === "object") {
    const ps = (payload as Record<string, unknown>).scope_id;
    if (typeof ps === "string") return ps;
  }
  return null;
}

/** Drop feed events from other Studio scopes so the demo UI stays isolated. */
export function sseBlockMatchesActiveScope(block: string): boolean {
  if (block.startsWith(":")) return true;
  const scope = demoState.activeScopeId;
  if (!scope) return false;
  for (const line of block.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const json = line.slice(5).trim();
    if (!json) continue;
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      if (parsed.type === "feed_connected") return true;
      const eventScope = sseEventScopeId(parsed);
      if (!eventScope) return false;
      return eventScope === scope;
    } catch {
      return false;
    }
  }
  return false;
}
