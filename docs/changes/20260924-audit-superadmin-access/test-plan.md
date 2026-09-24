# 审计日志系统管理员权限修复测试与验收计划

## 结论

重点证明系统管理员跨工作区创建批次后，可以读取该工作区审计日志，同时不改变普通成员的审计读取边界。

## 验收场景

1. 系统管理员未加入目标工作区：创建批次成功，随后 `GET /api/audit` 返回 `200`。
2. 工作区 owner/admin：读取审计日志返回 `200`。
3. 工作区 editor/viewer：读取审计日志继续返回 `403`。
4. 工作区 ID 缺失、格式非法、已删除：读取审计日志返回 `403`。

## 自动化验证

- `apps/backend`：`npm run typecheck`
- `apps/backend`：`npm test`
- 迁移隔离数据库 `thunderledger_role_test` 后：`npm run test:roles`

## 人工验收

1. 使用系统管理员账号登录本地前端。
2. 选择非系统管理员创建的工作区并新增一个批次。
3. 打开操作记录或刷新工作区，确认 `/api/audit?workspaceId=...` 返回 `200`，页面不再提示工作区加载失败。

## 结果与残留风险

- 已执行 `npm run typecheck`、`npm test`，均通过。
- 在隔离数据库 `thunderledger_role_test` 执行迁移后运行 `npm run test:roles`，通过系统管理员跨工作区创建批次并读取审计日志、普通角色权限矩阵的回归验证。
- 本地 Docker API 已重建、重启，并通过 `/api/healthz`。
- 尚未使用浏览器登录 admin 完成端到端人工操作；需刷新本地页面后按“人工验收”步骤确认。
