import { describe, it, expect, vi } from "vitest";

const query = vi.fn();
vi.mock("../../src/db.js", () => ({
  getPool: () => ({ query: (...args: unknown[]) => query(...args) }),
}));

import {
  readNodeProvenance,
  describeNodeProvenance,
  queryNodeIdsByDocumentSeq,
  listDocumentDerivedNodes,
  PROVENANCE_UNAVAILABLE_MESSAGE,
} from "../../src/documentProvenance.js";

describe("documentProvenance (issue #6)", () => {
  it("parses numeric and string document_seq and multi-source seqs", () => {
    const prov = readNodeProvenance({
      source: "facts",
      document_seq: "42",
      document_seqs: [42, "43", "x"],
      document_title: "doc.pdf",
      document_content_hash: "abc",
    });
    expect(prov).toEqual({
      document_seq: 42,
      document_seqs: [42, 43],
      document_title: "doc.pdf",
      document_content_hash: "abc",
    });
  });

  it("reports exact provenance when document_seq is present", () => {
    const desc = describeNodeProvenance({ source: "facts", document_seq: 7 });
    expect(desc.exact).toBe(true);
    expect(desc.document_seq).toBe(7);
    expect(desc.message).toBeUndefined();
  });

  it("surfaces the pre-migration sentinel when no document_seq (Option A)", () => {
    const desc = describeNodeProvenance({ source: "facts" });
    expect(desc.exact).toBe(false);
    expect(desc.message).toBe(PROVENANCE_UNAVAILABLE_MESSAGE);
  });

  it("reads resolution_seq provenance", () => {
    const prov = readNodeProvenance({
      source: "resolution",
      resolution_seq: 99,
    });
    expect(prov.resolution_seq).toBe(99);
  });

  it("lists nodes derived from a document seq", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          node_id: "c1",
          type: "claim",
          content: "claim text",
          source_ref: { document_seq: 7, document_title: "brief.pdf" },
        },
      ],
    });
    const nodes = await listDocumentDerivedNodes("deal-horizon", 7);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].provenance.exact).toBe(true);
    expect(nodes[0].provenance.document_seq).toBe(7);
  });

  it("queries nodes by document_seq including multi-source membership", async () => {
    query.mockResolvedValue({ rows: [{ node_id: "n1" }, { node_id: "n2" }] });
    const ids = await queryNodeIdsByDocumentSeq("scope-1", 42);
    expect(ids).toEqual(["n1", "n2"]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("source_ref->>'document_seq'");
    expect(sql).toContain("source_ref @> $3::jsonb");
    expect(params).toEqual([
      "scope-1",
      "42",
      JSON.stringify({ document_seqs: [42] }),
    ]);
  });
});
