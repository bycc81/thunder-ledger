# v1 会话安全加固测试计划

## 结论

本次验收重点是证明高权限 JWT 不再暴露给前端脚本，同时登录、会话恢复、修改密码、退出登录和受保护 API 访问仍然可用。

## 验收场景

- 成功：登录接口设置 HttpOnly Cookie，响应不返回 `accessToken`。
- 成功：带 Cookie 调用 `/api/auth/session` 返回用户名、角色和系统管理员标记。
- 失败：无 Cookie 调用 `/api/auth/session` 返回 401。
- 成功：退出登录清除 Cookie，前端状态清空并回到登录页。
- 成功：修改密码后重新设置 Cookie，不把 token 写入浏览器存储。
- 权限：owner/admin/editor/viewer 权限规则不在本轮改变，后续上线门禁单独回归。
- 部署：本地允许 HTTP Cookie；生产必须依赖 HTTPS、`Secure` 和精确 CORS。

## 自动化验证

- API：`npm run typecheck`、`npm test`
- Web：`npm run typecheck`、`npm run build`
- 数据库：本轮不改迁移，视最终改动决定是否运行 `npm run db:check`
- 容器/部署：本轮如改依赖或运行配置，执行 `docker compose config`、`docker compose build` 和健康检查

## 人工验收

1. 打开前端开发环境，访问受保护页面时未登录应跳转到登录页。
2. 登录成功后进入工作区，刷新页面仍保持登录。
3. 点击“我的”里的退出登录，确认后回到登录页。
4. 浏览器 DevTools 中确认业务脚本无法读取 `thunderledger_session` Cookie 内容。

## 结果与残留风险

2026-09-16 已完成：

- 后端 `npm run typecheck`：通过。
- 后端 `npm test`：14 项通过。
- 后端 `npm run db:check`：通过。
- 后端生产依赖 `npm audit --omit=dev`：0 项漏洞。
- 前端 `npm run typecheck`、`npm run build`：通过。
- 前端生产依赖 `npm audit --omit=dev`：0 项漏洞。
- `docker compose config`、`docker compose build`：通过。
- 本地容器 `/api/healthz`、`/api/readyz`：200。
- Vite 开发前端 `http://localhost:5174`：200。
- 无 Cookie 访问 `/api/auth/session`：401。

残留风险：

- `drizzle-kit` 最新稳定版的开发期内部加载器仍被 npm audit 标记 4 个 moderate；不进入生产运行依赖，生产审计为 0。
- 尚未在正式 Pages/Render 域名验证 `Secure`、`SameSite=None` Cookie 和目标浏览器的第三方 Cookie 策略。
- 本地配置检查输出曾包含现有 R2 凭据；正式上线前必须轮换对应 R2 密钥，并确认新密钥只保存在云 Secret。
- owner/admin/editor/viewer 四角色 API 回归和本地隔离恢复演练已于 2026-09-16 完成；正式域名页面验收与生产云端冒烟仍未完成。
