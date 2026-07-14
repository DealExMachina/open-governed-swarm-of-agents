import { describe, it, expect } from "vitest";
import { toErrorString } from "../../src/errors.js";

describe("toErrorString", () => {
  it("should handle null", () => {
    expect(toErrorString(null)).toBe("null");
  });

  it("should handle undefined", () => {
    expect(toErrorString(undefined)).toBe("undefined");
  });

  it("should extract message from Error object", () => {
    const error = new Error("test error");
    expect(toErrorString(error)).toBe("test error");
  });

  it("should include error code if available", () => {
    const error = new Error("connection failed");
    (error as any).code = "ECONNREFUSED";
    const result = toErrorString(error);
    expect(result).toContain("connection failed");
    expect(result).toContain("ECONNREFUSED");
  });

  it("should handle objects with message property", () => {
    const error = { message: "object error" };
    expect(toErrorString(error)).toBe("object error");
  });

  it("should handle objects with code property", () => {
    const error = { code: "ERR_MODULE_NOT_FOUND" };
    expect(toErrorString(error)).toBe("ERR_MODULE_NOT_FOUND");
  });

  it("should handle strings", () => {
    expect(toErrorString("string error")).toBe("string error");
  });

  it("should handle numbers", () => {
    expect(toErrorString(42)).toBe("42");
  });

  it("should safely handle unknown objects", () => {
    const error = { some: "object" };
    const result = toErrorString(error);
    expect(result).toBeTruthy();
    expect(result).not.toContain("[object Object]");
  });
});
