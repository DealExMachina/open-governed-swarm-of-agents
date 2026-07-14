-- Studio scope catalog (separate from control-plane `scopes` / `cp_scopes`).
-- On fresh installs migration 024 creates `scopes` with CP columns; the studio UI
-- expects catalog columns (name, tag, state, score, cycles).

CREATE TABLE IF NOT EXISTS studio_catalog_scopes (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  tag        TEXT NOT NULL DEFAULT 'custom',
  state      TEXT NOT NULL DEFAULT 'active',
  score      DOUBLE PRECISION NOT NULL DEFAULT 0,
  cycles     INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO studio_catalog_scopes (id, name, tag, state, score, cycles) VALUES
  ('deal-horizon', 'Deal Horizon', 'ma', 'active', 0, 0),
  ('green-bond-2026', 'Green Bond 2026', 'green-bond', 'active', 0, 0),
  ('default', 'Default', 'custom', 'active', 0, 0),
  ('insurance-review', 'Insurance Review', 'insurance', 'active', 0, 0)
ON CONFLICT (id) DO NOTHING;

-- Dashboard smoke expects a truthy `state` object for scope `default`.
INSERT INTO swarm_state (scope_id, run_id, last_node, epoch, updated_at)
VALUES ('default', '00000000-0000-4000-8000-000000000001', 'ContextIngested', 0, now())
ON CONFLICT (scope_id) DO NOTHING;
