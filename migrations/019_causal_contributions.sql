-- Causal contribution layer.
-- Content-addressed DAG of contributions; rid = SHA-256(CBOR(parents, payload, kind)).
CREATE TABLE IF NOT EXISTS causal_contributions (
    rid              TEXT PRIMARY KEY,
    scope_id         TEXT NOT NULL,
    parents          TEXT[] NOT NULL DEFAULT '{}',
    payload          JSONB NOT NULL,
    kind             TEXT NOT NULL,
    role_id          TEXT NOT NULL,
    authority_tier   SMALLINT NOT NULL DEFAULT 0,
    governance_mode  TEXT NOT NULL DEFAULT 'YOLO',
    valid_from       TIMESTAMPTZ,
    valid_to         TIMESTAMPTZ,
    transaction_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cc_scope ON causal_contributions(scope_id);
CREATE INDEX IF NOT EXISTS idx_cc_parents ON causal_contributions USING GIN(parents);
CREATE INDEX IF NOT EXISTS idx_cc_kind ON causal_contributions(scope_id, kind);
CREATE INDEX IF NOT EXISTS idx_cc_created ON causal_contributions(scope_id, created_at DESC);
