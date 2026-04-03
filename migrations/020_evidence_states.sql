-- Stage 2 Phase 3: Evidence state snapshots per scope/epoch/role.
CREATE TABLE IF NOT EXISTS evidence_states (
    id         BIGSERIAL PRIMARY KEY,
    scope_id   TEXT NOT NULL,
    epoch      BIGINT NOT NULL,
    role_id    TEXT NOT NULL,
    support    FLOAT[] NOT NULL,
    refutation FLOAT[] NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_es_scope_epoch ON evidence_states(scope_id, epoch DESC);
