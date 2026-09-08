-- B1.1：密码变更、重置或停用账号后，使此前签发的登录令牌失效。
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0;
