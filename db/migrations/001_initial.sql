-- 基础平台暂不创建业务表；该迁移用于验证数据库迁移链路。
CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES ('001_initial') ON CONFLICT DO NOTHING;

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
