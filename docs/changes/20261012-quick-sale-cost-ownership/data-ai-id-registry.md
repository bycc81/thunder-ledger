# 快速售出成本归属定位注册表

保留既有快速售出页面 ID。`{itemId}` 为稳定页面临时 ID 或数据库 UUID，`{userId}` 为成员 UUID，`{shareId}` 为递增的页面内固定草稿 ID；新增后不随选择或删除其他行变化，不使用用户输入。

| ID | 用途 |
| --- | --- |
| `quick-sale-item-{itemId}-ownership` | 无库存成本编辑区域 |
| `quick-sale-item-{itemId}-payer` | 必填付款人选择 |
| `quick-sale-item-{itemId}-shares` | 成本承担编辑列表 |
| `quick-sale-item-{itemId}-share-add` | 添加承担成员 |
| `quick-sale-item-{itemId}-share-distribute` | 均摊本行成本 |
| `quick-sale-item-{itemId}-share-{shareId}` | 稳定草稿承担行 |
| `quick-sale-item-{itemId}-share-{shareId}-member` | 承担成员选择 |
| `quick-sale-item-{itemId}-share-{shareId}-amount` | 承担金额输入 |
| `quick-sale-item-{itemId}-share-{shareId}-remove` | 删除承担草稿行 |
| `quick-sale-item-{itemId}-share-total` | 承担合计校验提示 |
| `quick-sale-item-{itemId}-ownership-inventory` | 库存来源归属提示 |
| `quick-sale-detail-item-{itemId}-ownership` | 详情成本归属区域 |
| `quick-sale-detail-item-{itemId}-allocation-{allocationType}-{userId}` | 详情付款/承担明细 |
