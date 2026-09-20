# 变更设计记录：销售详情

## 结论

在已确认的 [产品与 UX 定义](product-ux.md) 和 [HTML 原型](prototype/index.html) 基础上，新增销售详情的只读查询、前端路由和交易列表入口。实现只读取现有 `sales`、`expenses`、撤销记录及账单关联，不新增表、迁移、计算或写接口。

## 风险等级

`L1`。这是新只读页面和普通查询接口；接口必须沿用现有批次读取权限，且不得改变库存、手续费、成本或结算的计算结果。

## 产品与 UX 输入

- 产品与 UX 定义：[product-ux.md](product-ux.md)
- HTML 原型：[prototype/index.html](prototype/index.html)
- 产品确认状态：已确认。
- UX 与原型确认状态：已确认，保留“销售毛利（未扣其他费用）”。

## 背景与目标

交易页当前仅通过 `GET /api/batches/:batchId/sales` 显示销售概览。用户无法打开单笔销售核对备注、手续费计算、成本、关联其他费用、撤销信息和账单归属。

目标是在不修改既有记录的前提下，使拥有批次读取权限的用户可以阅读单笔销售详情，并在已结账时跳转到既有账单详情。

## 非目标

- 不修改 `sales`、`expenses`、库存、成本账本、账单或审计数据。
- 不新增、更改或删除销售、费用、撤销和结算规则。
- 不在详情页提供编辑、删除或撤销。
- 不新增费用详情页；关联其他费用只在销售详情中展示。

## 当前实现与缺口

- `apps/backend/src/sales-expenses.ts` 已提供批次销售列表与撤销接口，但没有单笔销售查询。
- `apps/web/src/pages/TransactionsPage.vue` 的销售行使用 `article` 展示，没有跳转事件。
- `apps/web/src/main.ts` 没有销售详情路由。
- `apps/web/src/api.ts` 的 `Sale` 已包含详情所需的销售本体字段；关联费用、所属账单 ID 与账单确认时间尚未由接口返回。

## 页面/API 契约

### 页面与数据

| 页面区域 | 原型/业务 ID | 展示字段 | 数据来源 | 权限 | 交互结果 |
|---|---|---|---|---|---|
| 交易销售列表 | `sale-item-{saleId}` | 现有销售摘要 | `GET /batches/:batchId/sales` | 批次可读 | 点击非撤销区域进入详情 |
| 销售详情摘要 | `sale-detail-summary` | 商品、数量、总价、状态、成交时间 | 单笔销售查询 | 批次可读 | 只读 |
| 收款 | `sale-detail-payment` | 总价、渠道、手续费方式/比例、手续费、实收、卖出人、时间 | 单笔销售查询 | 批次可读 | 只读 |
| 成本 | `sale-detail-cost` | 销售成本、销售毛利（未扣其他费用） | 单笔销售查询 | 批次可读 | 只读 |
| 关联其他费用 | `sale-detail-expenses` | 名称、金额、付款人、发生时间、撤销状态 | 单笔销售查询 | 批次可读 | 只读，无费用详情跳转 |
| 备注与撤销 | `sale-detail-note`、`sale-detail-reversal` | 备注、撤销原因、撤销时间 | 单笔销售查询 | 批次可读 | 只读 |
| 结算 | `sale-detail-settlement` | 已结账状态、账单确认时间、账单 ID | 单笔销售查询 | 批次可读 | 已结账时进入现有账单详情 |

### 读取接口

`GET /api/batches/:batchId/sales/:saleId`

- 鉴权：复用 `requireBatch(request, reply, batchId)` 的只读分支；调用方必须为当前批次可读成员。
- 资源范围：查询强制同时匹配 `sales.id = :saleId` 和 `sales.batch_id = :batchId`。不存在、跨批次或无读取权限统一按现有策略返回 `404`。
- 不执行写入、不调用成本账本重算、不记录审计日志。
- SQL 读取 `sales`、`products`、`users`、`sale_reversals`、`settlement_bill_sales`、`settlement_bills`，并以独立查询读取 `expenses` 与 `expense_reversals`。

响应契约（金额均为两位小数字符串）：

```ts
type SaleDetail = Sale & {
  grossProfit: string; // totalPrice - serviceFee - consumedCost，不扣关联其他费用
  expenses: Array<{
    id: string;
    name: string;
    amount: string;
    payerUserId: string;
    payerUsername: string;
    occurredAt: string;
    reversalReason: string | null;
    reversedAt: string | null;
  }>;
  settlement: null | {
    id: string;
    confirmedAt: string;
  };
};
```

明确的呈现规则：

- `grossProfit` 是服务端将已存的金额字段相减后返回的展示值，不回写、不影响任何结算值。
- `expenses` 返回关联本销售的所有费用，包括已撤销费用；前端以状态区分，且不额外汇总为“净利润”。
- `settlement` 为 `null` 时展示“待结账”；有值时展示“已结账”并跳转到 `/batches/:batchId/settlements/:settlementId`。
- `reversalReason` 有值时销售状态为“已撤销”，优先级高于结账状态。

### 前端路由与操作边界

| 操作 | 入口 ID | 前置条件 | 领域动作或接口 | 成功结果 | 失败反馈 | 二次确认 |
|---|---|---|---|---|---|---|
| 打开销售详情 | `sale-item-{saleId}` | 批次可读 | 跳转 `/batches/:id/transactions/sales/:saleId` | 加载详情 | 详情错误/不存在页 | 否 |
| 返回交易 | `sale-detail-topbar` | 无 | 跳转 `/batches/:id/transactions` | 回到销售列表 | 无 | 否 |
| 查看账单 | `sale-detail-settlement-open` | `settlement != null` | 跳转现有账单详情路由 | 打开账单 | 账单资源现有反馈 | 否 |
| 撤销销售 | `sale-reversal-{saleId}` | 原有权限与未结账条件 | 维持现有撤销接口 | 不跳转详情 | 维持现有反馈 | 是，维持原有对话框 |

新增前端路由：`/batches/:id/transactions/sales/:saleId`，组件为 `SaleDetailPage.vue`。路由必须定义在 `/transactions/sales/new` 之后，避免把 `new` 误解析为销售 ID。

列表行将改为语义化可点击元素或添加键盘事件；右侧撤销按钮必须调用 `stopPropagation`，以保证危险操作不会进入详情页。

### 状态与定位

| 状态 | 页面表现 | 可执行操作 | 数据与权限要求 |
|---|---|---|---|
| Loading | `sale-detail-loading` Loading | 返回 | 请求进行中 |
| Error | `sale-detail-error` 与 `sale-detail-retry` | 重试、返回 | 非 404 请求失败 |
| 不存在/无权限 | `sale-detail-not-found` | 返回交易 | 404 |
| 待结账 | 状态 Tag、无账单入口 | 返回 | `settlement = null` 且未撤销 |
| 已结账 | 状态 Tag 与账单入口 | 查看账单、返回 | `settlement != null` |
| 已撤销 | 状态 Tag、原因、时间 | 返回 | `reversalReason != null` |

`data-ai-id` 清单维护于 [data-ai-id-registry.md](data-ai-id-registry.md)。保留既有 `sale-item-{saleId}` 与 `sale-reversal-{saleId}`，并新增详情页 ID。

## 方案与影响范围

- 后端：`apps/backend/src/sales-expenses.ts` 新增只读 GET 路由；不改数据库结构。
- 前端：`apps/web/src/api.ts` 新增 `SaleDetail` 类型；`apps/web/src/main.ts` 增加路由；新增 `apps/web/src/pages/SaleDetailPage.vue`；调整 `TransactionsPage.vue` 的销售行点击与撤销事件隔离。
- 文档：维护本变更目录的设计、测试计划和定位 ID 注册表。
- 不影响 Docker、部署、迁移或环境变量。

## 风险与回滚

- 权限风险：单笔查询必须用批次 ID 限定并复用 `requireBatch`；禁止只按销售 ID 查询。
- 计算风险：接口只返回已存金额及展示性差值；不调用 `rebuildProductCostLedger`、不写入任何表。
- 交互风险：销售行可点击后，撤销按钮可能触发跳转；通过事件停止传播及人工验收控制。
- 回滚：删除新增路由与前端详情页，并移除 GET 路由即可；不涉及数据回滚。

## 验收标准

- 交易页点击一笔销售的非撤销区域，能进入对应销售详情；键盘 Enter 同样可进入。
- 详情展示的成交价、手续费、实收、成本和毛利与销售记录一致；毛利只作展示，不改变任何结算数据。
- 已关联费用、无关联费用、已撤销关联费用、待结账、已结账、已撤销销售均有明确界面反馈。
- 已结账销售可打开其对应账单；未结账或已撤销销售没有账单入口。
- viewer 可读取详情但没有新增写操作；无权限、跨批次和不存在销售不泄漏数据。
- `apps/backend` 的 typecheck/test 与 `apps/web` 的 typecheck/build 均通过；移动端 390×844 和 430×932 无横向溢出。

## 开发任务绑定

- 后端单笔查询：对应“可追溯的销售详情”需求与“核对闲鱼销售手续费”场景；通过 API 单测、权限用例和手工接口验证。
- 前端详情与入口：对应“可追溯的销售详情”需求；通过 `data-ai-id` 定位、移动视口和键盘验收。
- 账单跳转：对应“已结账销售可追溯账单”需求；通过已结账销售样本人工验收。
- 撤销隔离：对应“危险更正与详情分离”需求；通过点击撤销不跳转、二次确认仍可用的人工验收。
