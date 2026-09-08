# B2-1 测试与验收计划：采购与成本

## 验收场景

1. A、B 在同一批次分别录入同一商品的两笔采购，库存汇总正确显示总数量和总成本，详情保留两笔渠道、付款人和成本承担。
2. 每笔采购必须填写一位或多位成本承担人，承担金额合计必须等于采购总成本；系统不按付款金额预填。
3. owner/editor 可创建采购和渠道；viewer、非批次成员与跨空间成员不能写；关闭批次不能新增采购。
4. 商品、渠道、付款人或承担人不属于当前范围，或数量/金额格式不合法时，页面保留输入并展示明确反馈。
5. 390×844 与 430×932 下，从批次详情进入库存、新增采购、查看汇总和详情均无横向溢出或遮挡。
6. 从库存列表点击商品进入详情时，无需刷新页面即可加载采购明细；不存在的商品显示明确提示。
7. owner/editor 可编辑采购，保存后库存汇总和明细同步更新；修改总成本时必须填写原因；viewer 不能编辑。
8. owner/editor 可填写原因减少库存；数量不能超过可卖数量，减少后数量和剩余成本正确，详情保留记录。

## 自动化验证

- `apps/backend`：`npm run typecheck`、`npm test`、`npm run db:check`；受控数据库执行迁移并检查表、约束、汇总和权限。
- `apps/web`：`npm run typecheck`、`npm run build`；扫描 B2-1 页面 `data-ai-id` 是否与注册表一致。
- 文档：UTF-8 重读、`git diff --check`。

## 人工验收

用户在本地页面完成一笔或两笔采购录入，确认付款人与成本承担是不同字段、成本承担为必填、库存汇总与采购详情正确；确认后才进入 B2-2。

## 结果与残留风险

- 已通过：`apps/backend` 的 `npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run db:check`；`apps/web` 的 `npm.cmd run typecheck`、`npm.cmd run build`。
- 已通过：本地数据库迁移 `005_inventory_purchases` 已执行，`manual_channels`、`inventory_purchases`、`purchase_cost_shares` 三张表存在；容器内 `/api/healthz` 返回 200，未登录库存接口返回 401。
- B2-1 用户页面验收：已确认采购、成本承担、库存汇总和采购详情符合预期。
- B2-2 已通过：后端 `npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run db:check`；前端 `npm.cmd run typecheck`、`npm.cmd run build`。本地迁移 `006_inventory_maintenance` 已执行，`inventory_adjustments` 表存在；详情接口返回减少记录数组；改总成本但不填原因返回 400；减少数量超过可卖数量返回 409；`/api/healthz` 与 `/api/readyz` 返回正常。
- B2-2 用户页面验收：已确认编辑采购与“商品损坏或丢失”操作符合预期，B2 正式收口。
- 残留风险：本轮自动化测试未建立独立的采购数据夹具，采购的角色、跨工作区和金额边界仍建议后续补为后端集成测试；生产迁移和发布未执行。
