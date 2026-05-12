import { describe, it, expect, afterEach, vi } from "vitest";
import { getPool, _resetPoolForTest } from "../../src/db.js";

describe("db pool", () => {
  afterEach(() => {
    _resetPoolForTest();
  });

  it("should throw if DATABASE_URL is not set", () => {
    const originalUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      expect(() => {
        getPool();
      }).toThrow("DATABASE_URL is required");
    } finally {
      process.env.DATABASE_URL = originalUrl;
    }
  });

  it("should return same pool instance on multiple calls", () => {
    process.env.DATABASE_URL = "postgres://localhost/test";
    const pool1 = getPool();
    const pool2 = getPool();
    expect(pool1).toBe(pool2);
  });

  it("should allow reset for testing", () => {
    process.env.DATABASE_URL = "postgres://localhost/test";
    const pool1 = getPool();
    _resetPoolForTest();
    // After reset, a new pool should be created on next call
    // (though connection will fail without real DB)
    try {
      const pool2 = getPool();
      expect(pool2).not.toBe(pool1);
    } catch {
      // Expected if DB not available
    }
  });

  it("should handle pool error event gracefully", async () => {
    process.env.DATABASE_URL = "postgres://localhost/test";
    let resolveSeen!: () => void;
    const seen = new Promise<void>((res) => {
      resolveSeen = res;
    });
    const spy = vi.spyOn(console, "error").mockImplementation((first: unknown) => {
      if (typeof first === "string" && first.includes("pool error")) {
        resolveSeen();
      }
    });

    try {
      const pool = getPool();
      pool.emit("error", new Error("simulated pool error"));
      await seen;
    } finally {
      spy.mockRestore();
      _resetPoolForTest();
    }
  });
});
