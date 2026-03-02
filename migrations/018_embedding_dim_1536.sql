-- Switch embedding dimension from 1024 (Ollama bge-m3) to 1536 (OpenAI text-embedding-3-small).
-- All existing embeddings are NULL so no data conversion needed.
ALTER TABLE nodes ALTER COLUMN embedding TYPE vector(1536);
