/**
 * Resolution MCP HTTP facade: thin HTTP wrapper around resolutionService.ts.
 *
 * Kept for external callers (demo-server.ts, future cross-process agents).
 * In-process callers should import from resolutionService.ts directly.
 *
 * Routes:
 *   GET  /health                          -- health check
 *   GET  /resolutions/:scopeId            -- all resolved contradiction texts
 *   POST /is-resolved                     -- {scope_id, text} -> {resolved, similarity, match}
 *   POST /mark-resolved                   -- {scope_id, node_id, judgment, reason} -> {ok}
 *   POST /mark-resolved-by-text           -- {scope_id, resolution_text} -> {marked, evaluations}
 */
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { logger } from "./logger.js";
import {
  getResolutions,
  isResolved,
  markResolved,
  markResolvedByText,
} from "./resolutionService.js";

type S3Client = ReturnType<typeof import("./s3.js").makeS3>;

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/** Start the resolution MCP HTTP facade server. */
export function startResolutionMcpServer(
  port: number,
  s3?: S3Client | null,
  bucket?: string,
): void {
  const s3Client = s3 ?? null;
  const s3Bucket = bucket ?? "swarm";

  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    try {
      if (method === "GET" && url === "/health") {
        send(res, 200, { status: "ok", service: "resolution-mcp" });
        return;
      }

      const resolutionsMatch = url.match(/^\/resolutions\/([^/]+)$/);
      if (method === "GET" && resolutionsMatch) {
        const scopeId = decodeURIComponent(resolutionsMatch[1]);
        const resolved = await getResolutions(scopeId);
        send(res, 200, { resolved_contradictions: resolved });
        return;
      }

      if (method === "POST" && url === "/is-resolved") {
        const body = await readJsonBody(req);
        const text = String(body.text ?? "");
        if (!text.trim()) { send(res, 400, { error: "text required" }); return; }
        const result = await isResolved(text, String(body.scope_id ?? "default"));
        send(res, 200, result);
        return;
      }

      if (method === "POST" && url === "/mark-resolved") {
        const body = await readJsonBody(req);
        const nodeId = String(body.node_id ?? "");
        if (!nodeId) { send(res, 400, { error: "node_id required" }); return; }
        const result = await markResolved({
          scope_id: String(body.scope_id ?? "default"),
          node_id: nodeId,
          judgment: String(body.judgment ?? "resolved"),
          reason: String(body.reason ?? ""),
          s3Client,
          bucket: s3Bucket,
        });
        send(res, 200, result);
        return;
      }

      if (method === "POST" && url === "/mark-resolved-by-text") {
        const body = await readJsonBody(req);
        const resolutionText = String(body.resolution_text ?? body.decision ?? body.text ?? "").trim();
        if (!resolutionText) { send(res, 400, { error: "resolution_text, decision, or text required" }); return; }
        const nodeIds = Array.isArray(body.node_ids) ? (body.node_ids as string[]) : undefined;
        const result = await markResolvedByText({
          scope_id: String(body.scope_id ?? "default"),
          resolution_text: resolutionText,
          node_ids: nodeIds,
          s3Client,
          bucket: s3Bucket,
        });
        send(res, 200, result);
        return;
      }

      send(res, 404, { error: "not_found" });
    } catch (e) {
      logger.error("resolution-mcp error", { url, error: String(e) });
      send(res, 500, { error: String(e) });
    }
  });

  server.listen(port, () => {
    logger.info("resolution-mcp server listening", { port });
  });

  server.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE") {
      logger.warn("resolution-mcp port in use, retrying after kill", { port });
      try {
        const { execSync } = require("child_process");
        execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null || true`);
      } catch { /* best effort */ }
      setTimeout(() => server.listen(port), 1000);
    }
  });
}
