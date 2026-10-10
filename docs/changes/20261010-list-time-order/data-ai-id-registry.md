# 列表排序定位注册表

既有商品/商品组、账单选择与交易明细定位 ID 保留。人员多选内部 ID 见 `../20261010-shared-multi-select/data-ai-id-registry.md`。

| ID | 含义 |
| --- | --- |
| `settlement-sale-type-filter` | 销售类型过滤区域 |
| `settlement-sale-type-all` | 全部类型 |
| `settlement-sale-type-sale` | 普通销售 |
| `settlement-sale-type-quick-sale` | 快速售出 |
| `settlement-sales-list` | 合并销售列表 |
| `settlement-sale-{saleId}` | 普通销售选择项（保留） |
| `settlement-quick-sale-{quickSaleId}` | 快速售出选择项（保留） |
| `product-catalog-list` | 合并商品列表（保留） |
| `product-item-{productId}` | 独立商品（保留） |
| `product-group-item-{groupId}` | 商品组（保留） |
| `settlement-detail-sale-{saleId}` | 已确认账单普通销售明细 |
| `settlement-detail-quick-sale-{quickSaleId}` | 已确认账单快速售出明细 |
| `settlement-detail-transactions` | 已确认账单交易（保留） |

动态 ID 仅由固定前缀与稳定数据库 ID 生成；同源/异源列表 key 使用来源和 ID。类型使用固定值，不包含用户输入。
