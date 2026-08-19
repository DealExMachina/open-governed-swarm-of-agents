import { describe, it, expect, vi } from "vitest";
import { FACTS_PIPELINE_WAL_TYPES } from "../../src/contextWal.js";

describe("contextWal facts trigger", () => {
  it("only counts external input events, not internal cycle wraps", () => {
    expect(FACTS_PIPELINE_WAL_TYPES).toEqual([
      "bootstrap",
      "context_doc",
      "resolution",
    ]);
    expect(FACTS_PIPELINE_WAL_TYPES).not.toContain("state_transition");
  });
});
