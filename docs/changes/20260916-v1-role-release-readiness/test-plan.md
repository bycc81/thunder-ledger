# v1 四角色与发布准备测试计划

## 结论

本批次必须证明四角色在真实路由上的权限边界正确，并形成可以直接执行的生产检查顺序。

## 验收场景

- owner/admin：可管理成员、查看审计、管理批次、编辑业务数据和发起结算。
- editor：可编辑商品、采购、销售和费用；不能管理成员、查看审计或发起结算。
- viewer：可查看加入批次后的数据和报表；所有代表性写操作返回 403。
- 所有角色：只能访问已加入或自动授权的批次。
- 未登录：受保护接口返回 401。
- 发布检查：缺失 Secret、域名、HTTPS、精确 CORS、备份恢复或回滚版本时不得发布。

## 自动化验证

- 后端：`npm run typecheck`、`npm test`
- 四角色：`powershell -ExecutionPolicy Bypass -File scripts/verify-role-matrix.ps1`
- 前端：`npm run typecheck`、`npm run build`
- 数据库：`npm run db:check`
- 容器：`docker compose config`、`docker compose build`
- 健康：`/api/healthz`、`/api/readyz`

## 人工验收

- 生产 Pages/Render 域名下登录、刷新、退出和会话过期。
- owner/admin/editor/viewer 分别打开成员、审计、商品、批次、库存、交易、结算和报表页面，确认按钮显隐与 API 结果一致。
- R2 图片上传、读取和删除。
- 正式域名下 CSV 下载。

## 结果与残留风险

2026-09-16 已完成本地验证：

- 后端 `typecheck` 通过，14 项自动化测试通过。
- `scripts/verify-role-matrix.ps1` 通过：四角色真实 API 的读取、业务编辑、成员/审计/结算管理、报表查询与 CSV 导出均符合 2xx/403 矩阵，未登录访问返回 401。
- 前端权限契约静态核对通过；补齐结算调整单详情的 `canManage` 显隐，editor/viewer 不再看到确认按钮。
- Chrome 真实 `390×844` 视口验证通过：owner 显示 `settlement-adjustment-confirm`，editor 显示 `settlement-adjustment-readonly`；页面 `scrollWidth=390`，金额列和说明文字未溢出。
- 前端 `typecheck`、`build` 通过；生产依赖审计为 0。
- `docker compose config --quiet`、`docker compose build` 通过；本地 API 镜像已重建，`/api/healthz`、`/api/readyz` 和 Vite 开发入口均返回 200。

残留风险：

- 正式 Pages/Render 域名下仍需使用 owner/admin/editor/viewer 四类账号完成人工页面验收。
- R2 图片、正式域名 Cookie、CSV 下载和云端审计仍需在生产配置下冒烟。
