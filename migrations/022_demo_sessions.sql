CREATE TABLE IF NOT EXISTS demo_sessions (
  session_id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_demo_sessions_scope_created
  ON demo_sessions (scope_id, created_at DESC);

