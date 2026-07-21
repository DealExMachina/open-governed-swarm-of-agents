/**
 * Ollama embedding helpers for benchmark free_text semantic equivalence (Couche 2).
 *
 * Uses the native Ollama `/api/embeddings` endpoint so comparative benchmarks can
 * score claim pairs locally without an OpenAI key. Reuses cosineSimilarity from
 * the shared embedding pipeline.
 */

import { cosineSimilarity } from "../../embeddingPipeline.js";

export { cosineSimilarity };

/**
 * Embed a batch of texts via Ollama. Returns one vector per input; empty arrays
 * are omitted on per-text failure so callers can detect partial results.
 */
export async function embedTexts(
  texts: string[],
  ollamaBaseUrl: string,
  model: string,
): Promise<number[][]> {
  const base = ollamaBaseUrl.replace(/\/+$/, "");
  if (!base || !model?.trim() || texts.length === 0) return [];

  const out: number[][] = [];
  for (const text of texts) {
    if (!text?.trim()) {
      out.push([]);
      continue;
    }
    try {
      const resp = await fetch(`${base}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, prompt: text.trim().slice(0, 8000) }),
      });
      if (!resp.ok) {
        out.push([]);
        continue;
      }
      const data = (await resp.json()) as { embedding?: number[] };
      const vec = data.embedding;
      out.push(Array.isArray(vec) && vec.length > 0 ? vec : []);
    } catch {
      out.push([]);
    }
  }
  return out;
}
