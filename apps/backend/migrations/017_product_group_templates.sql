-- L2 商品组组合模板：工作区内可复用的款式清单，不关联采购、库存、销售或结算数据。
CREATE TABLE IF NOT EXISTS product_group_templates (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
CREATE INDEX IF NOT EXISTS product_group_templates_workspace_created_idx ON product_group_templates(workspace_id, created_at DESC);

-- 一个模板内的款式按录入顺序展示；删除模板时仅删除模板成员。
CREATE TABLE IF NOT EXISTS product_group_template_variants (
  id uuid PRIMARY KEY,
  template_id uuid NOT NULL REFERENCES product_group_templates(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  position integer NOT NULL CHECK (position > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS product_group_template_variant_name_unique ON product_group_template_variants(template_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS product_group_template_variant_position_unique ON product_group_template_variants(template_id, position);
