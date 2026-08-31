CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

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
