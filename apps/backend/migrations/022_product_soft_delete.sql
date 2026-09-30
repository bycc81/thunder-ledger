-- 商品目录软删除：保留库存、上架、销售和快速售出等历史外键及快照，删除后不再出现在商品目录和新建交易选择中。
ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS products_workspace_active_created_idx ON products(workspace_id, created_at DESC) WHERE deleted_at IS NULL;

-- 已删除款式不占用同商品组内的名称，允许后续创建同名新款式。
DROP INDEX IF EXISTS products_group_variant_unique;
CREATE UNIQUE INDEX IF NOT EXISTS products_group_variant_unique ON products(group_id, lower(variant_name)) WHERE group_id IS NOT NULL AND variant_name IS NOT NULL AND deleted_at IS NULL;
