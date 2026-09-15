-- B4.2：采购采用精确发生时间；销售成本构成可由商品移动平均成本流水重建。
ALTER TABLE inventory_purchases ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
UPDATE inventory_purchases SET occurred_at = (purchased_on::timestamp AT TIME ZONE 'Asia/Shanghai') WHERE occurred_at IS NULL;
ALTER TABLE inventory_purchases ALTER COLUMN occurred_at SET NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_purchases_batch_product_occurred_idx ON inventory_purchases(batch_id, product_id, occurred_at, created_at);

CREATE TABLE IF NOT EXISTS sale_cost_allocations (
  sale_id uuid NOT NULL REFERENCES sales(id),
  allocation_type text NOT NULL CHECK (allocation_type IN ('payer','burden')),
  user_id uuid NOT NULL REFERENCES users(id),
  amount_tenths bigint NOT NULL CHECK (amount_tenths >= 0),
  PRIMARY KEY (sale_id, allocation_type, user_id)
);
