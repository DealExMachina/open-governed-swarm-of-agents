-- Split control-plane scopes from the legacy studio catalog (`scopes` table).
-- Migration 024 used CREATE TABLE IF NOT EXISTS and silently skipped when `scopes`
-- already existed with studio-catalog columns (name, tag, state, score, cycles).

CREATE TABLE IF NOT EXISTS cp_scopes (
  id              TEXT PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  slug            TEXT NOT NULL,
  display_name    TEXT,
  status          TEXT NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'active_processing', 'paused')),
  storage_prefix  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_cp_scopes_tenant ON cp_scopes (tenant_id);

-- CP document uploads reference cp_scopes only (empty until scopes are created via /v1/scopes).
ALTER TABLE scope_documents DROP CONSTRAINT IF EXISTS scope_documents_scope_id_fkey;
ALTER TABLE scope_documents
  ADD CONSTRAINT scope_documents_scope_id_fkey
  FOREIGN KEY (scope_id) REFERENCES cp_scopes (id) ON DELETE CASCADE;

-- Kernel/runtime scope ids are free-form (catalog ids, default, scp_*); drop restrictive FKs.
ALTER TABLE usage_events DROP CONSTRAINT IF EXISTS usage_events_scope_id_fkey;
ALTER TABLE usage_rollups DROP CONSTRAINT IF EXISTS usage_rollups_scope_id_fkey;
ALTER TABLE cluster_runtime_lease DROP CONSTRAINT IF EXISTS cluster_runtime_lease_active_scope_id_fkey;
