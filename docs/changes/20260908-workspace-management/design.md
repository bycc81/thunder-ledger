# 工作区管理技术设计

## 结论

新增独立的工作区管理页，并复用现有 `workspaces`、`workspace_members`、`collaboration_batches` 与审计日志表，不需要数据库迁移。服务端以 `workspaces.created_by` 判断创建人；改名和删除绝不以 owner/admin 角色替代创建人校验。原型与产品规则已确认，进入实现。

## 风险等级

`L2`。本轮变更工作区访问权限与删除行为。删除为软删除，不物理删除业务数据；退出会移除成员关系，立即影响访问范围。

## 产品与 UX 输入

- 产品与 UX 定义：[product-ux.md](product-ux.md)，已确认。
- HTML 原型：[prototype/index.html](prototype/index.html)，已确认。
- `data-ai-id` 注册表：[data-ai-id-registry.md](data-ai-id-registry.md)。

## 背景与目标

当前用户只能创建、切换或管理成员，无法处理误创建和被邀请加入的工作区。本轮提供改名、退出和删除，同时保证已有批次的工作区不会被删除。

## 非目标

- 不删除批次、商品、库存、销售、费用或操作记录。
- 不提供工作区恢复、创建人转让、批次删除或批量退出。
- 不改变系统管理员既有全局查看权限；系统管理员退出一个普通成员关系后，若其仍受系统管理员全局权限影响，仍按既有管理员规则可查看该空间。

## 当前实现与缺口

- 已有 `workspaces.created_by`、`deleted_at` 与 `workspace_members`，可支持创建人校验与软删除。
- 已有 `GET/POST /workspaces` 和成员移除接口，但没有工作区元信息、改名、本人退出或安全删除接口。
- 前端已有工作区选择弹层与状态存储，但没有工作区管理页。

## 页面/API 契约

### 页面与数据

| 页面区域 | 原型/业务 ID | 展示或编辑字段 | 数据来源 | 权限 | 交互结果 |
|---|---|---|---|---|---|
| 管理页 | `workspace-management-page` | 名称、当前身份、批次数量 | `GET /workspaces/:id/management` | 当前成员 | 展示管理能力与限制 |
| 基本信息 | `workspace-management-info` | 名称、创建人/成员 | 管理接口 | 创建人可编辑名称 | 保存名称 |
| 删除限制 | `workspace-delete-blocked` | 批次数量、不可删除原因 | 管理接口 | 创建人且批次数大于 0 | 删除按钮禁用 |
| 退出 | `workspace-leave` | 当前工作区名称 | 管理接口 | 非创建人 | 删除本人成员关系并回退 |
| 删除 | `workspace-delete` | 当前工作区名称 | 管理接口 | 创建人且批次数为 0 | 软删除并回退 |

### 操作与接口边界

| 操作 | 入口 ID | 前置条件 | 接口 | 成功结果 | 失败反馈 | 二次确认 |
|---|---|---|---|---|---|---|
| 获取管理信息 | `workspace-management-page` | 当前工作区成员 | `GET /workspaces/:id/management` | 返回名称、是否创建人、批次数 | 无权限或不存在 | 否 |
| 修改名称 | `workspace-management-rename` | 创建人、名称非空 | `PATCH /workspaces/:id` | 更新名称和审计记录 | 无权或参数无效 | 否 |
| 退出工作区 | `workspace-leave` | 非创建人、当前成员 | `POST /workspaces/:id/leave` | 移除本人成员关系和审计记录 | 创建人不可退出/无权 | 是 |
| 删除工作区 | `workspace-delete` | 创建人、批次数为 0 | `DELETE /workspaces/:id` | 写入 `deleted_at` 和审计记录 | 非创建人或已有批次 | 是 |

- 管理信息响应：`id`、`name`、`kind`、`isCreator`、`batchCount`。不返回其他用户信息。
- 改名请求：`{ name }`；删除/退出不接收前端传入的权限、创建人或批次数。
- 批次数统计包含该工作区创建过的所有批次（包括后来删除的批次）；服务端删除时同一条件再次检查，前端禁用不代替服务端保护。
- 错误码：`WORKSPACE_NOT_FOUND`、`WORKSPACE_FORBIDDEN`、`WORKSPACE_CREATOR_REQUIRED`、`WORKSPACE_CREATOR_CANNOT_LEAVE`、`WORKSPACE_HAS_BATCHES`、`INVALID_WORKSPACE`。
- 服务端对普通用户以真实成员关系判断；系统管理员保留现有全局查看和访问能力，不能借此删除其他人创建的工作区。

### 状态与定位

| 状态 | 页面表现 | 可执行操作 | 数据和权限要求 |
|---|---|---|---|
| Loading | 加载提示 | 返回 | 等待管理信息 |
| Error | 错误说明与重试 | 重试、返回 | 接口失败 |
| 无权限 | 无权管理提示 | 返回 | 不是成员/空间不存在 |
| Disabled | 删除按钮置灰和原因 | 创建人仍可改名 | 批次数大于 0 |
| Success | Toast 后刷新工作区并跳回首页 | 继续使用 | 操作成功 |

- `data-ai-id` 注册表：[data-ai-id-registry.md](data-ai-id-registry.md)。
- 管理页、主要区域、输入、操作和确认弹窗均有稳定 ID；无重复列表节点。

## 方案与影响范围

- 后端：在 `apps/backend/src/access.ts` 新增四个工作区管理路由和创建人/批次保护查询；写入 `workspace.update`、`workspace.leave`、`workspace.delete` 审计记录。
- 前端：新增 `WorkspaceManagementPage.vue`、路由 `/workspace/manage`；工作区选择弹层增加管理入口；状态存储在退出/删除后重新加载并回退可用工作区。
- 数据库：不新增迁移；使用现有 `deleted_at` 软删除字段。

## 风险、备份与回滚

- 删除保护：删除 API 在单个 SQL 条件中检查创建人和无未删除批次；失败不改变数据。
- 访问控制：退出后删除成员关系，现有成员和批次读取接口继续基于成员关系拒绝访问。
- 数据保留：不物理删除任何业务数据；软删除工作区后现有查询已过滤 `deleted_at IS NULL`。
- 回滚：若发布后需要回退，只回滚应用版本；已退出的成员关系或软删除空间需由管理员以受控 SQL 恢复，不自动恢复。

## 验收标准

- 非创建人无法改名或删除，创建人无法退出自己创建的空间。
- 非创建人退出后，普通账号无法再从列表或直接接口读取该空间和批次。
- 创建人仅在从未创建批次时可删除；有过批次时前端禁用且接口返回拒绝。
- 删除或退出不删除批次、交易或审计数据。
- 移动端 390×844 与 430×932 下页面无横向溢出，操作可点击。

## 开发任务绑定

- 工作区管理页：对应产品文档“页面：工作区管理”和三个 Requirement + Scenario。
- 管理接口：对应“业务规则与权限”及删除、退出的服务端保护。
- 自动化/人工验收：见 [test-plan.md](test-plan.md)。
