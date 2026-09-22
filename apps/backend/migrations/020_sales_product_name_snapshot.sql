-- 补齐销售发生时的商品名称快照，避免后续编辑商品资料改变交易和结算中的历史名称。
ALTER TABLE sales ADD COLUMN IF NOT EXISTS product_name_snapshot text;

-- 为既有销售记录建立当前迁移时的名称基线；新的销售会在写入时保存快照。
UPDATE sales s
SET product_name_snapshot = p.name
FROM products p
WHERE s.product_id = p.id
  AND s.product_name_snapshot IS NULL;
