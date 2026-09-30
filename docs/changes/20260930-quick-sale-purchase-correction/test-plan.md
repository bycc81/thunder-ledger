# 快速售出后的采购更正测试计划

## 结论

验证快速售出关联库存后，采购编辑页能够要求并提交更正原因，且未关联库存、已撤销快速售出和普通采购不受影响。

## 验收场景

| 编号 | Requirement | Scenario | 预期结果 |
| --- | --- | --- | --- |
| S1 | R1 销售识别 | 普通销售数为 0、关联库存的快速售出数为 1 | `hasSales` 为 true |
| S2 | R1 销售识别 | 两种销售数均为 0 | `hasSales` 为 false |
| S3 | R2 页面入口 | 快速售出关联库存后编辑该商品采购 | 显示 `inventory-purchase-correction-reason`，不再发生“页面无入口却要求填写” |
| S4 | R2 提交 | 已填写原因后保存采购更正 | 请求携带原因，继续服务端正常校验 |
| S5 | R3 边界 | 快速售出未关联该商品库存，或该快速售出已撤销 | 不触发更正原因要求 |

## 自动化验证

- `apps/backend`: `npm run typecheck`、`npm test`；纯函数测试覆盖 S1、S2。
- `apps/web`: `npm run typecheck`、`npm run build`。

## 人工验收

在 390x844 视口：创建一笔关联库存的快速售出，进入该商品采购编辑页，确认“更正原因”字段出现；填写原因并保存。撤销该快速售出后重新进入采购编辑页，确认字段不出现。

## 结果与残留风险

2026-09-30 已通过：

- `apps/backend`: `npm run typecheck`、`npm test`（19/19，含 S1/S2 回归测试）。
- `apps/web`: `npm run typecheck`、`npm run build`。

未接入本地真实数据库时，S3-S5 仍需按人工步骤完成；不以构建通过替代页面验收。
