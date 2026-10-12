# 交易状态筛选与联动撤销定位

所有既有页面 ID 保留；记录行继续使用稳定 UUID。状态选项 ID 使用固定枚举值。
| ID | 用途 |
| --- | --- |
| transaction-sale-status-section | 销售状态筛选行 |
| transaction-sale-status-filter | 销售状态单选 |
| transaction-sale-status-option-{pending/settled/reversed/all} | 销售状态选项 |
| transaction-expense-status-section | 费用状态筛选行 |
| transaction-expense-status-filter | 费用状态单选 |
| transaction-expense-status-option-{pending/settled/reversed/all} | 费用状态选项 |
| transaction-expense-summary | 费用条数与排序说明 |
| transaction-sales-empty | 销售空态 |
| transaction-expense-empty | 费用空态 |
| transaction-reversal-notice | 列表销售联动撤销说明 |
| quick-sale-reversal-notice | 快速售出详情联动说明 |
| `expense-occurred-at-{expenseId}` | 费用发生时间 |
| `expense-transaction-{expenseId}` | 费用关联销售或独立费用说明 |
| `user-manual-faq-transaction-status` | 手册交易状态筛选说明 |
| `expense-create-entry` | 记录其他费用入口 |
