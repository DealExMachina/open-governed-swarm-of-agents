-- LLM perturbation profiling samples.
-- Append-only table to capture epsilon statistics and model metadata per epoch.
CREATE TABLE IF NOT EXISTS e17_perturbation_profiles (
    id                 BIGSERIAL PRIMARY KEY,
    scope_id           TEXT NOT NULL,
    epoch              BIGINT NOT NULL,
    scenario_tag       TEXT,
    seed               BIGINT,
    model_provider     TEXT,
    model_id           TEXT,
    model_family       TEXT,
    temperature        FLOAT,
    top_p              FLOAT,
    epsilon_l2         FLOAT NOT NULL,
    epsilon_linf       FLOAT NOT NULL,
    per_role_l2        DOUBLE PRECISION[],
    support_l2         FLOAT,
    refutation_l2      FLOAT,
    prompt_hash        TEXT,
    input_hash         TEXT,
    output_hash        TEXT,
    metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_e17_scope_epoch
  ON e17_perturbation_profiles(scope_id, epoch);

CREATE INDEX IF NOT EXISTS idx_e17_model
  ON e17_perturbation_profiles(model_provider, model_id, created_at DESC);
