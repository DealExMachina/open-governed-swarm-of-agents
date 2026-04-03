-- Stage 2 Phase 3: Propagation step metrics for ISS and audit.
CREATE TABLE IF NOT EXISTS propagation_history (
    id                   BIGSERIAL PRIMARY KEY,
    scope_id             TEXT NOT NULL,
    epoch                BIGINT NOT NULL,
    disagreement_before  FLOAT NOT NULL,
    disagreement_after   FLOAT NOT NULL,
    contraction_ratio    FLOAT NOT NULL,
    perturbation_norm    FLOAT NOT NULL,
    spectral_gap         FLOAT,
    rho                  FLOAT,
    practical_bound      FLOAT,
    small_gain_satisfied BOOLEAN,
    kappa                FLOAT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ph_scope ON propagation_history(scope_id, created_at DESC);
