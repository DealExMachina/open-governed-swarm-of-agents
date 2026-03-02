-- Track which WAL context_doc sequence triggered this convergence evaluation.
-- Enables partitioning history into intra-epoch (same context_seq) vs cross-epoch (context_seq changed).
ALTER TABLE convergence_history ADD COLUMN IF NOT EXISTS context_seq BIGINT;
