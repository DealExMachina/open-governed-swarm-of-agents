import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  logger,
  setLogContext,
  _resetLogContext,
  setLogLevel,
} from "../../src/logger.js";

describe("logger", () => {
  beforeEach(() => {
    _resetLogContext();
    setLogLevel("info");
  });

  afterEach(() => {
    _resetLogContext();
  });

  it("should emit info level messages", () => {
    const output: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((msg: string) => {
      output.push(msg);
      return true;
    }) as any;

    try {
      logger.info("test message");
      expect(output.length).toBeGreaterThan(0);
      const parsed = JSON.parse(output[0]);
      expect(parsed.level).toBe("info");
      expect(parsed.msg).toBe("test message");
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it("should include context in logs", () => {
    const output: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((msg: string) => {
      output.push(msg);
      return true;
    }) as any;

    try {
      setLogContext({ agent_id: "test-agent", role: "facts" });
      logger.info("with context");
      const parsed = JSON.parse(output[0]);
      expect(parsed.agent_id).toBe("test-agent");
      expect(parsed.role).toBe("facts");
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it("should reset context", () => {
    setLogContext({ agent_id: "test" });
    _resetLogContext();
    const output: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((msg: string) => {
      output.push(msg);
      return true;
    }) as any;

    try {
      logger.info("after reset");
      const parsed = JSON.parse(output[0]);
      expect(parsed.agent_id).toBeUndefined();
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
