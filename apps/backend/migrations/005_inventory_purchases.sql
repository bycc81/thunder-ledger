-- B2-1：工作区手工采购渠道、批次采购记录与采购成本承担。
CREATE TABLE IF NOT EXISTS manual_channels (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS manual_channels_workspace_name_unique ON manual_channels(workspace_id, lower(name));

CREATE TABLE IF NOT EXISTS inventory_purchases (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES collaboration_batches(id),
  product_id uuid NOT NULL REFERENCES products(id),
  channel_id uuid NOT NULL REFERENCES manual_channels(id),
  payer_user_id uuid NOT NULL REFERENCES users(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  total_cost_tenths bigint NOT NULL CHECK (total_cost_tenths >= 0),
  purchased_on date NOT NULL,
  source_url text,
  note text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_purchases_batch_product_idx ON inventory_purchases(batch_id, product_id, purchased_on DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_cost_shares (
  purchase_id uuid NOT NULL REFERENCES inventory_purchases(id),
  user_id uuid NOT NULL REFERENCES users(id),
  amount_tenths bigint NOT NULL CHECK (amount_tenths >= 0),
  PRIMARY KEY (purchase_id, user_id)
);
