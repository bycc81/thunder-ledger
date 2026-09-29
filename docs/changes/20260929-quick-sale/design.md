# 快速售出技术设计

## 结论

采用独立的快速售出单、商品行、关联库存消耗和结算快照表实现，不改变既有 `sales`、采购、上架记录的语义或历史数据。关联库存只记录商品 ID 与数量；成本账本按该数量扣减库存并计算库存账成本，而快速售出的结算成本以表单输入值为准。

产品流程和 HTML 原型已确认，可以进入实现。生产迁移、备份和发布仍须在实现与本地验证完成后另行获得明确确认。

## 风险等级

`L2`。本功能新增数据库结构，并扩展库存时间线成本账本、费用关联、阶段结算和报表汇总；错误会直接影响库存数量、成本和成员结算金额。

## 产品与 UX 输入

- 产品与 UX 定义：[product-ux.md](product-ux.md)
- HTML 原型：[prototype/index.html](prototype/index.html)
- 产品确认状态：已确认
- UX 与原型确认状态：已确认

实现不得改变已确认的成本输入优先、库存关联计数器、数量不一致二次确认、删除二次确认和按钮尺寸规则。

## 背景与目标

现有销售只能对一个既有商品录入并必然扣减该商品库存。组合售出、一次出售多种商品和无库存来源的售出，需要拆成多次操作或先建商品并上架。

快速售出提供一张可含多个商品行的售出单。商品名可自由填写；每行可关联零到多个现有库存商品并填写各自消耗数量。保存后关联库存按数量减少；快速售出与普通销售在费用、结算、成员分摊和报表中使用同一经济口径，仅以来源标识区分展示。

## 非目标

- 不修改既有普通销售、上架、采购、库存调整的接口、数据含义或操作路径。
- 不自动创建商品、商品组、上架记录或采购库存。
- 不把整单成交总价强制拆分到商品行。
- 不编辑已保存快速售出；修正采用撤销后重录。
- 不改动已确认的阶段账单；已结账快速售出不可撤销。

## 当前实现与缺口

| 现有模块 | 当前事实 | 本次缺口 |
| --- | --- | --- |
| `sales` / `sales-expenses.ts` | 单商品销售，`product_id` 必填，重放商品库存成本 | 缺少多行自由商品名、可选多库存关联和快速售出撤销 |
| `cost-ledger.ts` | 仅重放采购、普通销售、库存调整 | 缺少快速售出库存事件、成本回填与分摊 |
| `expenses` | 仅可关联普通销售 `sale_id` | 不能关联快速售出 |
| `settlements.ts` | 候选和账单快照仅覆盖 `sales` | 不能把快速售出同等纳入结算 |
| `reports.ts` | 仅汇总 `sales` | 快速售出不会进入经营统计 |
| `TransactionsPage` | 仅销售/费用页签 | 缺少快速售出入口、列表和详情 |

## 数据设计与迁移

新增 `apps/backend/migrations/021_quick_sales.sql`。所有金额使用分（`*_cents`）、时间使用 `timestamptz`；迁移 SQL 包含中文说明且可重复执行。

| 表/改动 | 关键字段 | 用途 |
| --- | --- | --- |
| `quick_sales` | `id`、`batch_id`、`total_price_cents`、手续费快照、`seller_user_id`、`occurred_at`、`note`、创建审计字段 | 快速售出单头，成交总价属于整单 |
| `quick_sale_items` | `id`、`quick_sale_id`、`position`、`name`、`quantity`、`cost_cents` | 自由商品名、售出数量和用户输入/带入的本单成本 |
| `quick_sale_inventory_consumptions` | `id`、`quick_sale_item_id`、`product_id`、`quantity`、`consumed_cost_cents` | 关联旧库存的唯一记录，按数量扣库存；同一商品行唯一 |
| `quick_sale_inventory_cost_allocations` | `consumption_id`、`allocation_type`、`user_id`、`amount_cents` | 成本账本计算的库存实际成本及采购付款/承担来源 |
| `quick_sale_cost_allocations` | `quick_sale_id`、`allocation_type`、`user_id`、`amount_cents` | 用于结算的本单成本分摊 |
| `quick_sale_reversals` | `quick_sale_id`、`reason`、`created_by`、`created_at` | 撤销审计，保留原单 |
| `settlement_bill_quick_sales` | `settlement_bill_id`、`quick_sale_id`、商品摘要、总数量、成交/手续费/本单成本、卖出人、成交时间 | 已确认账单的不可变快速售出快照；快速售出唯一避免重复结算 |
| `expenses` | 新增可空 `quick_sale_id`，且与 `sale_id` 互斥 | 费用可关联普通销售或快速售出，也可不关联交易 |
| `settlement_bill_expenses` | 新增可空 `quick_sale_id` | 冻结费用所关联的快速售出来源 |

约束：数量均为正整数；金额均为非负整数；商品行名称去除首尾空格后不得为空；`sale_id` 与 `quick_sale_id` 最多存在一个；关联记录必须属于同一批次。既有费用的 `quick_sale_id` 默认为空，无数据回填。

## 成本、库存与并发

### 两种成本口径

| 口径 | 来源 | 用途 |
| --- | --- | --- |
| 本单成本 | 每个商品行 `cost_cents`；以当前表单输入为准，“按库存成本”只是一键填充 | 详情、阶段结算、利润报表 |
| 库存账消耗成本 | 按关联库存数量和发生时间重放，写入 `quick_sale_inventory_consumptions.consumed_cost_cents` | 剩余库存成本、采购更正重放、库存准确性 |

两者允许不同，不能以库存账成本覆盖用户输入。本单成本用于结算。按库存成本按钮仅在关联开关已开、已选关联数据、且至少一项关联数量大于等于 1 时可用；带入值为关联库存单位成本合计乘商品行售出数量。

### 成本账本与并发

`cost-ledger.ts` 增加 `quick-sale` 事件：查询关联库存记录并连接快速售出发生时间，排除已撤销单据。普通采购、调整、销售的排序和结果保持不变。重放某商品时，快速售出消耗与普通销售一样校验发生时库存，成功后回填消耗成本并重建 `quick_sale_inventory_cost_allocations`。

创建或撤销快速售出时，对所有涉及 `product_id` 按 UUID 固定顺序锁定采购记录并逐个重放，防止并发超卖；任一库存不足则整个事务回滚。

### 结算成本分摊

快速售出结算使用本单成本：有库存关联的商品行，按关联消耗的实际采购付款/成本承担分配作为权重等比例分摊该行 `cost_cents`；无关联、实际成本为零或无权重时，成本付款与承担都记入卖出人。分取整余额按稳定用户 ID 分配，最终 payer/burden 总额均严格等于快速售出本单成本合计。

### 数量规则

后端校验每项关联数量为正数，且同一商品跨所有商品行的总关联数量不超过发生时间的可用库存。商品行售出数量和关联库存数量允许不同，系统不得自动修改任一数量。

前端保存前发现不一致时显示 Vant 二次确认框：取消则停留表单修改，确认则按用户填写值提交；后端不把不一致视为错误。

## 页面/API 契约

### 页面与数据

| 页面区域 | 原型/业务 ID | 展示或编辑字段 | 权限 | 交互结果 |
| --- | --- | --- | --- | --- |
| 快速售出表单 | `quick-sale-form-page` | 整单价格、卖出人、时间、渠道、手续费、备注、商品行 | 批次 owner/editor | 保存新单并重放关联库存 |
| 商品行 | `quick-sale-item-{itemId}` | 名称、售出数量、本单成本、关联开关及库存项 | 批次 owner/editor | 增加/移除行和关联项；删除均二次确认 |
| 关联库存弹层 | `inventory-picker-sheet` | 库存商品与可用量 | 批次 owner/editor | 多选并填写每项数量，范围 1..可用量 |
| 快速售出详情 | `quick-sale-detail-page` | 收款、两类成本、商品/库存明细、费用、结算状态、来源标识 | 批次可读 | 未结账可撤销，已结账可查看账单 |
| 交易页快速售出列表 | `quick-sale-list`（实现时登记） | 单据摘要、来源、结账/撤销状态 | 批次可读 | 查看详情，有编辑权可新增/撤销 |
| 结算草稿 | 既有候选列表新增来源 tag | 普通销售与快速售出统一候选项 | 批次可读；owner 确认 | 同样勾选、同样计算 |

### 操作与接口边界

| 操作 | 入口 ID | 前置条件 | 接口 | 成功结果 | 失败反馈 | 二次确认 |
| --- | --- | --- | --- | --- | --- |
| 创建快速售出 | `quick-sale-submit` | 至少一行、字段合法、可编辑批次 | `POST /api/batches/:batchId/quick-sales` | 返回 id，跳详情 | `INVALID_QUICK_SALE`、`INSUFFICIENT_INVENTORY_AT_TIME`、`BATCH_CLOSED` | 数量不一致时 |
| 删除商品行 | `quick-sale-item-{itemId}-remove` | 行存在 | 仅本地表单 | 移除行 | 无 | 是 |
| 移除关联库存 | `quick-sale-item-{itemId}-inventory-item-{inventoryId}-remove` | 关联项存在 | 仅本地表单 | 移除关联 | 无 | 是 |
| 撤销快速售出 | `quick-sale-detail-reverse` | 可编辑、未结账、未撤销 | `POST /api/batches/:batchId/quick-sales/:id/reversals` | 库存恢复 | `QUICK_SALE_SETTLED`、`ALREADY_REVERSED` | 是，且需原因 |
| 新增关联费用 | 既有费用表单 | 至多关联一种交易 | 既有 `POST /expenses` 增加 `quickSaleId` | 费用随单进入结算 | `INVALID_EXPENSE` | 否 |
| 预览/确认结算 | 既有结算操作 | owner、批次开放、候选有效 | 结算 API 增加 `quickSaleIds` | 统一成员结算与快照 | `INVALID_SETTLEMENT` | 既有规则 |

### 创建接口

`POST /api/batches/:batchId/quick-sales` 请求字段：`totalPrice`、`sellerUserId`、`occurredAt`、`salesChannel`、手续费字段、`note`、`items`。每项为 `name`、`quantity`、`cost`、`inventoryConsumptions[]`；每个库存关联为 `productId`、`quantity`。

- `items` 至少一行；名称最多 200 字；数量为正整数；金额为非负、最多两位小数。
- 手续费沿用普通销售 percentage/amount 互斥校验，且不大于成交总价。
- 成功响应为 `{ "id": "uuid" }`；审计事件为 `quick_sale.create`。

读取接口：

- `GET /api/batches/:batchId/quick-sales`：按发生时间、创建时间倒序返回来源、摘要、价格、手续费、本单成本、卖出人、撤销/结账状态。
- `GET /api/batches/:batchId/quick-sales/:id`：返回单头、商品行、关联库存、库存账成本、关联费用和结算摘要。
- 撤销接口 body 为 `{ "reason": "..." }`；事务内锁单、检查未结账/未撤销、写撤销记录并重放库存；审计事件为 `quick_sale.reverse`。

### 费用、结算和报表兼容

- 费用 API 增加 `quickSaleId`；它与 `saleId` 不能同时提供。费用读取返回两者和 `transactionSource`。
- 结算草稿新增统一 `transactions`，普通销售和快速售出对象均有 `source: "sale" | "quick_sale"` 与 `sourceLabel`；保留既有 `sales` 字段以兼容现有客户端。
- 结算预览和确认请求增加 `quickSaleIds`；两类 ID 分别校验，页面仅按统一候选列表展示。账单详情同样新增 `transactions`，保留 `sales`。
- 快速售出用 `settlement_bill_quick_sales` 保存不可变快照；普通销售仍使用 `settlement_bill_sales`。
- `reports.ts` 将两种来源归一化到销售、利润、成员、待结算报表；快速售出销售成本取本单成本，未关联库存的快速售出不改变库存统计。

### 错误、状态与定位

| 错误码 | 场景 | 页面反馈 |
| --- | --- | --- |
| `INVALID_QUICK_SALE` | 字段、成员、库存归属或金额非法 | 提示检查商品、数量、成本、成交价和卖出人 |
| `INSUFFICIENT_INVENTORY_AT_TIME` | 发生时间库存不足 | 展示账本返回的时间和可用库存 |
| `QUICK_SALE_SETTLED` | 已结账单据撤销 | 已纳入账单的快速售出不能撤销 |
| `ALREADY_REVERSED` | 重复撤销 | 这笔快速售出已经撤销 |
| `INVALID_EXPENSE` | 同时关联两种交易或交易无效 | 请选择一笔有效的关联交易 |

加载有占位，空态保留新增入口，viewer 只读且隐藏写操作；按库存成本不满足三条件时置灰；成功后 Toast 并刷新/跳转。实现遵循 [data-ai-id-registry.md](data-ai-id-registry.md)：重复项只用稳定 UUID/临时 ID，不使用用户输入；删除图标、撤销和数量不一致确认均为 Vant Dialog。按钮为行内 36px、次级 40px、保存/确认/危险 44px。

## 方案与影响范围

### 后端

- 新建 `apps/backend/src/quick-sales.ts` 并在 `app.ts` 注册，复用批次权限、关闭批次检查、金额/时间校验和审计。
- 扩展 `cost-ledger.ts`、`sales-expenses.ts`、`settlements.ts`、`reports.ts`；普通销售端点和返回字段保持兼容。
- 新增后端测试覆盖 API、账本、结算和回归。

### 前端

- 新建 `QuickSaleFormPage.vue`、`QuickSaleDetailPage.vue`，注册 `/batches/:id/quick-sales/new`、`/batches/:id/quick-sales/:quickSaleId`。
- 扩展交易页、费用表单、结算创建/详情页和 `api.ts` 类型；复用 Vant、`DangerConfirmDialog.vue`，不引入新 UI 库。

### 配置、部署与审计

- 无新增环境变量、密钥、外部服务或角色。
- 审计 `quick_sale.create`、`quick_sale.reverse`，仅保留必要 UUID、数量、金额和来源，不记录备注。
- 后端、前端和迁移变化需重新构建镜像；生产前数据库备份、构建和健康检查必做。

## 风险、备份与回滚

| 风险 | 控制 | 回滚 |
| --- | --- | --- |
| 数量扣错或发生时间库存不足 | 事务、固定顺序锁、账本重放、409 和专项测试 | 未结账单撤销恢复库存；不直接改历史金额 |
| 本单成本和库存账成本不同 | 详情并列展示并明确结算口径 | 撤销后重录修正，不覆盖用户输入 |
| 结算遗漏单据/费用 | 统一候选、来源互斥约束、账单快照、回归测试 | 未确认账单重预览；已确认账单按既有调整机制处理 |
| 迁移失败 | 生产前备份，先本地/测试验证 | 仅追加修复迁移，不改已应用历史迁移 |
| 并发超卖 | 固定顺序锁定并全量重放 | 事务回滚，不写半成品 |
| 权限绕过 | 服务端复用批次权限与关闭批次检查 | 补回归测试，不新增角色 |

生产迁移和发布属于 L2 外部状态变更；实现完成后先报告备份、迁移、构建和健康检查结果，等待用户明确确认再执行。

## 验收标准

- 可不建商品、不上架，直接创建多商品行快速售出。
- 每行可自由填写名称、数量、本单成本；库存可多选、计数器范围正确、图标删除并二次确认。
- 系统不改用户填写数量；不一致时用户可取消修改或确认继续保存。
- 保存后仅关联库存减少；库存账按发生时间重放；结算使用本单成本。
- 快速售出与普通销售在费用、结算候选、账单详情、销售/利润/成员/待结算报表中统一计算，仅显示来源。
- 撤销须二次确认和原因；未结账恢复库存，已结账拒绝。
- 既有普通销售、采购、库存调整、费用、结算和报表正确。

## 库存口径修复记录（2026-09-29）

普通销售表单的 `GET /api/batches/:batchId/products` 可售数量与库存总览必须使用同一口径：采购数量减普通销售、库存调整和未撤销快速售出的关联库存消耗。快速售出未关联库存的商品行不影响该数量。

本次仅修正该读取接口的聚合查询；不修改快速售出、普通销售、库存账本、成本或结算的写入与计算规则。

## 零成本采购与快速售出结算入口修复（2026-09-29）

- 商品组采购总成本为 `0.00` 时，款式成本和每位承担人均允许为 `0.00`；分摊函数直接返回各承担人 0，禁止进行 0/0 计算或写入无效金额。
- 结算首页的待结算数量同时统计普通销售和快速售出；已确认账单的交易数量同样合并两类交易。快速售出仍需由 owner 在既有“开始结算”流程中确认生成账单，不会在保存快速售出时自动生成账单。
- 本次不修改快速售出的成本、利润、库存扣减或账单快照计算规则，只恢复其在结算入口和账单列表中的可见性。

## 开发任务绑定

| 开发任务 | 产品/UX 条目 | Requirement + Scenario | 验证 |
| --- | --- | --- | --- |
| 迁移与账本 | 关联库存、成本口径 | R1/S1-S3：关联、超库存、并发 | 后端测试、迁移检查 |
| 快速售出 API | 创建、详情、撤销 | R2/S4-S10：自由商品、成本、数量确认、撤销 | API 测试 |
| 费用/结算 | 统一结算 | R3/S11-S15：费用、候选、快照、分摊 | 结算回归 |
| 报表 | 经营数据准确 | R4/S16：两类销售汇总 | 报表测试 |
| 移动端 | 已确认原型 | R5/S6-S8：计数器、确认、来源、按钮 | typecheck/build、目标视口截图 |
