# 创建账单关键词筛选定位注册表

| data-ai-id | 节点 |
| --- | --- |
| `settlement-sale-filters` | 商品关键词与人员筛选区域 |
| `settlement-product-keyword` | 商品名称搜索框包装根节点 |
| `settlement-member-filter` | 既有收款人公共多选组件根节点 |
| `settlement-member-filter-summary` | 可见、已选与筛选外已选数量 |
| `settlement-sales-empty` | 暂无待结算销售或筛选无匹配 |
| `settlement-sales-select-all` / `settlement-sales-clear` | 仅全选/清空当前筛选结果 |
| `settlement-sales-list` | 筛选后的销售列表 |
| `settlement-sale-{saleId}` / `settlement-quick-sale-{saleId}` | 普通销售及快速售出项 |

人员控件内部、销售项、费用及步骤 ID 全部保留，完整 ID 见 [既有页面注册表](../20261009-settlement-member-filter/data-ai-id-registry.md)。搜索框的清除图标使用 Vant 自带控件，通过搜索根节点定位；业务 ID 只绑定包装根，避免透传重复。
