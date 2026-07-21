import { describe, expect, it } from "vitest";
import {
  assignDocumentStatuses,
  normalizeDocTitle,
} from "../../src/studioDocumentProgress.js";

describe("studioDocumentProgress", () => {
  it("normalizes titles for matching", () => {
    expect(normalizeDocTitle(" Briefing.PDF ")).toBe("briefing");
  });

  it("marks first pending doc as processing", () => {
    const { documents, progress } = assignDocumentStatuses(
      [
        { seq: 1, title: "A", ingested_at: "t1", source: "studio" },
        { seq: 2, title: "B", ingested_at: "t2", source: "studio" },
        { seq: 3, title: "C", ingested_at: "t3", source: "studio" },
      ],
      new Set([normalizeDocTitle("A")]),
    );
    expect(progress).toEqual({
      total: 3,
      processed: 1,
      processing: 1,
      pending: 1,
      stalled: 0,
    });
    const byTitle = Object.fromEntries(documents.map((d) => [d.title, d.status]));
    expect(byTitle.A).toBe("processed");
    expect(byTitle.B).toBe("processing");
    expect(byTitle.C).toBe("pending");
  });

  it("marks stuck first doc as stalled when claims exist and swarm idle", () => {
    const now = Date.now();
    const { documents, progress } = assignDocumentStatuses(
      [
        {
          seq: 821,
          title: "01-analyst-briefing",
          ingested_at: new Date(now - 600_000).toISOString(),
          source: "studio",
        },
        {
          seq: 822,
          title: "02-risk-memo",
          ingested_at: new Date(now - 599_000).toISOString(),
          source: "studio",
        },
      ],
      new Set(),
      {
        claimCount: 12,
        swarmLastNode: "DriftChecked",
        swarmUpdatedAt: new Date(now - 300_000),
        now,
      },
    );
    expect(progress.stalled).toBe(1);
    expect(documents.find((d) => d.title === "01-analyst-briefing")?.status).toBe(
      "stalled",
    );
    expect(documents.find((d) => d.title === "02-risk-memo")?.status).toBe(
      "pending",
    );
  });
});
