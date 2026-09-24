CREATE TABLE IF NOT EXISTS sf_demo_orders (
  scope text NOT NULL,
  order_id text NOT NULL,
  tenant_id text NOT NULL,
  customer_id text NOT NULL,
  price_id text NOT NULL,
  mode text NOT NULL CHECK(mode IN ('payment','subscription')),
  session_id text,
  state text NOT NULL DEFAULT 'pending',
  PRIMARY KEY(scope,order_id),
  UNIQUE(scope,session_id)
);
