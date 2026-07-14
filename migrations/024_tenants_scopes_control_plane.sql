-- Tenants, API keys, scopes (id TEXT aligns with swarm_state / nodes scope_id), usage, cluster lease.

CREATE TABLE IF NOT EXISTS tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  key_hash     TEXT NOT NULL,
  key_prefix   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ,
  UNIQUE (key_hash)
);

CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_tenant ON tenant_api_keys (tenant_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS scopes (
  id              TEXT PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  slug            TEXT NOT NULL,
  display_name    TEXT,
  status          TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'active_processing', 'paused')),
  storage_prefix  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_scopes_tenant ON scopes (tenant_id);

CREATE TABLE IF NOT EXISTS scope_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id      TEXT NOT NULL REFERENCES scopes (id) ON DELETE CASCADE,
  object_key    TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  content_hash  TEXT,
  meta          JSONB NOT NULL DEFAULT '{}',
  ingested_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope_id, object_key)
);

CREATE INDEX IF NOT EXISTS idx_scope_documents_scope ON scope_documents (scope_id);

CREATE TABLE IF NOT EXISTS usage_events (
  id             BIGSERIAL PRIMARY KEY,
  tenant_id      UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  scope_id       TEXT NOT NULL REFERENCES scopes (id) ON DELETE CASCADE,
  role           TEXT NOT NULL,
  model          TEXT,
  input_tokens   INT NOT NULL DEFAULT 0,
  output_tokens  INT NOT NULL DEFAULT 0,
  ts             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_scope_ts ON usage_events (scope_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_ts ON usage_events (tenant_id, ts DESC);

CREATE TABLE IF NOT EXISTS usage_rollups (
  id               BIGSERIAL PRIMARY KEY,
  tenant_id        UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  scope_id         TEXT NOT NULL REFERENCES scopes (id) ON DELETE CASCADE,
  period_start     TIMESTAMPTZ NOT NULL,
  period_end       TIMESTAMPTZ NOT NULL,
  input_tokens     BIGINT NOT NULL DEFAULT 0,
  output_tokens    BIGINT NOT NULL DEFAULT 0,
  llm_calls        BIGINT NOT NULL DEFAULT 0,
  last_goal_score  DOUBLE PRECISION,
  last_lyapunov_v  DOUBLE PRECISION,
  goal_score_delta DOUBLE PRECISION,
  lyapunov_delta   DOUBLE PRECISION,
  epochs_recorded  INT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_usage_rollups_scope ON usage_rollups (scope_id, period_end DESC);

CREATE TABLE IF NOT EXISTS cluster_runtime_lease (
  id                 SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  active_scope_id    TEXT REFERENCES scopes (id) ON DELETE SET NULL,
  active_tenant_id   UUID REFERENCES tenants (id) ON DELETE SET NULL,
  paused             BOOLEAN NOT NULL DEFAULT false,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO cluster_runtime_lease (id) VALUES (1) ON CONFLICT DO NOTHING;
