import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  recordEquivalenceInGraph,
  type EquivalenceTraceInput,
} from "../../src/equivalenceTrace.js";

const updateNodeContent = vi.fn(async () => {});
const appendNode = vi.fn(async () => "ent-1");
const appendEdge = vi.fn(async () => "edge-1");

vi.mock("../../src/semanticGraph.js", () => ({
  appendNode: (...args: unknown[]) => appendNode(...args),
  appendEdge: (...args: unknown[]) => appendEdge(...args),
  updateNodeContent: (...args: unknown[]) => updateNodeContent(...args),
}));

vi.mock("../../src/db.js", () => ({
  runInTransaction: async (fn: (c: unknown) => Promise<unknown>) =>
    fn(makeFakeClient().client),
}));

function makeFakeClient(existingRows: Array<Record<string, unknown>> = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    if (/SELECT e\.edge_id, n\.node_id AS entailment_node_id/.test(sql)) {
      return { rows: existingRows, rowCount: existingRows.length };
    }
    if (/INSERT INTO nodes/.test(sql))
      return { rows: [{ node_id: "ent-1" }], rowCount: 1 };
    if (/INSERT INTO edges/.test(sql))
      return { rows: [{ edge_id: "edge-1" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  return { client: { query } as any, calls };
}

const input: EquivalenceTraceInput = {
  scope_id: "s1",
  node_type: "claim",
  existing_node_id: "node-1",
  a: "ARR is €50M",
  b: "annual recurring revenue of fifty million euros",
  nli_label: "equivalent",
  nli_confidence: 0.88,
  decision_id: "dec-1",
  policy_version: "pv-1",
};

describe("equivalenceTrace.recordEquivalenceInGraph", () => {
  beforeEach(() => {
    updateNodeContent.mockClear();
    appendNode.mockClear();
    appendEdge.mockClear();
  });

  it("writes an entailment node and an equivalent_to edge", async () => {
    const { client } = makeFakeClient();
    const result = await recordEquivalenceInGraph(input, client);

    expect(result).toEqual({ entailment_node_id: "ent-1", edge_id: "edge-1" });
    expect(updateNodeContent).toHaveBeenCalledWith(
      "node-1",
      expect.any(String),
      client,
    );
    expect(appendNode).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "entailment",
        content: expect.stringContaining("≡"),
      }),
      client,
    );
    expect(appendEdge).toHaveBeenCalledWith(
      expect.objectContaining({
        source_id: "node-1",
        target_id: "ent-1",
        edge_type: "equivalent_to",
      }),
      client,
    );
  });

  it("stamps decision_id and policy_version into node metadata for audit", async () => {
    const { client } = makeFakeClient();
    await recordEquivalenceInGraph(input, client);
    const nodeInput = appendNode.mock.calls[0]?.[0] as {
      metadata: Record<string, unknown>;
    };
    expect(nodeInput.metadata.decision_id).toBe("dec-1");
    expect(nodeInput.metadata.policy_version).toBe("pv-1");
    expect(nodeInput.metadata.nli_confidence).toBe(0.88);
  });

  it("skips duplicate entailment when the same pair was already traced", async () => {
    const existingRows = [
      {
        edge_id: "edge-existing",
        entailment_node_id: "ent-existing",
        metadata: {
          a: input.a,
          b: input.b,
        },
      },
    ];
    const { client, calls } = makeFakeClient(existingRows);
    const result = await recordEquivalenceInGraph(input, client);

    expect(result).toEqual({
      entailment_node_id: "ent-existing",
      edge_id: "edge-existing",
    });
    expect(updateNodeContent).toHaveBeenCalledTimes(1);
    expect(appendNode).not.toHaveBeenCalled();
    expect(appendEdge).not.toHaveBeenCalled();
  });
});
