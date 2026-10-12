# 结算个人明细定位注册表

原型与正式页面沿用相同业务 ID；prototype-* 仅用于原型审核工具，不进入产品。UUID 示例由固定前缀和业务 ID 生成，不使用姓名或输入。

| ID | 含义 |
| --- | --- |
| `prototype-controls` | 原型/页面区域与控件 |
| `prototype-review-note` | 原型/页面区域与控件 |
| `prototype-scenario` | 原型/页面区域与控件 |
| `prototype-step-cost` | 原型/页面区域与控件 |
| `prototype-step-preview` | 原型/页面区域与控件 |
| `settlement-auto-cost-breakdown` | 原型/页面区域与控件 |
| `settlement-create-page` | 创建账单页面（保留） |
| `settlement-member-details-body` | 明细滚动区域 |
| `settlement-member-details-close` | 关闭弹窗 |
| `settlement-member-details-empty` | 暂无明细 |
| `settlement-member-details-error` | 加载失败 |
| `settlement-member-details-formula` | 原预览结果组成公式 |
| `settlement-member-details-loading` | 加载中 |
| `settlement-member-details-mismatch` | 金额不一致提示 |
| `settlement-member-details-missing` | 分摊缺失提示 |
| `settlement-member-details-popup` | 实际弹窗根节点 |
| `settlement-member-details-retry` | 重试 |
| `settlement-member-details-summary` | 个人金额汇总 |
| `settlement-next` | 下一步/确认入口（保留） |
| `settlement-preview` | 原型/页面区域与控件 |
| `settlement-preview-member-results` | 原型/页面区域与控件 |
| `settlement-preview-transfers` | 原型/页面区域与控件 |
| `settlement-profit-allocation` | 原型/页面区域与控件 |
| `settlement-member-details-cost` | 个人明细汇总/分类 |
| `settlement-member-details-payments` | 个人明细汇总/分类 |
| `settlement-member-details-expenses` | 个人明细汇总/分类 |
| `settlement-member-details-receipts` | 个人明细汇总/分类 |
| `settlement-member-details-profit` | 个人明细汇总/分类 |
| `settlement-cost-share-{memberId}` | 第2步人员成本入口（保留） |
| `settlement-profit-share-{memberId}` | 利润比例（保留） |
| `settlement-preview-member-result-{memberId}` | 预览人员结果（保留） |
| `settlement-preview-member-details-{memberId}` | 第3步明细入口（保留） |
| `settlement-member-details-cost-record-{source}-{saleId}` | 本人销售承担成本 |
| `settlement-member-details-payment-record-{source}-{saleId}` | 本人付款归属 |
| `settlement-member-details-receipt-record-{source}-{saleId}` | 本人收款 |
| `settlement-member-details-expense-record-{expenseId}` | 本人垫付费用 |
| `settlement-member-details-source-{source}-{saleId}` | 销售成本来源展开 |
| `settlement-member-details-inventory-{source}-{saleId}` | 库存详情入口 |
| `settlement-member-details-quick-item-{itemId}` | 快速售出商品项（原顺序） |
| `settlement-member-details-consumption-{consumptionId}` | 商品项已记录的库存消耗 |

source 使用固定 sale/quick-sale；业务ID使用数据库ID。弹窗关闭/重试键盘可达，summary使用原生展开语义。
