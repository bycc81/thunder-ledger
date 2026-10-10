# 交易列表定位注册表

动态部分使用 API 返回的稳定业务 ID，不包含商品名称、用户名、关键词或时间。既有销售、快速售出、费用及撤销 ID 保持原值。

| data-ai-id | 节点 |
| --- | --- |
| `transaction-page` | 页面根节点 |
| `transaction-back` | 返回导航 |
| `transaction-tabs` | 交易类型切换区域 |
| `transaction-sales-tab` / `transaction-expenses-tab` | 销售 / 其他费用切换 |
| `transaction-error` / `transaction-retry` | 加载失败 / 重试 |
| `sale-list` | 销售列表区域 |
| `sale-create-entry` / `quick-sale-create-entry` | 普通销售 / 快速售出入口 |
| `transaction-sale-filters` | 销售筛选区域 |
| `transaction-product-keyword` | 商品名称关键词搜索框 |
| `transaction-member-filter` | 公共多选组件根区域，标签与选择框同行 |
| `transaction-member-filter-dropdown` | 带边框的人员选择框 |
| `transaction-member-filter-trigger` | 人员下拉触发标题 |
| `transaction-member-filter-panel` | 锚定选择框的人员菜单实际弹层 |
| `transaction-member-filter-options` | 多选人员列表 |
| `transaction-member-filter-option-{userId}` | 批次人员选项 |
| `transaction-members-empty` | 无批次人员提示 |
| `transaction-member-filter-reset` / `transaction-member-filter-apply` | 重置人员草稿 / 应用人员筛选 |
| `transaction-filter-summary` | 数量及排序提示 |
| `transaction-clear-filters` | 清除全部筛选 |
| `transaction-sales-empty` | 未录入 / 筛选无结果提示 |
| `sale-item-{saleId}` / `quick-sale-item-{quickSaleId}` | 普通 / 快速销售详情入口 |
| `sale-source-{saleId}` / `quick-sale-source-{quickSaleId}` | 交易来源标签 |
| `sale-status-{saleId}` / `quick-sale-status-{quickSaleId}` | 撤销 / 结账状态 |
| `sale-reversal-{saleId}` / `quick-sale-reversal-{quickSaleId}` | 撤销销售入口 |
| `expense-list` / `expense-item-{expenseId}` | 费用列表 / 费用项 |
| `expense-status-{expenseId}` / `expense-reversal-{expenseId}` | 费用状态 / 撤销入口 |
| `transaction-reversal-dialog` / `transaction-reversal-reason` | 撤销确认弹窗 / 原因输入 |

Vant Dialog 内置确认和取消按钮位于 `transaction-reversal-dialog` 实际弹层内，通过按钮角色和文本定位。
