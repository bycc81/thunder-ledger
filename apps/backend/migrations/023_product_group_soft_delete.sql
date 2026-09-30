-- 商品组软删除：保留商品组上架及其款式的采购、库存、销售、快速售出历史快照。
ALTER TABLE product_groups ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS product_groups_workspace_active_created_idx ON product_groups(workspace_id, created_at DESC) WHERE deleted_at IS NULL;
