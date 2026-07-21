import { describe, it, expect, vi, beforeEach } from "vitest";

const runInTransaction = vi.fn();
const appendNode = vi.fn();
const appendEdge = vi.fn();
const updateNodeConfidence = vi.fn();
const updateNodeStatus = vi.fn();
const hasResolvingEdge = vi.fn();
const queryNodesByCreator = vi.fn();

vi.mock("../../src/db.js", () => ({
  runInTransaction: (...args: unknown[]) => runInTransaction(...args),
}));

vi.mock("../../src/semanticGraph.js", () => ({
  appendNode: (...args: unknown[]) => appendNode(...args),
  appendEdge: (...args: unknown[]) => appendEdge(...args),
  updateNodeConfidence: (...args: unknown[]) => updateNodeConfidence(...args),
  updateNodeStatus: (...args: unknown[]) => updateNodeStatus(...args),
  hasResolvingEdge: (...args: unknown[]) => hasResolvingEdge(...args),
  queryNodesByCreator: (...args: unknown[]) => queryNodesByCreator(...args),
}));

vi.mock("../../src/studioGraphEdges.js", () => ({
  findRelatedNodeIds: () => [],
}));

vi.mock("../../src/embeddingPipeline.js", () => ({
  embedAndPersistNode: vi.fn().mockResolvedValue(true),
}));

function makeNode(overrides: Record<string, unknown> = {}) {
  return {
    node_id: "existing-id",
    scope_id: "scope-1",
    type: "claim",
    content: "Claim A",
    confidence: 0.8,
    status: "active",
    source_ref: {},
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: "facts-sync",
    version: 1,
    ...overrides,
  };
}

function makeMockClient() {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  return { query };
}

describe("factsToSemanticGraph provenance (issue #6)", () => {
  beforeEach(() => {
    runInTransaction.mockImplementation(async (fn: (client: unknown) => Promise<unknown>) => fn(makeMockClient()));
    appendNode.mockResolvedValue("node-uuid");
    appendEdge.mockResolvedValue("edge-uuid");
    updateNodeConfidence.mockResolvedValue(undefined);
    updateNodeStatus.mockResolvedValue(undefined);
    hasResolvingEdge.mockResolvedValue(false);
    queryNodesByCreator.mockResolvedValue([]);
    vi.clearAllMocks();
  });

  it("threads document_seq/title/hash from provenance into new claim/goal/risk source_ref", async () => {
    queryNodesByCreator.mockResolvedValue([]);
    const { syncFactsToSemanticGraph } = await import("../../src/factsToSemanticGraph.js");
    const result = await syncFactsToSemanticGraph("scope-1", {
      claims: ["Claim A"],
      goals: ["Goal 1"],
      risks: ["Risk one"],
      confidence: 0.9,
      provenance: {
        claims: [{ document_seq: 42, document_title: "doc.pdf", document_content_hash: "abc123" }],
        goals: [{ document_seq: 42, document_title: "doc.pdf", document_content_hash: "abc123" }],
        risks: [{ document_seq: 42, document_title: "doc.pdf", document_content_hash: "abc123" }],
      },
    });

    const byType = Object.fromEntries(
      appendNode.mock.calls
        .map((c) => c[0] as { type: string; source_ref: Record<string, unknown> })
        .map((n) => [n.type, n.source_ref]),
    );
    expect(byType.claim).toEqual({
      source: "facts",
      document_seq: 42,
      document_title: "doc.pdf",
      document_content_hash: "abc123",
    });
    expect(byType.goal).toMatchObject({ source: "facts", document_seq: 42 });
    expect(byType.risk).toMatchObject({ source: "facts", document_seq: 42 });
    expect(result.nodesWithProvenance).toBe(3);
  });

  it("includes document_seqs only when an item has more than one source", async () => {
    queryNodesByCreator.mockResolvedValue([]);
    const { syncFactsToSemanticGraph } = await import("../../src/factsToSemanticGraph.js");
    await syncFactsToSemanticGraph("scope-1", {
      claims: ["Single source", "Multi source"],
      confidence: 0.9,
      provenance: {
        claims: [
          { document_seq: 7, document_seqs: [7] },
          { document_seq: 7, document_seqs: [7, 9] },
        ],
      },
    });

    const refs = appendNode.mock.calls
      .map((c) => c[0] as { content: string; source_ref: Record<string, unknown> })
      .filter((n) => n.content === "Single source" || n.content === "Multi source");
    const single = refs.find((n) => n.content === "Single source")!.source_ref;
    const multi = refs.find((n) => n.content === "Multi source")!.source_ref;
    expect(single).not.toHaveProperty("document_seqs");
    expect(multi.document_seqs).toEqual([7, 9]);
  });

  it("falls back to plain facts source_ref when no provenance is supplied", async () => {
    queryNodesByCreator.mockResolvedValue([]);
    const { syncFactsToSemanticGraph } = await import("../../src/factsToSemanticGraph.js");
    const result = await syncFactsToSemanticGraph("scope-1", {
      claims: ["Claim A"],
      confidence: 0.9,
    });
    const claimRef = (appendNode.mock.calls[0][0] as { source_ref: Record<string, unknown> }).source_ref;
    expect(claimRef).toEqual({ source: "facts" });
    expect(result.nodesWithProvenance).toBe(0);
  });

  it("backfills provenance onto an existing node that lacks document_seq", async () => {
    const client = makeMockClient();
    runInTransaction.mockImplementation(async (fn: (c: unknown) => Promise<unknown>) => fn(client));
    queryNodesByCreator.mockImplementation(async (_s: string, _c: string, type?: string) => {
      if (type === "claim") return [makeNode({ node_id: "claim-1", content: "Claim A", confidence: 0.8, source_ref: {} })];
      return [];
    });
    const { syncFactsToSemanticGraph } = await import("../../src/factsToSemanticGraph.js");
    await syncFactsToSemanticGraph("scope-1", {
      claims: ["Claim A"],
      confidence: 0.9,
      provenance: { claims: [{ document_seq: 55 }] },
    });

    const enrichCall = client.query.mock.calls.find(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("source_ref = source_ref || $2::jsonb"),
    );
    expect(enrichCall).toBeTruthy();
    expect(JSON.parse((enrichCall![1] as unknown[])[1] as string)).toMatchObject({ document_seq: 55 });
  });
});
