-- Delta billing demo: net-new billable delta ledger + local metering simulator.
--
-- Deltas (net-new material evidence changes) are the billable currency. This
-- migration adds:
--   * delta_events         - append-only ledger of net-new (billable) deltas
--   * billed_delta_snapshot - last-billed value per (scope, role, dim, channel)
--                             used to compute net-new and prevent double-counting
--   * tenant_subscriptions - per-tenant prepaid plan + overage rate
--   * metering_events      - one idempotent row per billed delta (prepaid/overage split)
--
-- scope_id is free-form (kernel/runtime scope ids: catalog ids, default, scp_*,
-- bill_*), consistent with usage_events after migration 026 dropped scope FKs.

CREATE TABLE IF NOT EXISTS delta_events (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    UUID REFERENCES tenants (id) ON DELETE SET NULL,
  scope_id     TEXT NOT NULL,
  epoch        INT NOT NULL,
  role         TEXT NOT NULL,
  dimension    TEXT NOT NULL,
  channel      TEXT NOT NULL,
  value        DOUBLE PRECISION NOT NULL,
  weight       INT NOT NULL DEFAULT 1,
  v_from       TIMESTAMPTZ,
  v_to         TIMESTAMPTZ,
  t_time       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One billable delta per (scope, epoch, role, dimension, channel): re-processing
  -- the same epoch is a no-op (ON CONFLICT DO NOTHING at the call site).
  UNIQUE (scope_id, epoch, role, dimension, channel)
);

CREATE INDEX IF NOT EXISTS idx_delta_events_tenant_ts ON delta_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delta_events_scope_ts ON delta_events (scope_id, created_at DESC);

CREATE TABLE IF NOT EXISTS billed_delta_snapshot (
  scope_id    TEXT NOT NULL,
  role        TEXT NOT NULL,
  dimension   TEXT NOT NULL,
  channel     TEXT NOT NULL,
  value       DOUBLE PRECISION NOT NULL,
  epoch       INT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_id, role, dimension, channel)
);

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  tenant_id          UUID PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  plan_name          TEXT NOT NULL,
  prepaid_tokens     BIGINT NOT NULL DEFAULT 0,
  overage_rate_cents INT NOT NULL DEFAULT 0,
  period_start       TIMESTAMPTZ NOT NULL DEFAULT now(),
  period_end         TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS metering_events (
  id              BIGSERIAL PRIMARY KEY,
  delta_event_id  BIGINT NOT NULL UNIQUE REFERENCES delta_events (id) ON DELETE CASCADE,
  tenant_id       UUID REFERENCES tenants (id) ON DELETE SET NULL,
  scope_id        TEXT NOT NULL,
  tokens          INT NOT NULL DEFAULT 1,
  prepaid_applied INT NOT NULL DEFAULT 0,
  overage_applied INT NOT NULL DEFAULT 0,
  overage_cents   INT NOT NULL DEFAULT 0,
  billed_against  TEXT NOT NULL CHECK (billed_against IN ('prepaid', 'overage')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_metering_events_tenant ON metering_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_metering_events_scope ON metering_events (scope_id, created_at DESC);
