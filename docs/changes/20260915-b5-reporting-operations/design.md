# B5 技术设计与验收记录

## 结论

B5 按 L2 实现。首期只增加只读报表、权限范围内 CSV 导出和可筛选审计查询，不修改库存、销售、费用、结算写入流程，不新增数据库表或迁移。生产发布、生产数据库迁移、备份恢复和真实回滚仍需用户明确确认。

## 产品与 UX 确认

- 产品定义：[product-ux.md](product-ux.md)
- 原型：[prototype/index.html](prototype/index.html)
- 语义化 ID 注册表：[data-ai-id-registry.md](data-ai-id-registry.md)
- 原型确认状态：已确认，确认日期为 2026-09-15。

## 背景与目标

B1-B4 已形成库存、销售、费用、已确认结算账单和审计数据，但缺少统一只读查询。B5 为这些事实提供可追溯的报表视图，服务端按当前账号的工作区和批次权限重新计算数据范围。

## 非目标

- 不改写或删除业务事实。
- 不新增自动结算或利润分配规则。
- 不提供普通用户在线备份恢复、数据库删除或生产数据覆盖。
- 不让系统管理员仅凭全局账号身份绕过工作区成员边界。

## 当前实现与缺口

- 复用 `inventory_purchases`、`inventory_adjustments`、`sales`、`expenses`、`settlement_bill_sales`、`settlement_bill_expenses` 和 `audit_logs`。
- 复用 `batchContext` 的批次可读权限语义，但报表工作区入口会再次检查真实 `workspace_members`，避免只凭全局管理员标记扩大业务数据范围。
- 现有审计接口固定返回最近 200 条且不支持筛选；B5 将改为服务端筛选、分页和有限字段返回。

## 页面/API 契约

### 报表工作台

路由：`/reports`

筛选参数：

| 参数 | 类型 | 说明 |
|---|---|---|
| `workspaceId` | UUID | 必填，当前选择的工作区 |
| `batchId` | UUID | 可选；必须是当前用户可读批次 |
| `reportType` | `inventory \| sales \| profit \| members \| unsettled` | 必填 |
| `from`、`to` | `YYYY-MM-DD` | 可选，按 Asia/Shanghai 日界线包含首尾日期 |

接口：`GET /api/reports`

响应固定包含：

```json
{
  "reportType": "sales",
  "workspaceId": "uuid",
  "batchId": "uuid or null",
  "from": "YYYY-MM-DD or null",
  "to": "YYYY-MM-DD or null",
  "generatedAt": "ISO timestamp",
  "summary": [{ "key": "salesTotal", "label": "销售额", "value": "12.3" }],
  "rows": []
}
```

金额以字符串返回，单位为人民币元，内部沿用现有 `*_tenths` 一位小数口径。响应只返回用户可读取批次的数据。

报表字段：

- `inventory`：批次、商品、采购数量、销售数量、减少库存数量、可卖数量、采购成本和剩余成本；为当前库存快照，日期条件用于筛选采购/销售/减少库存事实。
- `sales`：汇总展示销售额、销售成本、销售利润（未扣费用）和销售数量；明细包含批次、商品、数量、销售额、销售成本、销售利润（未扣费用）、卖出人、发生时间、是否已结算。销售成本是已售商品对应的采购成本，销售利润等于销售额减销售成本；撤销销售不返回。
- `profit`：批次、销售额、费用、销售成本、利润、已结算销售额、待结算销售额。
- `members`：成员、销售额、销售数量、费用支付、采购支付、销售成本和贡献额。贡献额为该成员作为卖出人销售额减其销售成本，再减其作为付款人的费用，不替代结算净额。
- `unsettled`：批次、未结算销售笔数/金额、未结算费用笔数/金额、未结算毛利。

接口：`GET /api/reports/export`

使用与 `GET /api/reports` 相同的筛选参数。服务端重新执行权限和参数校验，再以 `text/csv; charset=utf-8` 返回 UTF-8 BOM CSV。CSV 第一行是字段名，字段集合由 `reportType` 固定决定，不包含密码、Token、连接串或完整审计 metadata。销售报表的“发生时间”固定按 `Asia/Shanghai` 输出为 `YYYY-MM-DD HH:mm:ss`。成功和失败都写入审计：

- 成功：`report.export`
- 失败：`report.export.failed`

### 操作记录

接口：`GET /api/audit`

参数：`workspaceId` 必填；`action`、`actorUserId`、`from`、`to` 可选；`page` 默认 1，`pageSize` 默认 50，最大 100。

响应：

```json
{
  "items": [{ "id": "uuid", "action": "sale.create", "entity_type": "sale", "entity_id": "uuid", "actor_username": "user", "created_at": "ISO timestamp" }],
  "total": 12,
  "page": 1,
  "pageSize": 50
}
```

只有当前工作区真实 `owner` 或 `admin` 成员可查。服务端只允许当前工作区的操作者过滤，不返回敏感 metadata。

## 权限与错误

- 未登录：`401 UNAUTHORIZED`。
- 工作区不是当前用户成员，或批次不是当前用户可读范围：`403 FORBIDDEN`；批次详情继续沿用现有 `404 NOT_FOUND` 隐藏资源策略。
- 筛选参数非法：`400 INVALID_REPORT_QUERY` 或 `400 INVALID_AUDIT_QUERY`。
- 查询失败：由 Fastify 错误处理返回 5xx，前端保留错误状态，不伪造空数据。
- CSV 生成失败：返回错误并写失败审计；不返回部分文件。

## 数据与金额口径

- 业务金额继续使用数据库中的整数十分之一元字段。
- 销售报表排除 `sale_reversals`；费用报表排除 `expense_reversals`。
- 已结算关系通过 `settlement_bill_sales` 和 `settlement_bill_expenses` 判断，不重算历史账单。
- 销售报表的销售利润按销售额 - 销售成本计算，明确标注为未扣费用。
- 利润报表按销售额 - 费用 - 销售成本计算；不把成员结算转账当作经营费用。
- 日期筛选按 `Asia/Shanghai` 的自然日闭区间转换为 PostgreSQL timestamptz 半开区间。

## 路由与前端实现

- 新增 `ReportsPage.vue` 和 `/reports` 路由。
- 工作区快捷操作增加“报表”入口；不改变底部导航的既有业务顺序。
- 报表页使用现有移动端 Vant 组件、工作区切换和状态模式，关键区域及控件沿用 `data-ai-id-registry.md`。
- 操作记录页增加动作、操作者和日期筛选，继续保留无权限状态。

## 数据库、迁移、部署与回滚

- 数据库迁移：不需要。
- 部署：只需发布后端和前端应用代码；不执行生产部署。
- 回滚：回滚应用版本即可，数据库无新增结构，无需反向迁移。若发现报表口径问题，先关闭报表入口或回滚应用，再核对现有业务事实。
- 备份恢复：本次只更新文档验收项，不执行生产备份或恢复，不宣称已经具备生产恢复能力。

## 验收标准

- 页面可查询五类报表，权限、批次和日期筛选在服务端生效。
- CSV 与页面使用相同查询契约，金额、时间和字段稳定；导出成功/失败可在审计中找到。
- owner/admin 可筛选审计，editor/viewer 无法读取工作区审计。
- 报表查询不写入业务表，不影响库存、销售、费用和结算主流程。
- 后端 `typecheck`、`test`，前端 `typecheck`、`build` 通过。
- 390×844 和 430×932 下无横向溢出、遮挡，关键 `data-ai-id` 与登记表一致。

## 风险与残留项

- 报表使用当前已有业务事实，不提供历史任意时点库存重建。
- 大工作区全量报表仍采用单次查询，后续如数据量增长需增加异步导出或数据库聚合索引。
- 生产备份供应商、保留周期、RTO/RPO 和真实恢复演练仍需运维确认。
