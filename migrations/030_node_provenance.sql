-- Issue #6: Document -> claim provenance schema (precondition for HxF feuillets).
--
-- Facts-derived nodes now carry exact provenance in source_ref:
--   { source, document_seq, document_seqs[], document_title, document_content_hash }
-- Resolution-derived nodes carry:
--   { source: "resolution", resolution_seq }
--
-- source_ref is already JSONB NOT NULL DEFAULT '{}' (migration 005), so this is
-- purely additive at write time and needs no column change. This migration adds
-- the indexes required for the common provenance queries (impact analysis for
-- issue #5's lifecycle cascade, dedup detection, and content-hash blacklist).

-- Expression index for the canonical lookup: "which nodes came from document seq N?"
-- Uses the ->> text extraction so it matches queries written as source_ref->>'document_seq'.
CREATE INDEX IF NOT EXISTS idx_nodes_source_document_seq
  ON nodes ((source_ref->>'document_seq'))
  WHERE source_ref->>'document_seq' IS NOT NULL;

-- Expression index for content-hash operations (dedup / blacklist matching, issue #5).
CREATE INDEX IF NOT EXISTS idx_nodes_source_content_hash
  ON nodes ((source_ref->>'document_content_hash'))
  WHERE source_ref->>'document_content_hash' IS NOT NULL;

-- Expression index for resolution provenance lookups.
CREATE INDEX IF NOT EXISTS idx_nodes_source_resolution_seq
  ON nodes ((source_ref->>'resolution_seq'))
  WHERE source_ref->>'resolution_seq' IS NOT NULL;

-- General GIN index on source_ref for containment / multi-key queries, including
-- the document_seqs[] array membership checks used when a node has >1 source.
CREATE INDEX IF NOT EXISTS idx_nodes_source_ref_gin
  ON nodes USING GIN (source_ref jsonb_path_ops);
