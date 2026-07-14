/**
 * Vitest setup: Database fixtures, utilities, and test configuration
 */

import { beforeAll, afterEach, vi } from "vitest";
import { _resetPoolForTest } from "../src/db.js";
import { _resetLogContext } from "../src/logger.js";
import { _resetFilterTableEnsured } from "../src/activationFilters.js";

/**
 * Global setup: Reset singletons before each test to prevent leakage
 */
beforeAll(() => {
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL || "postgres://localhost/swarm_test";
  process.env.NATS_SERVERS = process.env.TEST_NATS_SERVERS || "localhost:4222";
  process.env.S3_ENDPOINT =
    process.env.TEST_S3_ENDPOINT || "http://localhost:9000";
});

/**
 * Per-test cleanup: Reset global state to prevent cross-test contamination
 */
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetPoolForTest();
  _resetLogContext();
  _resetFilterTableEnsured();
});

/**
 * Test utilities
 */

export function createMockLogger() {
  const logs: Array<{ level: string; msg: string; extra?: unknown }> = [];
  return {
    debug: (msg: string, extra?: unknown) =>
      logs.push({ level: "debug", msg, extra }),
    info: (msg: string, extra?: unknown) =>
      logs.push({ level: "info", msg, extra }),
    warn: (msg: string, extra?: unknown) =>
      logs.push({ level: "warn", msg, extra }),
    error: (msg: string, extra?: unknown) =>
      logs.push({ level: "error", msg, extra }),
    logs,
    clear: () => logs.splice(0),
  };
}

export async function waitFor(
  condition: () => boolean,
  timeout = 5000,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error("Timeout waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
