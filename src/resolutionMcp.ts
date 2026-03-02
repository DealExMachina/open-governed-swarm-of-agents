/**
 * Resolution MCP server: exposes resolved contradiction state as HTTP tools.
 * Backed by pgvector semantic similarity for paraphrase matching.
 *
 * Tools:
 *   GET  /resolutions/:scopeId          -- all resolved contradiction texts
 *   POST /is-resolved                   -- {scope_id, text} -> {resolved: bool, similarity, match}
 *   POST /mark-resolved                 -- {scope_id, node_id, judgment, reason} -> {ok}
 *
 * Started by the hatchery alongside the MITL server.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { getPool } from "./db.js";
import { getEmbedding, embedAndPersistNode } from "./embeddingPipeline.js";
import { updateNodeStatus, appendEdge } from "./semanticGraph.js";
import { s3PutJson, s3GetText } from "./s3.js";
import { logger } from "./logger.js";

const SIMILARITY_THRESHOLD = 0.7;

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

/** GET /resolutions/:scopeId -- list all resolved contradiction texts */
async function handleGetResolutions(scopeId: string, res: ServerResponse): Promise<void> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT node_id, content, metadata FROM nodes
     WHERE scope_id = $1 AND type = 'contradiction' AND status = 'resolved'
       AND superseded_at IS NULL
     ORDER BY updated_at DESC LIMIT 100`,
    [scopeId],
  );
  send(res, 200, {
    resolved_contradictions: result.rows.map((r) => ({
      node_id: r.node_id,
      content: r.content,
    })),
  });
}

/** POST /is-resolved -- check if text is semantically similar to any resolved contradiction */
async function handleIsResolved(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req);
  const scopeId = String(body.scope_id ?? "default");
  const text = String(body.text ?? "");
  if (!text.trim()) {
    send(res, 400, { error: "text required" });
    return;
  }

  const embedding = await getEmbedding(text);
  if (embedding.length === 0) {
    send(res, 200, { resolved: false, reason: "embedding_unavailable" });
    return;
  }

  const pool = getPool();
  const vec = `[${embedding.join(",")}]`;
  const result = await pool.query(
    `SELECT node_id, content, 1 - (embedding <=> $2::vector) AS similarity
     FROM nodes
     WHERE scope_id = $1 AND type = 'contradiction' AND status = 'resolved'
       AND superseded_at IS NULL AND embedding IS NOT NULL
     ORDER BY embedding <=> $2::vector ASC
     LIMIT 1`,
    [scopeId, vec],
  );

  if (result.rowCount && result.rows[0]) {
    const row = result.rows[0];
    const similarity = Number(row.similarity);
    if (similarity >= SIMILARITY_THRESHOLD) {
      send(res, 200, {
        resolved: true,
        similarity: Math.round(similarity * 1000) / 1000,
        match: row.content,
        match_node_id: row.node_id,
      });
      return;
    }
  }

  send(res, 200, { resolved: false, similarity: result.rows[0] ? Number(result.rows[0].similarity) : 0 });
}

/** POST /mark-resolved -- mark a contradiction as resolved + embed for future matching */
async function handleMarkResolved(
  req: IncomingMessage,
  res: ServerResponse,
  s3: ReturnType<typeof import("./s3.js").makeS3> | null,
  bucket: string,
): Promise<void> {
  const body = await readJsonBody(req);
  const scopeId = String(body.scope_id ?? "default");
  const nodeId = String(body.node_id ?? "");
  const judgment = String(body.judgment ?? "resolved");
  const reason = String(body.reason ?? "");

  if (!nodeId) {
    send(res, 400, { error: "node_id required" });
    return;
  }

  await updateNodeStatus(nodeId, "resolved");

  try {
    await appendEdge({
      scope_id: scopeId,
      source_id: nodeId,
      target_id: nodeId,
      edge_type: "resolves",
      weight: 1,
      metadata: { source: "resolution-mcp", judgment, reason },
      created_by: "resolution-mcp",
    });
  } catch { /* self-edge may fail */ }

  // Embed the resolved contradiction for future similarity matching
  const pool = getPool();
  const nodeRes = await pool.query("SELECT content FROM nodes WHERE node_id = $1", [nodeId]);
  const content = nodeRes.rows[0]?.content;
  if (content) {
    await embedAndPersistNode(nodeId, scopeId, content);
  }

  // Update S3 resolution artifact
  if (s3) {
    try {
      let existing: Array<{ content: string; judgment: string; reason: string }> = [];
      const raw = await s3GetText(s3, bucket, "resolutions/latest.json");
      if (raw) {
        const parsed = JSON.parse(raw) as { resolved_contradictions?: Array<{ content: string; judgment: string; reason: string }> };
        existing = parsed.resolved_contradictions ?? [];
      }
      if (content && !existing.some((r) => r.content === content)) {
        existing.push({ content, judgment, reason });
      }
      await s3PutJson(s3, bucket, "resolutions/latest.json", {
        resolved_contradictions: existing,
        updated_at: new Date().toISOString(),
      });
    } catch { /* S3 write is best-effort */ }
  }

  logger.info("resolution-mcp: marked resolved", { node_id: nodeId, judgment, reason: reason.slice(0, 80) });
  send(res, 200, { ok: true, node_id: nodeId, embedded: !!content });
}

/** Start the resolution MCP server. */
export function startResolutionMcpServer(
  port: number,
  s3?: ReturnType<typeof import("./s3.js").makeS3> | null,
  bucket?: string,
): void {
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
        await handleGetResolutions(decodeURIComponent(resolutionsMatch[1]), res);
        return;
      }

      if (method === "POST" && url === "/is-resolved") {
        await handleIsResolved(req, res);
        return;
      }

      if (method === "POST" && url === "/mark-resolved") {
        await handleMarkResolved(req, res, s3 ?? null, bucket ?? "swarm");
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

/** Client helper: check if a contradiction text is resolved (calls the MCP server). */
export async function isResolvedViaService(text: string, scopeId: string = "default"): Promise<boolean> {
  const port = parseInt(process.env.RESOLUTION_MCP_PORT ?? "3005", 10);
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/is-resolved`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope_id: scopeId, text }),
    });
    if (!resp.ok) return false;
    const data = (await resp.json()) as { resolved?: boolean };
    return data.resolved === true;
  } catch {
    return false;
  }
}
