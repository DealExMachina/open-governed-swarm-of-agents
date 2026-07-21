import { describe, it, expect, vi } from "vitest";
import { recordEquivalenceInGraph, type EquivalenceTraceInput } from "../../src/equivalenceTrace.js";

function makeFakeClient() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    if (/INSERT INTO nodes/.test(sql)) return { rows: [{ node_id: "ent-1" }], rowCount: 1 };
    if (/INSERT INTO edges/.test(sql)) return { rows: [{ edge_id: "edge-1" }], rowCount: 1 };
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
  it("writes an entailment node and an equivalent_to edge", async () => {
    const { client, calls } = makeFakeClient();
    const result = await recordEquivalenceInGraph(input, client);

    expect(result).toEqual({ entailment_node_id: "ent-1", edge_id: "edge-1" });

    const nodeCall = calls.find((c) => /INSERT INTO nodes/.test(c.sql));
    expect(nodeCall).toBeTruthy();
    // node type is "entailment"
    expect(nodeCall!.params).toContain("entailment");
    // content records the equivalence
    expect(String(nodeCall!.params[2])).toContain("≡");

    const edgeCall = calls.find((c) => /INSERT INTO edges/.test(c.sql));
    expect(edgeCall).toBeTruthy();
    expect(edgeCall!.params).toContain("equivalent_to");
    // edge links the surviving node -> entailment node
    expect(edgeCall!.params).toContain("node-1");
    expect(edgeCall!.params).toContain("ent-1");
  });

  it("stamps decision_id and policy_version into node metadata for audit", async () => {
    const { client, calls } = makeFakeClient();
    await recordEquivalenceInGraph(input, client);
    const nodeCall = calls.find((c) => /INSERT INTO nodes/.test(c.sql))!;
    const metaParam = nodeCall.params.find(
      (p) => typeof p === "string" && p.includes("policy_version"),
    ) as string;
    expect(metaParam).toBeTruthy();
    const meta = JSON.parse(metaParam);
    expect(meta.decision_id).toBe("dec-1");
    expect(meta.policy_version).toBe("pv-1");
    expect(meta.nli_confidence).toBe(0.88);
  });
});
