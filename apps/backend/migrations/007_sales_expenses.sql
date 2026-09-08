-- B3：手工上架、销售、费用与撤销记录；原记录不删除，撤销另行保留原因。
CREATE TABLE IF NOT EXISTS listings (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES collaboration_batches(id),
  product_id uuid NOT NULL REFERENCES products(id),
  channel_id uuid NOT NULL REFERENCES manual_channels(id),
  external_url text NOT NULL CHECK (length(trim(external_url)) > 0),
  display_price_tenths bigint CHECK (display_price_tenths >= 0),
  status text NOT NULL CHECK (status IN ('listed', 'unlisted')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listings_batch_updated_idx ON listings(batch_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS listing_status_events (
  id uuid PRIMARY KEY,
  listing_id uuid NOT NULL REFERENCES listings(id),
  status text NOT NULL CHECK (status IN ('listed', 'unlisted')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listing_status_events_listing_idx ON listing_status_events(listing_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES collaboration_batches(id),
  product_id uuid NOT NULL REFERENCES products(id),
  listing_id uuid REFERENCES listings(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  total_price_tenths bigint NOT NULL CHECK (total_price_tenths >= 0),
  consumed_cost_tenths bigint NOT NULL CHECK (consumed_cost_tenths >= 0),
  seller_user_id uuid NOT NULL REFERENCES users(id),
  occurred_at timestamptz NOT NULL,
  note text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_batch_occurred_idx ON sales(batch_id, occurred_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_batch_product_idx ON sales(batch_id, product_id);

CREATE TABLE IF NOT EXISTS sale_reversals (
  sale_id uuid PRIMARY KEY REFERENCES sales(id),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES collaboration_batches(id),
  sale_id uuid REFERENCES sales(id),
  type text NOT NULL CHECK (type IN ('shipping', 'custom')),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  amount_tenths bigint NOT NULL CHECK (amount_tenths >= 0),
  payer_user_id uuid NOT NULL REFERENCES users(id),
  occurred_at timestamptz NOT NULL,
  note text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expenses_batch_occurred_idx ON expenses(batch_id, occurred_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS expense_reversals (
  expense_id uuid PRIMARY KEY REFERENCES expenses(id),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
