-- 商品组图片与工作区资源的有序关联；第一张图片作为商品组列表首图。
CREATE TABLE IF NOT EXISTS product_group_images (
  product_group_id uuid NOT NULL REFERENCES product_groups(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id),
  position integer NOT NULL CHECK (position BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_group_id, asset_id),
  UNIQUE (product_group_id, position)
);
CREATE INDEX IF NOT EXISTS product_group_images_asset_idx ON product_group_images(asset_id);
