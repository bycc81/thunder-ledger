-- 未关联库存的快速售出商品行，显式记录实际付款人与成本承担分摊。
-- 按行持久化，采购更正重建时保留手动来源；历史单据不回填。
CREATE TABLE IF NOT EXISTS quick_sale_item_cost_allocations (
  quick_sale_item_id uuid NOT NULL REFERENCES quick_sale_items(id),
  allocation_type text NOT NULL CHECK (allocation_type IN ('payer','burden')),
  user_id uuid NOT NULL REFERENCES users(id),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  PRIMARY KEY (quick_sale_item_id, allocation_type, user_id)
);
COMMENT ON TABLE quick_sale_item_cost_allocations IS '快速售出未关联库存商品行的手动付款和成本承担来源';
COMMENT ON COLUMN quick_sale_item_cost_allocations.quick_sale_item_id IS '所属快速售出商品行';
COMMENT ON COLUMN quick_sale_item_cost_allocations.allocation_type IS 'payer 为实际付款，burden 为成本承担';
COMMENT ON COLUMN quick_sale_item_cost_allocations.user_id IS '实际付款或承担成本的批次成员';
COMMENT ON COLUMN quick_sale_item_cost_allocations.amount_cents IS '分配金额，整数分，可为零';
