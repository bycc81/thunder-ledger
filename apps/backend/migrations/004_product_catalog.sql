-- B2：当前工作区商品资料、工作区图片资源归属与商品图片顺序。
-- 兼容早期已记录 001 但缺少 assets 表的开发数据库；已存在时不改动既有列。
CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY,
  object_key text NOT NULL UNIQUE,
  original_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  status text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  description text,
  reference_price numeric(12,1) CHECK (reference_price >= 0),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_workspace_created_idx ON products(workspace_id, created_at DESC);

-- 已有 assets 保持兼容；B2 新上传的图片必须归属一个工作区。
ALTER TABLE assets ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id);
CREATE INDEX IF NOT EXISTS assets_workspace_ready_idx ON assets(workspace_id, status) WHERE deleted_at IS NULL;

-- position 从 1 开始，第一张图片即商品列表首图。
CREATE TABLE IF NOT EXISTS product_images (
  product_id uuid NOT NULL REFERENCES products(id),
  asset_id uuid NOT NULL REFERENCES assets(id),
  position integer NOT NULL CHECK (position BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, asset_id),
  UNIQUE (product_id, position)
);
CREATE INDEX IF NOT EXISTS product_images_asset_idx ON product_images(asset_id);
