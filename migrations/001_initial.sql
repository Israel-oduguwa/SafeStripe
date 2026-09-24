-- Append migrations; never edit a migration already applied in a deployed environment.
CREATE TABLE IF NOT EXISTS sf_operations (
  scope text NOT NULL,
  tenant_id text NOT NULL,
  operation_id text NOT NULL,
  kind text NOT NULL,
  fingerprint text NOT NULL,
  idempotency_key text NOT NULL,
  state text NOT NULL CHECK (state IN ('running','retry','succeeded','review')),
  resource_id text,
  token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempts integer NOT NULL DEFAULT 1,
  error_code text,
  PRIMARY KEY (scope, tenant_id, operation_id)
);

CREATE TABLE IF NOT EXISTS sf_jobs (
  queue text NOT NULL CHECK (queue IN ('webhook','outbox')),
  scope text NOT NULL,
  id text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','done','dead')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  error_code text,
  PRIMARY KEY (queue, scope, id)
);
CREATE INDEX IF NOT EXISTS sf_jobs_ready ON sf_jobs (queue, scope, available_at, created_at)
  WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS sf_jobs_abandoned ON sf_jobs (queue, scope, lease_until)
  WHERE state = 'running';

CREATE TABLE IF NOT EXISTS sf_effects (
  scope text NOT NULL,
  effect_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (scope, effect_key)
);

CREATE TABLE IF NOT EXISTS sf_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope text NOT NULL,
  subject_id text NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Generic projection storage; application tables can be updated in the same transaction.
CREATE TABLE IF NOT EXISTS sf_projections (
  scope text NOT NULL,
  resource_id text NOT NULL,
  payload jsonb NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (scope, resource_id)
);

CREATE TABLE IF NOT EXISTS sf_balance_transactions (
  scope text NOT NULL,
  id text NOT NULL,
  currency text NOT NULL,
  amount bigint NOT NULL,
  fee bigint NOT NULL,
  net bigint NOT NULL,
  stripe_created bigint NOT NULL,
  available_on bigint NOT NULL,
  status text NOT NULL,
  source_id text,
  type text NOT NULL,
  PRIMARY KEY (scope, id),
  CHECK (amount - fee = net)
);
