-- 业务发生时固定商品展示名称，商品资料后续编辑不回写历史采购、库存和上架记录。
ALTER TABLE inventory_purchases ADD COLUMN IF NOT EXISTS product_name_snapshot text;
ALTER TABLE inventory_purchases ADD COLUMN IF NOT EXISTS product_group_name_snapshot text;
ALTER TABLE inventory_purchases ADD COLUMN IF NOT EXISTS variant_name_snapshot text;

ALTER TABLE listings ADD COLUMN IF NOT EXISTS product_name_snapshot text;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS product_group_name_snapshot text;
ALTER TABLE listing_variants ADD COLUMN IF NOT EXISTS variant_name_snapshot text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS product_name_snapshot text;

-- 为已有记录建立迁移时的名称基线；之后的商品资料修改不再改变其展示名。
UPDATE inventory_purchases ip
SET product_name_snapshot = p.name,
    product_group_name_snapshot = g.name,
    variant_name_snapshot = p.variant_name
FROM products p LEFT JOIN product_groups g ON g.id=p.group_id
WHERE ip.product_id=p.id AND ip.product_name_snapshot IS NULL;

UPDATE listings l
SET product_name_snapshot = p.name,
    product_group_name_snapshot = g.name
FROM products p LEFT JOIN product_groups g ON g.id=p.group_id
WHERE l.product_id=p.id AND l.product_name_snapshot IS NULL;

UPDATE listings l
SET product_group_name_snapshot = g.name
FROM product_groups g
WHERE l.product_group_id=g.id AND l.product_group_name_snapshot IS NULL;

UPDATE listing_variants lv
SET variant_name_snapshot = p.variant_name
FROM products p
WHERE lv.product_id=p.id AND lv.variant_name_snapshot IS NULL;

UPDATE sales s
SET product_name_snapshot = p.name
FROM products p
WHERE s.product_id=p.id AND s.product_name_snapshot IS NULL;
