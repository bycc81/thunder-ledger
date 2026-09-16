# v1 会话安全加固设计

## 结论

本轮将登录会话从前端 `localStorage` 中的 Bearer JWT 改为服务端下发的 HttpOnly Cookie。可以进入实现；不涉及新页面、新数据库结构或生产发布，生产启用前仍需完成云端配置核对和冒烟测试。

## 风险等级

`L2`。本次修改认证、会话承载方式、CORS 凭据策略和退出登录行为，属于安全策略与权限入口改动。

## 产品与 UX 输入

本轮不适用。用户可见的登录、会话恢复、修改密码和退出路径保持不变，不新增模块或页面。

## 背景与目标

当前前端把高权限 `accessToken` 写入 `localStorage`，不符合安全规范。目标是让浏览器无法通过脚本读取会话令牌，同时保持现有登录、验证码、会话恢复、密码修改和受保护页面访问能力。

## 非目标

- 不新增多设备会话管理、刷新令牌或后台踢人页面。
- 不改数据库表结构。
- 不执行生产部署、生产 Secret 修改或真实用户会话切换。
- 不改变 owner/admin/editor/viewer 的业务权限规则。

## 当前实现与缺口

- 后端 `/api/auth/login`、`/api/auth/db-login`、`/api/auth/password` 返回 `accessToken`。
- 后端 `auth()` 通过 `request.jwtVerify()` 验证 Authorization header。
- 前端 `api.ts` 从 `localStorage.accessToken` 写入 Authorization header。
- 前端路由守卫通过 `localStorage.accessToken` 判断是否允许进入受保护页面。
- 缺口：高权限令牌可被脚本读取；没有服务端清除会话 Cookie 的退出接口；跨域部署未开启凭据传递。

## 页面/API 契约

本轮不新增页面契约。现有接口边界调整如下：

| 接口 | 行为 |
|---|---|
| `POST /api/auth/login` | 验证成功后设置 `thunderledger_session` HttpOnly Cookie，响应 `{ authenticated: true }` |
| `POST /api/auth/db-login` | 保留兼容入口，但改为设置同一 Cookie，响应 `{ authenticated: true }` |
| `POST /api/auth/password` | 修改密码后签发新会话 Cookie，响应 `{ ok: true }` |
| `POST /api/auth/logout` | 清除会话 Cookie，响应 `{ ok: true }` |
| `GET /api/auth/session` | 继续返回当前登录用户名、角色和系统管理员标记 |

## 方案与影响范围

- 后端注册 `@fastify/cookie`，并配置 `@fastify/jwt` 从 `thunderledger_session` Cookie 读取 JWT。
- Cookie 属性：`HttpOnly`、`Path=/`、8 小时有效期；生产环境通过 `SESSION_COOKIE_SECURE=true` 使用 `Secure`、`SameSite=None`；本地开发和 HTTP Compose 使用 `false`、`SameSite=Lax`。
- CORS 开启 `credentials`，继续使用 `CORS_ORIGINS` 精确允许来源。
- 对带 `Origin` 的写请求校验来源，拒绝不在 `CORS_ORIGINS` 中的跨站写入。
- 前端 Axios 启用 `withCredentials`，移除 `localStorage.accessToken` 读写和 Authorization header 注入。
- 路由守卫改为依赖 Pinia auth 状态，并在需要时调用 `/auth/session` 恢复。
- 退出登录调用 `/auth/logout`，再清空前端状态。

## 风险、备份与回滚

- 风险：Pages 与 Render 跨域时如果 `CORS_ORIGINS`、HTTPS 或 Cookie 属性配置错误，会导致登录后无法恢复会话。
- 风险：直接使用 Pages 与 Render 默认域名属于跨站请求，部分浏览器的第三方 Cookie 策略可能阻断会话。
- 控制：本地自动化测试覆盖 Cookie 登录、无 Cookie 401、退出清 Cookie；生产优先使用同一可注册域下的 Web/API 自定义域名，并核对 `CORS_ORIGINS`、`VITE_API_BASE_URL` 后执行目标浏览器冒烟。
- 数据：不改表结构，不迁移数据，不需要数据库回滚。
- 应用回滚：回退本次代码和依赖变更即可恢复 Bearer token 方案；生产回滚前需提醒用户旧 Cookie 与旧 localStorage token 的兼容差异。

## 验收标准

- 登录成功响应包含 `Set-Cookie`，响应体不包含 `accessToken`。
- 无 Cookie 访问 `/api/auth/session` 返回 401。
- 携带 Cookie 访问 `/api/auth/session` 返回当前用户信息。
- `/api/auth/logout` 返回清除 Cookie 的响应；浏览器移除 Cookie 后再次访问会话接口返回 401。
- 前端代码不再读写 `localStorage.accessToken`，不再注入 Authorization header。
- 后端 typecheck、测试通过；前端 typecheck、build 通过。

## 开发任务绑定

- 后端 Cookie 会话：绑定登录、恢复、退出、密码修改验收场景，使用 `npm test` 覆盖。
- 前端会话恢复：绑定受保护路由、登录页跳转、退出登录场景，使用 typecheck/build 和本地人工冒烟覆盖。
