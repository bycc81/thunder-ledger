-- L2 商品组与款式：上架可合并展示，账务仍按独立 product_id 计算。
CREATE TABLE IF NOT EXISTS product_groups (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  description text,
  reference_price numeric(12,2) CHECK (reference_price >= 0),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_groups_workspace_created_idx ON product_groups(workspace_id, created_at DESC);

ALTER TABLE products ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES product_groups(id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_name text;
CREATE UNIQUE INDEX IF NOT EXISTS products_group_variant_unique ON products(group_id, lower(variant_name)) WHERE group_id IS NOT NULL AND variant_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_group_idx ON products(group_id);

ALTER TABLE listings ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS product_group_id uuid REFERENCES product_groups(id);
ALTER TABLE listings ADD CONSTRAINT listings_one_target_check CHECK ((product_id IS NOT NULL) <> (product_group_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS listings_group_idx ON listings(product_group_id);

CREATE TABLE IF NOT EXISTS listing_variants (
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  display_price_cents bigint CHECK (display_price_cents >= 0),
  status text NOT NULL DEFAULT 'listed' CHECK (status IN ('listed','unlisted')),
  PRIMARY KEY (listing_id, product_id)
);
CREATE INDEX IF NOT EXISTS listing_variants_product_idx ON listing_variants(product_id);

ALTER TABLE sales ADD COLUMN IF NOT EXISTS product_group_name_snapshot text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS variant_name_snapshot text;
ALTER TABLE settlement_bill_sales ADD COLUMN IF NOT EXISTS product_group_name text;
ALTER TABLE settlement_bill_sales ADD COLUMN IF NOT EXISTS variant_name text;
