import { describe, expect, it } from "vitest";
import { synthesizeStudioEdges } from "../../src/studioGraphEdges.js";

describe("studioGraphEdges", () => {
  it("links contradictions to related claims when metadata is missing", () => {
    const edges = synthesizeStudioEdges(
      [
        {
          id: "x1",
          type: "contradiction",
          content:
            "NovaTech patent co-ownership affects ownership of certain patents.",
        },
        {
          id: "c1",
          type: "claim",
          content:
            "The co-ownership dispute with Dr. Klaus Haber affects patent ownership.",
        },
        { id: "c2", type: "claim", content: "Adjusted ARR is €38M." },
      ],
      [],
    );
    expect(edges.some((e) => e.source === "x1" && e.target === "c1")).toBe(true);
    expect(edges.some((e) => e.source === "x1" && e.target === "c2")).toBe(false);
  });

  it("links docs to related claims when claim_ids metadata is missing", () => {
    const edges = synthesizeStudioEdges(
      [
        {
          id: "d1",
          type: "doc",
          content: "01-analyst-briefing",
        },
        {
          id: "c1",
          type: "claim",
          content: "Analyst briefing states adjusted ARR is €50M.",
        },
        { id: "c2", type: "claim", content: "Legal review found no issues." },
      ],
      [],
    );
    expect(edges.some((e) => e.source === "d1" && e.target === "c1")).toBe(true);
    expect(edges.some((e) => e.source === "d1" && e.target === "c2")).toBe(false);
  });
});
