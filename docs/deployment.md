# ThunderLedger 部署说明

本文是 ThunderLedger 的唯一正式部署操作入口。

## 部署基线

- 本地开发：Docker Compose + Caddy。
- 当前正式云部署：Cloudflare Pages（Web）+ Render（API）+ Neon（PostgreSQL）+ Cloudflare R2（图片）。
- 本文不包含未确认的自建 VPS 部署路线。

## 本地启动与验证

```powershell
Copy-Item .env.example .env
docker compose config
docker compose build
docker compose up --build -d
docker compose ps
```

启动后检查：

- `GET /api/healthz` 返回 200。
- `GET /api/readyz` 在数据库可用时返回 200。
- 浏览器可以打开后台登录页。

停止服务使用 `docker compose down`。除非用户明确授权，不执行 `docker compose down -v`，避免删除数据库数据卷。

## 数据库迁移

- 在 `apps/backend` 运行 `npm run db:check` 检查迁移。
- 使用 `npm run db:migrate` 执行迁移，不直接手工修改生产表。
- 已执行的迁移文件不可修改，只能新增后续迁移。
- 生产迁移前必须完成 PostgreSQL 备份。
- 迁移失败时停止发布，不强制删除数据；按迁移记录、备份和恢复方案处理。

## 云端部署

### Render API

- Root Directory：`apps/backend`
- Build Command：`npm ci && npm run build`
- Start Command：`npm run db:migrate && npm run start`
- Health Check：`/api/healthz`
- `DATABASE_URL`、`SESSION_SECRET`、CORS 和 R2 凭据只配置在 Render Secret。

### Cloudflare Pages Web

- Root Directory：`apps/web`
- Build Command：`npm ci && npm run build`
- Output Directory：`dist`
- `VITE_API_BASE_URL` 指向 Render API 地址。

### Neon PostgreSQL

- 连接串启用 SSL（`sslmode=require`）。
- 连接串只提供给 API 服务，不配置到 Pages。
- 生产数据库使用迁移脚本管理，不使用 `drizzle-kit push` 直接改表。

### Cloudflare R2

- Bucket 保持私有。
- R2 S3 凭据只配置在 API 服务。
- 浏览器通过 API 获取预签名 URL，不接触永久密钥。
- CORS 只允许正式 Pages 域名和本地开发地址。

## 发布与回滚

发布前完成：

1. API `npm run typecheck` 和 `npm test`。
2. Web `npm run typecheck` 和 `npm run build`。
3. `npm run db:check` 及必要的迁移验证。
4. `docker compose config`、健康检查和 Git commit 记录。

部署失败或健康检查异常时回退上一版本。涉及数据库结构时不能只回退应用版本，必须结合迁移记录和备份制定恢复方案。

## 安全边界

- 不提交 `.env`、密码、Token、连接串、R2 密钥或真实用户数据。
- 公网只暴露必要的 Web/API 入口，PostgreSQL 不直接暴露公网。
- 本地测试数据、生产数据、账号和密钥完全隔离。
