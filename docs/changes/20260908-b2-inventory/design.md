# B2 技术设计：采购、成本与库存维护

## 结论

在现有 Fastify + PostgreSQL 单体内新增工作区手工渠道、批次采购记录和采购成本承担；采购按“批次 × 商品”汇总为可卖库存。B2-2 补充采购编辑、商品损坏或丢失时减少库存及操作记录。

## 风险等级

`L2`。涉及 PostgreSQL 迁移、批次权限、成本承担和后续结账依据。

## 产品与 UX 输入

- 产品与 UX 定义：[product-ux.md](product-ux.md)，已确认。
- HTML 原型：[prototype/index.html](prototype/index.html)，已确认。
- `data-ai-id` 注册表：[data-ai-id-registry.md](data-ai-id-registry.md)。

## 页面/API 契约

| 页面区域 | 主要数据 | 权限 | 接口 |
|---|---|---|---|
| 批次库存 | 商品名、可卖数量、采购总成本、采购次数 | 有批次读取权 | `GET /api/batches/:batchId/inventory` |
| 库存详情 | 商品汇总、采购记录、付款人、渠道、成本承担 | 有批次读取权 | `GET /api/batches/:batchId/inventory/:productId` |
| 新增采购 | 商品、渠道、付款人、数量、总成本、成本承担、日期、链接、备注 | batch owner/editor | `POST /api/batches/:batchId/purchases` |
| 编辑采购 | 与新增采购相同 | batch owner/editor | `GET` / `PATCH /api/batches/:batchId/purchases/:purchaseId` |
| 减少库存 | 数量、原因、减少时消耗的成本 | batch owner/editor | `POST /api/batches/:batchId/inventory/:productId/adjustments` |
| 采购渠道 | 当前工作区可复用渠道 | 有批次读取/写入权 | `GET` / `POST /api/batches/:batchId/channels` |

- 金额请求和响应均为最多一位小数的字符串；数据库使用整数“角”存储。
- 付款人与每位成本承担人都必须是当前批次参与人；承担金额合计必须等于采购总成本，且不默认按付款金额填充。
- 所选商品和渠道必须属于当前批次所在工作区；采购数量为正整数；批次关闭后拒绝新增采购。
- viewer 读取库存和详情；batch owner/editor 可新增采购和渠道；前端显隐不替代服务端校验。
- `GET` 返回 `404 NOT_FOUND` 给无读取权或跨空间批次；写入越权返回 `403 FORBIDDEN`；字段错误返回 `400 INVALID_PURCHASE`；已关闭批次返回 `409 BATCH_CLOSED`。
- 减少库存时，系统按当前剩余数量平均计算消耗成本；若这次正好减少全部剩余数量，则消耗全部剩余成本，避免零头遗留。减少数量不能超过可卖数量。
- 编辑采购时不能更换商品；商品的采购总数量和总成本不得低于已减少库存对应的数量和成本；不满足时返回 `409 INVENTORY_ALREADY_REDUCED`。改动总成本必须填写原因，原因与修改结果写入操作记录。

## 数据、权限与回滚

- 迁移新增 `manual_channels`、`inventory_purchases`、`purchase_cost_shares` 与 `inventory_adjustments`；渠道名在工作区内忽略大小写唯一。
- 采购写入、成本承担写入和成本合计校验在同一数据库事务内完成；成功后分别记录 `inventory.channel.create`、`inventory.purchase.create` 审计日志，日志只保存 ID、数量和金额，不保存链接或备注正文。
- 现有商品、批次和工作区表不改动。目标数据库迁移前必须备份；应用回退不读取新表，默认不执行破坏性反向迁移。

## 验收标准

- 两条同批次同商品采购在库存中合并数量与成本，但详情保留不同渠道、付款人和成本承担。
- 未填写成本承担、承担合计不等于总成本、非参与人付款/承担、跨工作区商品或渠道、负数/两位小数成本、零数量全部被拒绝。
- owner/editor 可新增；viewer 和跨批次用户不能写；批次成员可按权限读取。
- 移动端能从批次详情进入库存，完成新增采购，看到刷新后的汇总与详情；覆盖 Loading、Empty、Error、只读、提交中与成功状态。
- 编辑采购后汇总与采购明细同步更新；减少库存必须填写原因，不能超过可卖数量，详情保留减少记录和对应成本。
