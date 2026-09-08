-- B2-2：商品损坏或丢失时减少可卖库存，并保存本次消耗的成本。
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES collaboration_batches(id),
  product_id uuid NOT NULL REFERENCES products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  consumed_cost_tenths bigint NOT NULL CHECK (consumed_cost_tenths >= 0),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_adjustments_batch_product_idx ON inventory_adjustments(batch_id, product_id, created_at DESC);
