# B3 测试与验收计划：交易与费用

## 验收场景

1. 批次详情只提供“交易记录”入口，不显示上架入口。
2. A 采购、B 卖出时，销售从合并库存扣减，销售款记在 B 名下，不选择采购来源或上架。
3. 超卖、零数量、两位小数金额、非参与人卖出人均被拒绝；撤销销售后库存恢复。
4. 邮费和自定义费用可保存，可选关联有效销售；撤销费用保留原因和原记录。
5. viewer 只读；390×844、430×932 下无横向溢出和底部导航遮挡。

## 自动化验证

- 后端：`npm run typecheck`、`npm test`、`npm run db:check`。
- Web：`npm run typecheck`、`npm run build`。
- 容器：`docker compose build`、健康检查。

## 结果与残留风险

- 自动化验证：后端 `npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run db:check` 已通过；前端 `npm.cmd run typecheck`、`npm.cmd run build` 已通过；容器构建与健康检查已通过。
- 人工验收：用户已在开发环境验证 B3 页面无误，确认销售、费用与库存联动流程收口。
- 残留风险：上架仅保留数据库预留，不开放功能；利润、阶段账单和结算留在 B4。
