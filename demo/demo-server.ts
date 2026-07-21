/**
 * Governed Swarm Demo Server
 *
 * Multi-scenario demo UI (M&A, Financial, Insurance, Green Bond). Orchestrates
 * document ingestion step by step, streams live swarm events, highlights governance
 * interventions, and surfaces the human-in-the-loop review when the system reaches
 * near-finality.
 *
 * Usage:  pnpm run demo
 * Opens:  http://localhost:3005
 *
 * Implementation modules: demo/server/* — UI assets: demo/ui/*
 */

import "dotenv/config";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "http";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { checkAllServices } from "../scripts/checks/check-services.js";
import { DEMO_PORT, MITL_URL } from "./server/config.js";
import { readBody, sendJson, proxyPost } from "./server/http.js";
import { SCENARIOS } from "./server/scenarios.js";
import { demoState } from "./server/state.js";
import { startSseProxy } from "./server/sse.js";
import {
  handleScenarios,
  handleStatus,
  handleSelectScenario,
  handleDemoSessionStart,
  handleDemoSessionClose,
  handleDocs,
  handleStep,
  handleRunAll,
  handleSummary,
  handleSituation,
  handleKnowledge,
  handleContradictions,
  handlePending,
  handleFinalityResponse,
  handleResolution,
  handleReset,
  handleEvents,
} from "./server/routes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_HTML = readFileSync(join(__dirname, "ui", "index.html"), "utf-8");
const DEMO_MA_VIEW_HTML = readFileSync(
  join(__dirname, "ui", "ma-view.html"),
  "utf-8",
);

async function main(): Promise<void> {
  if (process.env.DEMO_SKIP_PREFLIGHT !== "1") {
    process.env.CHECK_FEED = "1";
    const { ok, results } = await checkAllServices({ retries: 2, delayMs: 2000 });
    if (!ok) {
      const failed = results.filter((r) => r.err != null);
      process.stderr.write(
        "\nDemo preflight failed. Required services are not reachable:\n",
      );
      for (const r of failed) process.stderr.write(`  ${r.name}: ${r.err}\n`);
      process.stderr.write(
        "\nFix: Run ./scripts/demo/demo-preflight.sh, then start swarm hatchery and feed:\n",
      );
      process.stderr.write(
        "  pnpm run swarm:start   (terminal 1)  # full pipeline\n",
      );
      process.stderr.write("  pnpm run feed    (terminal 2)\n");
      process.stderr.write("  pnpm run demo    (terminal 3)\n\n");
      process.stderr.write(
        "Or skip preflight: DEMO_SKIP_PREFLIGHT=1 pnpm run demo\n\n",
      );
      process.exit(1);
    }
  }

  startSseProxy();

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? "/";
      const pathname = url.split("?")[0];

      try {
        if (req.method === "GET" && (pathname === "/" || pathname === "/demo")) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(DEMO_HTML);
          return;
        }
        if (
          req.method === "GET" &&
          (pathname === "/demo/ma-view" || pathname === "/due-diligence")
        ) {
          demoState.activeScenarioId = "ma";
          demoState.activeDocs = SCENARIOS.ma.docs;
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(DEMO_MA_VIEW_HTML);
          return;
        }
        if (req.method === "GET" && pathname === "/api/scenarios") {
          handleScenarios(res);
          return;
        }
        if (req.method === "GET" && pathname === "/api/status") {
          await handleStatus(res);
          return;
        }
        if (req.method === "POST" && pathname === "/api/demo-session/start") {
          await handleDemoSessionStart(req, res);
          return;
        }
        if (req.method === "POST" && pathname === "/api/demo-session/close") {
          await handleDemoSessionClose(req, res);
          return;
        }
        if (req.method === "POST" && pathname === "/api/select-scenario") {
          const body = await readBody(req);
          await handleSelectScenario(body, res);
          return;
        }
        if (req.method === "GET" && pathname === "/api/docs") {
          handleDocs(res);
          return;
        }
        const stepMatch = pathname.match(/^\/api\/step\/(\d+)$/);
        if (req.method === "POST" && stepMatch) {
          await handleStep(parseInt(stepMatch[1], 10), res);
          return;
        }
        if (req.method === "POST" && pathname === "/api/run-all") {
          await handleRunAll(res);
          return;
        }
        if (req.method === "GET" && pathname === "/api/summary") {
          await handleSummary(res);
          return;
        }
        if (req.method === "GET" && pathname === "/api/situation") {
          await handleSituation(res);
          return;
        }
        if (req.method === "GET" && pathname === "/api/pending") {
          await handlePending(res);
          return;
        }
        if (req.method === "GET" && pathname === "/api/contradictions") {
          await handleContradictions(res);
          return;
        }
        if (req.method === "GET" && pathname === "/api/knowledge") {
          await handleKnowledge(res);
          return;
        }
        if (req.method === "POST" && pathname === "/api/finality-response") {
          await handleFinalityResponse(req, res);
          return;
        }
        if (req.method === "POST" && pathname === "/api/resolution") {
          await handleResolution(req, res);
          return;
        }
        const approveMatch = pathname.match(/^\/api\/approve\/(.+)$/);
        if (req.method === "POST" && approveMatch) {
          try {
            const data = await proxyPost(
              `${MITL_URL}/approve/${approveMatch[1]}`,
              {},
            );
            sendJson(res, 200, data as Record<string, unknown>);
          } catch (e) {
            sendJson(res, 502, { error: String(e) });
          }
          return;
        }
        if (req.method === "POST" && pathname === "/api/reset") {
          await handleReset(res);
          return;
        }
        if (req.method === "GET" && pathname === "/api/events") {
          handleEvents(req, res);
          return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
      } catch (err) {
        if (!res.writableEnded) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
      }
    },
  );

  server.listen(DEMO_PORT, "0.0.0.0", () => {
    process.stdout.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        msg: "Demo server listening",
        port: DEMO_PORT,
        url: `http://localhost:${DEMO_PORT}`,
        docs: demoState.activeDocs.length,
      }) + "\n",
    );
    process.stdout.write(`\n  Open: http://localhost:${DEMO_PORT}\n\n`);
  });
}

main().catch((e) => {
  process.stderr.write(String(e) + "\n");
  process.exit(1);
});
