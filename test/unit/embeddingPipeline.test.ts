import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getEmbedding,
  cosineSimilarity,
  getEmbeddingDim,
  updateNodeEmbedding,
  getEmbeddingBatch,
  embedAndPersistNode,
} from "../../src/embeddingPipeline";

const EMBEDDING_DIM = 1536;

function makeVec(dim: number = EMBEDDING_DIM): number[] {
  return Array.from({ length: dim }, (_, i) => (i * 0.001) % 1);
}

describe("embeddingPipeline", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("getEmbedding", () => {
    it("returns empty array when OPENAI_API_KEY is unset", async () => {
      const out = await getEmbedding("hello");
      expect(out).toEqual([]);
    });

    it("returns empty array when text is blank", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-test");
      const out = await getEmbedding("   ");
      expect(out).toEqual([]);
    });

    it("returns empty array when fetch fails", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-test");
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
      const out = await getEmbedding("hello");
      expect(out).toEqual([]);
    });

    it("returns empty array when response is not ok", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-test");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
      const out = await getEmbedding("hello");
      expect(out).toEqual([]);
    });

    it("returns embedding vector from OpenAI response", async () => {
      const vec = makeVec();
      vi.stubEnv("OPENAI_API_KEY", "sk-test");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: vec }] }),
      }));
      const out = await getEmbedding("hello");
      expect(out).toEqual(vec);
      expect(out.length).toBe(EMBEDDING_DIM);
    });

    it("returns empty array when response has no data", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-test");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      }));
      const out = await getEmbedding("hello");
      expect(out).toEqual([]);
    });
  });

  describe("cosineSimilarity", () => {
    it("returns 1 for identical vectors", () => {
      const v = [1, 2, 3];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
    });

    it("returns 0 for orthogonal vectors", () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
    });

    it("returns ~0.5 for 45-degree vectors", () => {
      const sim = cosineSimilarity([1, 0, 0], [1, 1, 0]);
      expect(sim).toBeCloseTo(0.707, 2);
    });

    it("returns 0 for empty vectors", () => {
      expect(cosineSimilarity([], [])).toBe(0);
    });

    it("returns 0 for mismatched dimensions", () => {
      expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    });
  });

  describe("getEmbeddingDim", () => {
    it("returns 1536", () => {
      expect(getEmbeddingDim()).toBe(1536);
    });
  });

  describe("updateNodeEmbedding", () => {
    it("no-ops when embedding is empty", async () => {
      await expect(updateNodeEmbedding("n1", "s1", [])).resolves.not.toThrow();
    });
  });

  describe("embedAndPersistNode", () => {
    it("returns false when embedding is unavailable", async () => {
      const ok = await embedAndPersistNode("n1", "s1", "text");
      expect(ok).toBe(false);
    });
  });

  describe("getEmbeddingBatch", () => {
    it("returns empty map when no API key", async () => {
      const result = await getEmbeddingBatch([{ nodeId: "n1", content: "text" }]);
      expect(result.size).toBe(0);
    });
  });
});
