-- 快速售出：允许一笔成交包含多个自由商品行，并可按数量关联既有库存。
CREATE TABLE IF NOT EXISTS quick_sales (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES collaboration_batches(id),
  total_price_cents bigint NOT NULL CHECK (total_price_cents >= 0),
  sales_channel text,
  fee_mode text CHECK (fee_mode IN ('percentage','amount')),
  fee_rate_basis_points integer CHECK (fee_rate_basis_points BETWEEN 0 AND 10000),
  service_fee_cents bigint NOT NULL DEFAULT 0 CHECK (service_fee_cents >= 0),
  seller_user_id uuid NOT NULL REFERENCES users(id),
  occurred_at timestamptz NOT NULL,
  note text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quick_sales_batch_occurred_idx ON quick_sales(batch_id, occurred_at DESC, created_at DESC);

-- 快速售出商品行：名称和结算成本均为本次交易快照，不要求存在商品目录。
CREATE TABLE IF NOT EXISTS quick_sale_items (
  id uuid PRIMARY KEY,
  quick_sale_id uuid NOT NULL REFERENCES quick_sales(id),
  position integer NOT NULL CHECK (position >= 0),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  cost_cents bigint NOT NULL CHECK (cost_cents >= 0),
  UNIQUE (quick_sale_id, position)
);

-- 商品行关联的旧库存及其按成本账本计算出的实际库存消耗成本。
CREATE TABLE IF NOT EXISTS quick_sale_inventory_consumptions (
  id uuid PRIMARY KEY,
  quick_sale_item_id uuid NOT NULL REFERENCES quick_sale_items(id),
  product_id uuid NOT NULL REFERENCES products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  consumed_cost_cents bigint NOT NULL DEFAULT 0 CHECK (consumed_cost_cents >= 0),
  UNIQUE (quick_sale_item_id, product_id)
);
CREATE INDEX IF NOT EXISTS quick_sale_inventory_consumptions_product_idx ON quick_sale_inventory_consumptions(product_id);

-- 关联库存成本的付款/承担来源，用于把用户输入的本单成本按原库存来源分摊到结算成员。
CREATE TABLE IF NOT EXISTS quick_sale_inventory_cost_allocations (
  consumption_id uuid NOT NULL REFERENCES quick_sale_inventory_consumptions(id),
  allocation_type text NOT NULL CHECK (allocation_type IN ('payer','burden')),
  user_id uuid NOT NULL REFERENCES users(id),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  PRIMARY KEY (consumption_id, allocation_type, user_id)
);

-- 快速售出实际用于结算的本单成本分摊；总额等于所有商品行 cost_cents 之和。
CREATE TABLE IF NOT EXISTS quick_sale_cost_allocations (
  quick_sale_id uuid NOT NULL REFERENCES quick_sales(id),
  allocation_type text NOT NULL CHECK (allocation_type IN ('payer','burden')),
  user_id uuid NOT NULL REFERENCES users(id),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  PRIMARY KEY (quick_sale_id, allocation_type, user_id)
);

-- 撤销不删除快速售出原记录，保留原因和操作人。
CREATE TABLE IF NOT EXISTS quick_sale_reversals (
  quick_sale_id uuid PRIMARY KEY REFERENCES quick_sales(id),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 费用可以关联普通销售或快速售出，但不能同时关联两种交易。
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS quick_sale_id uuid REFERENCES quick_sales(id);
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_one_transaction_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_one_transaction_check CHECK (sale_id IS NULL OR quick_sale_id IS NULL);
CREATE INDEX IF NOT EXISTS expenses_quick_sale_idx ON expenses(quick_sale_id);
ALTER TABLE settlement_bill_expenses ADD COLUMN IF NOT EXISTS quick_sale_id uuid;

-- 已确认账单中的快速售出不可变快照；唯一约束避免同一单重复结算。
CREATE TABLE IF NOT EXISTS settlement_bill_quick_sales (
  settlement_bill_id uuid NOT NULL REFERENCES settlement_bills(id),
  quick_sale_id uuid NOT NULL REFERENCES quick_sales(id),
  item_summary text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  total_price_cents bigint NOT NULL,
  consumed_cost_cents bigint NOT NULL,
  service_fee_cents bigint NOT NULL,
  seller_user_id uuid NOT NULL REFERENCES users(id),
  seller_username text NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (settlement_bill_id, quick_sale_id),
  UNIQUE (quick_sale_id)
);
CREATE INDEX IF NOT EXISTS settlement_bill_quick_sales_bill_idx ON settlement_bill_quick_sales(settlement_bill_id);
