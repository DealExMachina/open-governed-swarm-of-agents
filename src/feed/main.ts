import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { requireBearer } from "../auth.js";
import { toErrorString } from "../errors.js";
import { getPool } from "../db.js";
import { getHatcheryInstance } from "../hatchery.js";
import { listStudioCorpora } from "../studioCorpora.js";
import { FEED_PORT, RUNTIME_SCOPE_ID } from "./config.js";
import { getPathname, getQuery, sendJson } from "./http.js";
import { readScopeIdFromRequest, validateScopeAccess } from "./scope.js";
import { INDEX_HTML, STUDIO_HTML, STUDIO_APP_JS } from "./assets.js";
import { handleAddDoc, handleAddResolution } from "./contextRoutes.js";
import { handleGetPending, handleFinalityResponse } from "./mitlRoutes.js";
import { handleSummary, handleConvergence } from "./summaryRoutes.js";
import { handleEvents } from "./eventsRoute.js";
import {
  handleStudioElements,
  handleStudioScopesList,
  handleStudioScopeCreate,
  handleStudioListDocs,
  handleStudioLoadCorpus,
  handleStudioUploadDocs,
  handleStudioActivate,
  handleStudioReset,
  handleStudioResetAll,
  handleStudioDimensionSchema,
  handleStudioDocumentNodes,
  handleStudioNodeProvenance,
} from "./studioRoutes.js";

export async function main(): Promise<void> {
  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const pathname = getPathname(req.url ?? "/");
        if (req.method === "GET" && pathname === "/") {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(INDEX_HTML);
          return;
        }
        if (req.method === "GET" && pathname === "/studio") {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(STUDIO_HTML);
          return;
        }
        if (req.method === "GET" && pathname === "/studio/app.js") {
          res.writeHead(200, { "Content-Type": "application/javascript" });
          res.end(STUDIO_APP_JS);
          return;
        }
        if (req.method === "GET" && pathname === "/studio/scopes") {
          await handleStudioScopesList(req, res);
          return;
        }
        if (req.method === "POST" && pathname === "/studio/scopes") {
          await handleStudioScopeCreate(req, res);
          return;
        }
        if (req.method === "GET" && pathname === "/studio/corpora") {
          sendJson(res, 200, { corpora: listStudioCorpora() });
          return;
        }
        if (req.method === "GET" && pathname === "/studio/dimension-schema") {
          await handleStudioDimensionSchema(req, res);
          return;
        }
        if (
          pathname.startsWith("/studio/scopes/") &&
          pathname.endsWith("/load-corpus")
        ) {
          const parts = pathname.split("/").filter(Boolean);
          const scopeId = parts[2] ?? "";
          if (req.method === "POST") {
            await handleStudioLoadCorpus(req, res, scopeId);
            return;
          }
        }
        if (
          pathname.startsWith("/studio/scopes/") &&
          pathname.endsWith("/documents")
        ) {
          const parts = pathname.split("/").filter(Boolean);
          const scopeId = parts[2] ?? "";
          if (req.method === "GET") {
            await handleStudioListDocs(req, res, scopeId);
            return;
          }
          if (req.method === "POST") {
            await handleStudioUploadDocs(req, res, scopeId);
            return;
          }
        }
        if (
          pathname.startsWith("/studio/scopes/") &&
          pathname.endsWith("/activate")
        ) {
          const parts = pathname.split("/").filter(Boolean);
          const scopeId = parts[2] ?? "";
          if (req.method === "POST") {
            await handleStudioActivate(req, res, scopeId);
            return;
          }
        }
        if (req.method === "POST" && pathname === "/studio/scopes/reset-all") {
          await handleStudioResetAll(req, res);
          return;
        }
        if (
          pathname.startsWith("/studio/scopes/") &&
          pathname.endsWith("/reset")
        ) {
          const parts = pathname.split("/").filter(Boolean);
          const scopeId = parts[2] ?? "";
          if (req.method === "POST") {
            await handleStudioReset(req, res, scopeId);
            return;
          }
        }
        if (req.method === "GET" && pathname === "/studio/elements") {
          await handleStudioElements(req, res);
          return;
        }
        const docNodesMatch = pathname.match(
          /^\/studio\/scopes\/([^/]+)\/documents\/(\d+)\/nodes$/,
        );
        if (req.method === "GET" && docNodesMatch) {
          await handleStudioDocumentNodes(
            req,
            res,
            decodeURIComponent(docNodesMatch[1]),
            Number(docNodesMatch[2]),
          );
          return;
        }
        const nodeProvMatch = pathname.match(
          /^\/studio\/nodes\/([^/]+)\/provenance$/,
        );
        if (req.method === "GET" && nodeProvMatch) {
          await handleStudioNodeProvenance(
            req,
            res,
            decodeURIComponent(nodeProvMatch[1]),
          );
          return;
        }
        if (req.method === "GET" && pathname === "/summary") {
          const query = getQuery(req.url ?? "");
          const wantJson = query.raw === "1" || query.format === "json";
          const accept = (req.headers["accept"] ?? "").toLowerCase();
          if (!wantJson && accept.includes("text/html")) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(INDEX_HTML);
            return;
          }
          await handleSummary(req, res);
          return;
        }
        if (pathname.startsWith("/v1/")) {
          const { handleControlRequest } =
            await import("../controlPlaneServer.js");
          await handleControlRequest(req, res);
          return;
        }
        if (req.method === "POST" && pathname === "/context/docs") {
          if (!requireBearer(req, res)) return;
          await handleAddDoc(req, res);
          return;
        }
        if (req.method === "POST" && pathname === "/context/resolution") {
          if (!requireBearer(req, res)) return;
          await handleAddResolution(req, res);
          return;
        }
        if (req.method === "GET" && pathname === "/pending") {
          if (!requireBearer(req, res)) return;
          await handleGetPending(req, res);
          return;
        }
        if (req.method === "POST" && pathname === "/finality-response") {
          if (!requireBearer(req, res)) return;
          await handleFinalityResponse(req, res);
          return;
        }
        if (req.method === "GET" && pathname === "/convergence") {
          if (!requireBearer(req, res)) return;
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
          await handleConvergence(req, res);
          return;
        }
        if (req.method === "GET" && pathname === "/hatchery/snapshot") {
          const hatchery = getHatcheryInstance();
          if (!hatchery) {
            sendJson(res, 404, { error: "hatchery not active (legacy mode)" });
          } else {
            sendJson(
              res,
              200,
              hatchery.getSnapshot() as unknown as Record<string, unknown>,
            );
          }
          return;
        }
        if (req.method === "GET" && pathname === "/health") {
          try {
            await getPool().query("SELECT 1");
            sendJson(res, 200, { status: "ok", pg: "connected" });
          } catch (e) {
            sendJson(res, 503, { status: "unhealthy", pg: toErrorString(e) });
          }
          return;
        }
        await handleEvents(req, res);
      } catch (err) {
        if (!res.writableEnded) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
      }
    },
  );

  const FEED_HOST = process.env.FEED_HOST ?? "127.0.0.1";
  server.listen(FEED_PORT, FEED_HOST, () => {
    process.stdout.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        msg: "feed SSE server listening",
        port: FEED_PORT,
        host: FEED_HOST,
        path: "/events",
        studio: "/studio",
      }) + "\n",
    );
  });
}
