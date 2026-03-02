import { getPool } from "./db.js";

const EMBEDDING_DIM = 1536;
const EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * Get embedding via OpenAI text-embedding-3-small (1536-dim).
 * Falls back to empty array if OPENAI_API_KEY is not set or request fails.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || !text?.trim()) return [];

  try {
    const baseUrl = (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
    const res = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: text.trim().slice(0, 8000),
        model: process.env.EMBEDDING_MODEL?.trim() || EMBEDDING_MODEL,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const vec = data.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length === 0) return [];
    return vec;
  } catch {
    return [];
  }
}

/** Cosine similarity between two vectors. Returns 0 if inputs are invalid. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

export function getEmbeddingDim(): number {
  return EMBEDDING_DIM;
}

/**
 * Update a node's embedding column.
 * Accepts any dimension (pgvector handles type checking).
 */
export async function updateNodeEmbedding(
  nodeId: string,
  _scopeId: string,
  embedding: number[],
): Promise<void> {
  if (embedding.length === 0) return;
  try {
    const pool = getPool();
    const vec = `[${embedding.join(",")}]`;
    await pool.query(
      `UPDATE nodes SET embedding = $2::vector, updated_at = now() WHERE node_id = $1`,
      [nodeId, vec],
    );
  } catch {
    // Table or extension may not exist yet
  }
}

/**
 * Embed text and persist to a node. Idempotent.
 */
export async function embedAndPersistNode(nodeId: string, scopeId: string, content: string): Promise<boolean> {
  const vec = await getEmbedding(content);
  if (vec.length === 0) return false;
  await updateNodeEmbedding(nodeId, scopeId, vec);
  return true;
}

/**
 * Batch-embed contents. Does not persist -- caller writes embeddings.
 */
export async function getEmbeddingBatch(
  items: { nodeId: string; content: string }[],
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  for (const { nodeId, content } of items) {
    const vec = await getEmbedding(content);
    if (vec.length > 0) out.set(nodeId, vec);
  }
  return out;
}
