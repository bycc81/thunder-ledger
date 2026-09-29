# 站内使用手册页面技术设计

## 结论

在 `apps/web` 新增静态 `UserManualPage.vue`，通过受现有登录守卫保护的 `/help/user-manual` 路由提供服务访问。页面不读取或修改业务数据；Nginx 已使用 SPA 回退，生产环境直接访问该路径会返回前端入口并由 Vue Router 渲染页面。

## 风险等级

`L1`。本次新增一个登录后前端页面和路由，但不改变权限模型、接口、数据库或结算规则。

## 产品与 UX 输入

- 产品与 UX 定义：[product-ux.md](product-ux.md)
- HTML 原型：[prototype/index.html](prototype/index.html)
- 产品确认状态：已确认
- UX 与原型确认状态：已确认

## 背景与目标

`docs/user-manual.md` 已包含业务事实，但移动端不适合快速查阅。新增的站内页面用固定内容呈现工作区、批次、商品、操作选择、销售方式对照、快速售出规则和常见问题；“我的”页提供固定入口，已登录用户也可直接访问 `/help/user-manual`。

## 非目标

- 不新增后端接口、数据库、权限角色或配置。
- 不将手册加入底部主导航，不实现搜索、编辑、下载或反馈。
- 不从页面发起采购、销售、快速售出、费用或结算操作。

## 当前实现与缺口

| 现有模块 | 当前事实 | 本次补充 |
| --- | --- | --- |
| `docs/user-manual.md` | 维护完整使用规则 | 作为页面内容事实来源，并标注站内访问路径 |
| Vue Router | 已有全局登录守卫和受保护路由 | 新增 `/help/user-manual` 静态页面路由 |
| `apps/web/nginx.conf` | `try_files` 回退至 `/index.html` | 无需改动，已支持服务端直达 SPA 路径 |

## 页面/API 契约

### 页面与数据

| 页面区域 | 原型/业务 ID | 展示或编辑字段 | 领域数据来源 | 权限 | 交互结果 |
| --- | --- | --- | --- | --- | --- |
| 使用手册页 | `user-manual-page` | 固定说明内容 | 前端静态文本 | 已登录用户 | 展示手册 |
| 顶部导航 | `user-manual-topbar` | 标题、返回 | 前端静态文本 | 已登录用户 | 返回上一页；无上一页时返回工作区 |
| 操作导航 | `user-manual-task-nav` | 工作区、批次、商品、采购、两类销售、费用、结算 | 前端静态文本 | 已登录用户 | 页内锚点跳转 |
| “我的”页帮助区 | `profile-help-section` | 使用手册入口 | 前端静态文本 | 已登录用户 | 跳转 `/help/user-manual` |
| 常见问题 | `user-manual-faq` | 问题与答案 | 前端静态文本 | 已登录用户 | 原生折叠展开 |

### 操作与接口边界

| 操作 | 入口 ID | 前置条件 | 领域动作或接口 | 成功结果 | 失败反馈 | 是否二次确认 |
| --- | --- | --- | --- | --- | --- | --- |
| 返回 | `user-manual-back` | 无 | Vue Router 历史或 `/workspace` | 离开手册页 | 无 | 否 |
| 打开使用手册 | `user-manual-entry` | 已登录 | Vue Router `/help/user-manual` | 打开手册页 | 无 | 否 |
| 查看章节 | `user-manual-task-*` | 无 | 页内锚点 | 滚动到对应章节 | 无 | 否 |
| 展开 FAQ | `user-manual-faq-{topic}` | 无 | 原生 `details` | 展示答案 | 无 | 否 |

- 请求参数与当前工作区/数据上下文：无请求、无数据上下文。
- 响应字段与页面字段：无。
- 分页、排序和筛选：不适用。
- 错误码和用户反馈：未登录由现有全局路由守卫跳转 `/login?redirect=/help/user-manual`。
- 前端显隐不替代服务端授权：本页不暴露业务数据；仍复用现有会话校验。

### 状态与定位

| 状态 | 页面表现 | 可执行操作 | 数据和权限要求 |
| --- | --- | --- | --- |
| Loading | 无远端加载，直接渲染静态内容 | 无 | 已登录 |
| Empty | 不适用 | 无 | 已登录 |
| Error | 不适用，无请求 | 返回 | 已登录 |
| 无权限 | 由路由守卫跳转登录 | 登录 | 未登录 |
| Disabled | 不适用 | 无 | 已登录 |
| Success | 内容、锚点和 FAQ 可用 | 查看、展开、返回 | 已登录 |

- `data-ai-id` 注册表：[data-ai-id-registry.md](data-ai-id-registry.md)
- 页面根、主要区域、导航、FAQ 折叠项均有稳定 ID；无重复业务数据和用户输入参与命名。

## 方案与影响范围

- 新增 `apps/web/src/pages/UserManualPage.vue`，复用 Vant `NavBar`、`Tag`、`Icon` 和全局视觉变量；补充工作区、批次和商品说明。
- 在 `apps/web/src/main.ts` 注册 `/help/user-manual`，复用现有 `requiresAuth` 守卫。
- 在 `ProfilePage.vue` 的“帮助与支持”区添加 `user-manual-entry`，跳转到手册路由。
- 更新 `docs/user-manual.md` 站内访问路径和本变更的确认记录。
- `apps/web/nginx.conf` 已包含 SPA 回退；不改后端、部署配置或 API。

## 风险、备份与回滚

| 风险 | 控制 | 回滚 |
| --- | --- | --- |
| 文案与业务规则不一致 | 内容按 `docs/user-manual.md` 和快速售出实现核对 | 删除路由与页面，不影响业务数据 |
| 直达路由 404 | 使用既有 Nginx `try_files` SPA 回退并构建验证 | 移除新路由 |
| 无来源页时返回空白 | 检测路由历史，无历史时跳转工作区 | 维持默认工作区跳转 |

## 验收标准

- 登录后访问 `/help/user-manual` 可直接展示手册；未登录时跳转登录并保留 redirect。
- “我的”页入口、返回、八个操作导航和 FAQ 折叠正常工作。
- 快速售出的本单成本可为 0、关联库存多选、数量不一致确认、库存与结算口径均可见。
- 390×844 与 430×932 无横向溢出、遮挡或拥挤；`data-ai-id` 与注册表一致。
- `apps/web` 的 `npm run typecheck` 和 `npm run build` 通过。

## 开发任务绑定

- 静态手册页与路由：对应产品/UX“操作选择”“快速售出说明”“快速定位”三个 Requirement；通过路由、锚点、FAQ 与移动端视觉验收验证。
