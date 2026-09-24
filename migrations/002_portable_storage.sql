CREATE TABLE IF NOT EXISTS sf_records (
  key text PRIMARY KEY,
  scope text NOT NULL,
  queue text NOT NULL,
  due_at double precision NOT NULL,
  record jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS sf_records_due ON sf_records(scope, queue, due_at, key);
