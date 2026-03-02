import { describe, it, expect, vi, afterEach } from "vitest";
import { isResolvedViaService } from "../../src/resolutionMcp";
import { cosineSimilarity } from "../../src/embeddingPipeline";

describe("resolutionMcp", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("isResolvedViaService", () => {
    it("returns false when MCP server is unreachable", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
      const result = await isResolvedViaService("some contradiction");
      expect(result).toBe(false);
    });

    it("returns true when MCP responds resolved", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ resolved: true, similarity: 0.85 }),
      }));
      const result = await isResolvedViaService("ARR was overstated");
      expect(result).toBe(true);
    });

    it("returns false when MCP responds not resolved", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ resolved: false, similarity: 0.2 }),
      }));
      const result = await isResolvedViaService("brand new contradiction");
      expect(result).toBe(false);
    });

    it("returns false on non-200 response", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
      const result = await isResolvedViaService("test");
      expect(result).toBe(false);
    });
  });

  describe("cosineSimilarity integration", () => {
    it("high similarity between paraphrases (pre-computed vectors)", () => {
      // Simulate: "ARR was 50M" and "Revenue was reported at 50 million"
      // These would have high cosine similarity from OpenAI embeddings
      // Here we test the math with synthetic near-identical vectors
      const base = Array.from({ length: 10 }, (_, i) => Math.sin(i));
      const paraphrase = base.map((v, i) => v + (i % 3 === 0 ? 0.05 : 0));
      const unrelated = Array.from({ length: 10 }, (_, i) => Math.cos(i * 3));

      const simParaphrase = cosineSimilarity(base, paraphrase);
      const simUnrelated = cosineSimilarity(base, unrelated);

      expect(simParaphrase).toBeGreaterThan(0.95);
      expect(simUnrelated).toBeLessThan(0.5);
      expect(simParaphrase).toBeGreaterThan(simUnrelated);
    });
  });
});
