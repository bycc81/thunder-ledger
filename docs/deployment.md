# ThunderLedger 部署说明

本文是 ThunderLedger 的唯一正式部署操作入口。

## 部署基线

- 本地开发：Docker Compose + Caddy。
- 当前正式云部署：Cloudflare Pages（Web）+ Render（API）+ Neon（PostgreSQL）+ Cloudflare R2（图片）。
- 本文不包含未确认的自建 VPS 部署路线。

## 本地启动与验证

```powershell
Copy-Item .env.example .env
.\scripts\start-local.ps1
```

启动后检查：

- `GET /api/healthz` 返回 200。
- `GET /api/readyz` 在数据库可用时返回 200。
- 浏览器可以打开后台登录页。

Docker Compose 前端入口默认运行在 `http://localhost:51882`；开发前端单独运行 Vite 时使用 `http://localhost:5665`，本地后端运行在 `http://localhost:3000`。仓库根目录 `.env` 中的 `DATABASE_URL` 用于本地后端连接 `127.0.0.1:5432`，`DATABASE_URL_DOCKER` 仅供 Compose 内的 API 和迁移容器使用。`apps/backend` 的 `npm run dev` 会自动读取根目录 `.env`。

停止服务使用 `.\scripts\stop-local.ps1`（内部执行 `docker compose down`）。除非用户明确授权，不执行 `docker compose down -v`，避免删除数据库数据卷。

更新本地基础镜像并重新构建使用 `.\scripts\update-images.ps1`；该脚本不会自动启动服务，也不会删除数据卷。

## 数据库迁移

- 在 `apps/backend` 运行 `npm run db:check` 检查迁移。
- 使用 `npm run db:migrate` 执行迁移，不直接手工修改生产表。
- 已执行的迁移文件不可修改，只能新增后续迁移。
- 生产迁移前必须完成 PostgreSQL 备份。
- 迁移失败时停止发布，不强制删除数据；按迁移记录、备份和恢复方案处理。

## 云端部署

### 手机遇到验证码失败或服务 429 时

1. 登录页展开“连接诊断与排查”，先点“复制诊断信息”，粘贴到备忘录留存。即使服务稍后恢复，先前错误也会保留；同一浏览器最近 24 小时最多保存 30 条，存储受限时仅在本页内存保留。不要先清除记录。
2. 查看结论：`x-render-routing: hibernate-rate-limited` 才能明确识别 Render 休眠唤醒限流；其他 429 不直接归因于 Render。HTTP 200 若返回启动 HTML 或非预期 JSON，仍视为响应异常。会话接口的 401 表示未登录，属于正常情况。
3. 点击“唤醒服务”一次，等待本轮完成，最多约两分钟；不要连续重复点击。该按钮仅请求网站当前 API 路径，无法绕过 Render 平台限制。
4. 仍失败时，从诊断区域打开“后端直连检查”，等待最多一分钟。只有看到 JSON `{"status":"ok"}` 才算后端已响应，不能仅凭页面打开或 HTTP 200 判断成功。截图保存错误文字，返回网站刷新验证码。
5. 对比“网站接口检查”与“后端直连检查”：直连正常但网站失败，需检查代理路径、Pages Function 日志及 `API_ORIGIN`；两者失败，结合错误与 Render 状态/日志排查后端和网络；两者都正常，只能证明已恢复，保留之前的诊断记录继续追查。
6. 可切换 Wi-Fi / 移动网络再各检查一次，保留结果差异。持续几分钟失败时查看 Render Events、启动日志与平台用量状态；用故障时间及报告中的 `cf-ray` 对齐排查，不靠后来成功的请求猜测原因。

报告只包含三个只读接口的时间（UTC）、耗时、状态及白名单诊断响应头，不保存账号、密码、验证码、Cookie 或 Token，不自动上传。手机打开后端直连链接的结果由用户人工观察，不会自动写入网站报告。没有开启浏览器开发者工具也能复制报告；剪贴板受限时在报告文本框长按复制。

后端直连链接沿用当前正式源站 `https://thunder-ledger-api.onrender.com`；源站迁移时必须同步更新 `apps/web/src/pages/LoginPage.vue` 中的直连检查地址。此入口只做健康检查，不切换业务 API 或登录来源。上述诊断入口需部署本次前端变更后才可使用；旧版可手动访问当前 Pages 与 Render 的 `/api/healthz` 并保存截图。

### Render API

- Root Directory：`apps/backend`
- Build Command：`npm ci && npm run build`
- Start Command：`npm run db:migrate && npm run start`
- Health Check：`/api/healthz`
- `DATABASE_URL`、`SESSION_SECRET`、`SESSION_COOKIE_SECURE=true`、CORS 和 R2 凭据只配置在 Render Secret。
- `CORS_ORIGINS` 必须精确填写正式 Pages 来源；跨域 Cookie 请求会携带凭据，不能使用通配符。
- 正式环境优先将 Web 和 API 配置为同一可注册域下的自定义域名，例如 `app.example.com` 与 `api.example.com`。如果直接使用 Pages 与 Render 默认域名，必须在目标浏览器验证第三方 Cookie 策略不会阻断登录恢复。

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

## 生产备份与密钥运维基线

需要备份时导出 `.dump`；需要回到某个时间点时，先判断目标时间是否在 Neon 的最近 6 小时内。真实连接串只放在 `E:\01code\02ThunderLedgerBackups\backup-config.ps1`。

### 导出备份

```powershell
. 'E:\01code\02ThunderLedgerBackups\backup-config.ps1'
docker run --rm --env DATABASE_URL --mount "type=bind,source=$backupRoot,target=/backup" postgres:18-alpine sh -lc 'set -eu; file=/backup/thunderledger-$(date -u +%Y%m%dT%H%M%SZ).dump; pg_dump "$DATABASE_URL" --format=custom --file "$file"; test -s "$file"; ls -lh "$file"'
Remove-Item Env:DATABASE_URL
```

成功时会显示非空的 `thunderledger-*.dump` 文件。保留或删除哪些文件由你决定。

### 恢复到某个具体时间（目标时间在最近 6 小时内）

示例：现在是 2026-09-23 16:00，要回到 **2026-09-23 14:30（UTC+8）**。

1. Neon Dashboard → 生产项目 → **Branches** → `production` → **Restore**。
2. 选择 `2026-09-23 14:30`，先点 **Preview data** 核对；确认要实际恢复后才点 **Restore**。
3. Neon 会直接将 `production` 恢复至该时间点，并自动把恢复前的当前状态保留为类似 `production_old_2026-09-23T08:00:00Z` 的分支。不要删除该备份分支。
4. Render 继续连接 `production` 时会立即读取恢复后的数据；恢复后检查 `/api/healthz`、`/api/readyz`、登录和账务数据。

这是真实生产恢复，不是演练。执行前停止业务写入；如只想查看历史数据或演练，点 **Cancel**，不要点 **Restore**。

### 从指定备份文件恢复（目标时间超过 6 小时）

示例文件：`E:\01code\02ThunderLedgerBackups\thunderledger-20260923T023000Z.dump`。

这个文件名中的时间是“导出备份的时间”，该文件保存的是当时数据库的完整状态。这里不需要、也不能在 Neon 另选一个历史时间点；要恢复到哪个时间，取决于你选择哪个 `.dump` 文件。

新分支用于先验证旧备份，避免直接覆盖 `production`：

```text
恢复前：Render → production（当前数据）
导入后：Render → production（仍是当前数据）
        restore-20260923-023000（已导入旧备份，用于核对）
确认恢复：旧 production → production-before-20260923
         restore-20260923-023000 → production
         Render → 新 production（旧备份成为正式系统数据）
回退：Render → production-before-20260923（立刻回到恢复前数据）
```

1. Neon Dashboard → **Branches** → **Create branch**，从当前 `production` 创建 `restore-20260923-023000`；复制这个新分支的 **Direct connection**。
2. 执行以下命令。只修改 `$backupName`；出现输入框时粘贴上一步新分支的连接串：

```powershell
$backupRoot = 'E:\01code\02ThunderLedgerBackups'
$backupName = 'thunderledger-20260923T023000Z.dump'
$env:RESTORE_DATABASE_URL = Read-Host '粘贴 Neon 新恢复分支的 Direct connection'
if (-not (Test-Path -LiteralPath (Join-Path $backupRoot $backupName))) { throw '找不到指定备份文件。' }
docker run --rm --env RESTORE_DATABASE_URL --env BACKUP_NAME=$backupName --mount "type=bind,source=$backupRoot,target=/backup" postgres:18-alpine sh -lc 'set -eu; pg_restore --dbname="$RESTORE_DATABASE_URL" --clean --if-exists --no-owner --no-privileges --exit-on-error "/backup/$BACKUP_NAME"'
Remove-Item Env:RESTORE_DATABASE_URL
```

3. 命令没有报错即导入完成。`--clean` 只会清空新分支中的表，再导入备份；`production` 不受影响。核对新分支数据正确后，按以下顺序切换：

   1. 将当前 `production` 改名为 `production-before-20260923`。
   2. 将 `restore-20260923-023000` 改名为 `production`。
   3. Render Dashboard → 后端服务 → **Environment**，将 `DATABASE_URL` 替换为新 `production` 分支的 Direct connection，然后重新部署。
   4. 检查 `/api/healthz`、`/api/readyz`、登录和账务数据。

4. 正式系统验证失败时，Render 的 `DATABASE_URL` 改回 `production-before-20260923` 的连接串并重新部署；不需要再次导入或恢复。

### R2 凭据检查与轮换（每年 4 月、10 月 1 日 11:00）

1. Cloudflare Dashboard → **R2** → **Manage R2 API Tokens**。确认当前 Token 只拥有目标 Bucket 的 **Object Read & Write** 权限，Bucket 仍保持私有。
2. 需要轮换时，选择 **Create API Token**，仅授权当前 Bucket 的 **Object Read & Write**；保存新生成的 Access Key ID 和 Secret Access Key。Secret 只显示一次，不写入任何文档。
3. Render Dashboard → 后端服务 → **Environment**，将 `R2_ACCESS_KEY_ID` 与 `R2_SECRET_ACCESS_KEY` 改为新值，然后手动部署最新版本。
4. 部署完成后，在正式系统依次执行：上传一张商品图片 → 刷新页面确认可读取 → 删除该图片。三项均成功后，回到 Cloudflare 撤销旧 Token。
5. 在运维记录写入轮换日期、验证结果和下次检查日；如果第 4 步任一项失败，保留旧 Token 并回滚 Render 环境变量，不撤销旧 Token。

### 发布前检查（每次生产发布前）

1. 在 Render Dashboard → 后端服务 → **Environment**，逐项确认：`DATABASE_URL` 使用 Neon Direct connection 且包含 `sslmode=require`、`SESSION_SECRET` 已设置、`SESSION_COOKIE_SECURE=true`、`CORS_ORIGINS` 仅为正式 Pages 来源及本地开发来源。
2. 在 Cloudflare Pages → 项目 → **Settings** → **Environment variables**，确认只有 `VITE_API_BASE_URL` 等公开前端变量；不得出现 `DATABASE_URL`、`SESSION_SECRET` 或任意 `R2_*` 变量。
3. 执行一次“每月数据库备份”中的备份命令并确认非空文件生成。
4. 部署后执行下列命令，将 `<RENDER_API_URL>` 替换为 Render 后端根地址；两个请求都必须返回 `StatusCode : 200`：

```powershell
Invoke-WebRequest -Uri 'https://<RENDER_API_URL>/api/healthz' | Select-Object StatusCode
Invoke-WebRequest -Uri 'https://<RENDER_API_URL>/api/readyz' | Select-Object StatusCode
```

5. 按 [发布检查清单](changes/20260916-v1-role-release-readiness/release-checklist.md) 完成云端冒烟：登录与会话、角色权限、图片、商品到结算闭环、报表与 CSV。未完成任一项，不标记为正式上线验收完成。

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
