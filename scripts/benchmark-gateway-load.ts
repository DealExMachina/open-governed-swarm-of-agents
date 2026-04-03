#!/usr/bin/env tsx
/**
 * Gateway load benchmark for SGRS HTTP endpoints.
 *
 * Simulates concurrent HTTP clients submitting documents and checking status.
 * Measures latency, throughput, error rate, and authorization overhead.
 *
 * Usage:
 *   pnpm tsx scripts/benchmark-gateway-load.ts
 *   pnpm tsx scripts/benchmark-gateway-load.ts --scale=medium --runs=3
 *   pnpm tsx scripts/benchmark-gateway-load.ts --clients=200 --duration=30
 *
 * Options:
 *   --clients=N       Number of concurrent HTTP clients (default 50).
 *   --scale=S         Scale preset: tiny (50), small (100), medium (200), large (500).
 *   --duration=N      Run for N seconds (default 10).
 *   --runs=N          Run benchmark N times, report aggregate stats (default 1).
 *   --host=H          Feed server host (default localhost).
 *   --port=P          Feed server port (default 3002).
 *   --token=T         Authorization Bearer token (from SWARM_API_TOKEN or env).
 *   --scope-id=S      Scope ID for requests (default "default").
 */

import { request as httpRequest, IncomingMessage } from "http";
import { URL } from "url";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SCALE_PRESETS: Record<string, number> = {
  tiny: 50,
  small: 100,
  medium: 200,
  large: 500,
};

function parseArgs(): {
  clients: number;
  durationSec: number;
  runs: number;
  host: string;
  port: number;
  token: string;
  scopeId: string;
} {
  const args = process.argv.slice(2);
  let clients = 50;
  let durationSec = 10;
  let runs = 1;
  let host = "localhost";
  let port = 3002;
  let token = process.env.SWARM_API_TOKEN ?? "";
  let scopeId = "default";

  for (const a of args) {
    if (a.startsWith("--clients="))
      clients = Math.max(1, parseInt(a.slice("--clients=".length), 10));
    else if (a.startsWith("--scale=")) {
      const scale = a.slice("--scale=".length);
      if (SCALE_PRESETS[scale] !== undefined) {
        clients = SCALE_PRESETS[scale];
      }
    } else if (a.startsWith("--duration="))
      durationSec = Math.max(1, parseInt(a.slice("--duration=".length), 10));
    else if (a.startsWith("--runs="))
      runs = Math.max(1, parseInt(a.slice("--runs=".length), 10));
    else if (a.startsWith("--host="))
      host = a.slice("--host=".length);
    else if (a.startsWith("--port="))
      port = Math.max(1, parseInt(a.slice("--port=".length), 10));
    else if (a.startsWith("--token="))
      token = a.slice("--token=".length);
    else if (a.startsWith("--scope-id="))
      scopeId = a.slice("--scope-id=".length);
  }

  return { clients, durationSec, runs, host, port, token, scopeId };
}

// ---------------------------------------------------------------------------
// HTTP Client
// ---------------------------------------------------------------------------

interface RequestLatency {
  method: string;
  endpoint: string;
  statusCode: number;
  latencyMs: number;
  error: boolean;
}

function makeHttpRequest(
  method: string,
  path: string,
  body: Record<string, unknown> | null,
  host: string,
  port: number,
  token: string,
): Promise<RequestLatency> {
  return new Promise((resolve) => {
    const startTime = performance.now();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const options = {
      hostname: host,
      port,
      path,
      method,
      headers,
    };

    let statusCode = 0;
    let error = false;

    const req = httpRequest(options, (res: IncomingMessage) => {
      statusCode = res.statusCode ?? 500;
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        const latencyMs = performance.now() - startTime;
        resolve({
          method,
          endpoint: path,
          statusCode,
          latencyMs,
          error: statusCode >= 400,
        });
      });
    });

    req.on("error", () => {
      const latencyMs = performance.now() - startTime;
      error = true;
      resolve({
        method,
        endpoint: path,
        statusCode: 0,
        latencyMs,
        error: true,
      });
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Seeded PRNG (Mulberry32) for deterministic document generation
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateDocumentBody(
  rng: () => number,
  scopeId: string,
): Record<string, unknown> {
  const docTypes = ["financial", "legal", "technical", "operational"];
  const docType = docTypes[Math.floor(rng() * docTypes.length)];

  return {
    scope_id: scopeId,
    title: `${docType} doc ${Math.floor(rng() * 10000)}`,
    body: `Document content for ${docType} analysis. Paragraph 1: Lorem ipsum dolor sit amet. Paragraph 2: Additional details and context.`,
    source: "api",
  };
}

// ---------------------------------------------------------------------------
// Benchmark Runner
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, x) => sum + (x - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    Math.ceil((p / 100) * sorted.length) - 1,
    sorted.length - 1,
  );
  return sorted[Math.max(0, idx)];
}

interface RunResult {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  elapsedSec: number;
  throughputReqSec: number;
  latencies: {
    min: number;
    max: number;
    mean: number;
    p50: number;
    p95: number;
    p99: number;
    stddev: number;
  };
  byStatusCode: Record<number, number>;
}

async function runBenchmark(
  clients: number,
  durationSec: number,
  host: string,
  port: number,
  token: string,
  scopeId: string,
): Promise<RunResult> {
  const startWall = Date.now();
  const deadline = startWall + durationSec * 1000;
  const allResults: RequestLatency[] = [];

  // Spin up client tasks
  const clientTasks = Array.from({ length: clients }, async (_, clientId) => {
    const rng = mulberry32(12345 + clientId);
    const clientResults: RequestLatency[] = [];

    while (Date.now() < deadline) {
      const doc = generateDocumentBody(rng, scopeId);
      const result = await makeHttpRequest(
        "POST",
        "/context/docs",
        doc,
        host,
        port,
        token,
      );
      clientResults.push(result);
    }

    return clientResults;
  });

  // Collect all results
  const allClientResults = await Promise.all(clientTasks);
  for (const clientResults of allClientResults) {
    allResults.push(...clientResults);
  }

  const elapsedMs = Date.now() - startWall;
  const elapsedSec = elapsedMs / 1000;
  const successCount = allResults.filter((r) => !r.error).length;
  const errorCount = allResults.filter((r) => r.error).length;
  const throughputReqSec = allResults.length / elapsedSec;

  const latencies = allResults.map((r) => r.latencyMs).sort((a, b) => a - b);
  const byStatusCode: Record<number, number> = {};
  for (const result of allResults) {
    byStatusCode[result.statusCode] = (byStatusCode[result.statusCode] ?? 0) + 1;
  }

  return {
    totalRequests: allResults.length,
    successCount,
    errorCount,
    elapsedSec,
    throughputReqSec,
    latencies: {
      min: latencies[0] ?? 0,
      max: latencies[latencies.length - 1] ?? 0,
      mean: mean(latencies),
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      stddev: stddev(latencies),
    },
    byStatusCode,
  };
}

function printRunResults(result: RunResult): void {
  console.log("--- Results ---");
  console.log("  total requests: " + result.totalRequests);
  console.log("  successful:     " + result.successCount);
  console.log("  errors:         " + result.errorCount);
  console.log("  elapsed (s):    " + result.elapsedSec.toFixed(2));
  console.log("  throughput:     " + result.throughputReqSec.toFixed(0) + " req/s");
  console.log("");

  console.log("  Latency (ms):");
  console.log(
    "    min=" +
      result.latencies.min.toFixed(2) +
      "  p50=" +
      result.latencies.p50.toFixed(2) +
      "  p95=" +
      result.latencies.p95.toFixed(2) +
      "  p99=" +
      result.latencies.p99.toFixed(2) +
      "  max=" +
      result.latencies.max.toFixed(2) +
      "  avg=" +
      result.latencies.mean.toFixed(2),
  );
  console.log("    stddev=" + result.latencies.stddev.toFixed(2));
  console.log("");

  console.log("  Status codes:");
  for (const [code, count] of Object.entries(result.byStatusCode).sort()) {
    const pct = ((count / result.totalRequests) * 100).toFixed(1);
    console.log("    " + code + ": " + count + " (" + pct + "%)");
  }

  const errorRate = (result.errorCount / result.totalRequests) * 100;
  console.log("");
  console.log("  Error rate: " + errorRate.toFixed(2) + "%");

  if (errorRate > 0.1) {
    console.log("  WARNING: Error rate > 0.1% threshold");
  }
  if (result.latencies.p99 > 1000) {
    console.log("  WARNING: p99 latency > 1000ms threshold");
  }
}

async function main(): Promise<void> {
  const { clients, durationSec, runs, host, port, token, scopeId } = parseArgs();

  console.log("SGRS gateway load benchmark");
  console.log("  host:       " + host);
  console.log("  port:       " + port);
  console.log("  clients:    " + clients);
  console.log("  scope_id:   " + scopeId);
  console.log("  duration:   " + durationSec + "s");
  console.log("  runs:       " + runs);
  console.log("  token:      " + (token ? "present" : "absent (no auth)"));
  console.log("");

  const runResults: RunResult[] = [];

  for (let runIdx = 0; runIdx < runs; runIdx++) {
    if (runs > 1) {
      console.log(`=== Run ${runIdx + 1}/${runs} ===`);
    }

    const result = await runBenchmark(clients, durationSec, host, port, token, scopeId);
    runResults.push(result);
    printRunResults(result);

    if (runIdx < runs - 1) console.log("");
  }

  if (runs > 1) {
    console.log("\n=== Aggregate Stats ===");
    const allThroughputs = runResults.map((r) => r.throughputReqSec);
    const allP99s = runResults.map((r) => r.latencies.p99);
    const allErrorRates = runResults.map((r) => (r.errorCount / r.totalRequests) * 100);

    console.log("  throughput (req/s):");
    console.log(
      "    avg=" +
        mean(allThroughputs).toFixed(0) +
        "  min=" +
        Math.min(...allThroughputs).toFixed(0) +
        "  max=" +
        Math.max(...allThroughputs).toFixed(0) +
        "  stddev=" +
        stddev(allThroughputs).toFixed(0),
    );
    console.log("  p99 latency (ms):");
    console.log(
      "    avg=" +
        mean(allP99s).toFixed(2) +
        "  min=" +
        Math.min(...allP99s).toFixed(2) +
        "  max=" +
        Math.max(...allP99s).toFixed(2) +
        "  stddev=" +
        stddev(allP99s).toFixed(2),
    );
    console.log("  error rate (%):");
    console.log(
      "    avg=" +
        mean(allErrorRates).toFixed(2) +
        "  min=" +
        Math.min(...allErrorRates).toFixed(2) +
        "  max=" +
        Math.max(...allErrorRates).toFixed(2),
    );

    const anyErrors = runResults.some((r) => r.errorCount > 0);
    if (anyErrors) {
      console.log("  WARNING: Some runs had errors; check server health");
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exitCode = 1;
});
