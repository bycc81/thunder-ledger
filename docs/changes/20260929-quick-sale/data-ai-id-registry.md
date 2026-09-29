# 快速售出 data-ai-id 注册表

变更目录：`docs/changes/20260929-quick-sale/`
命名：ASCII kebab-case；不拼用户输入；重复项带稳定业务 ID。

## 快速售出表单页

| data-ai-id | 元素 |
| --- | --- |
| quick-sale-form-page | 页面根节点 |
| quick-sale-form-topbar | 顶部导航 |
| quick-sale-form-back | 返回按钮 |
| quick-sale-form-notice | 提示文案区 |
| quick-sale-form-order | 整单信息区 |
| quick-sale-total-price | 成交总价输入 |
| quick-sale-seller-select | 卖出人选择 |
| quick-sale-occurred-at | 成交时间 |
| quick-sale-channel | 销售渠道 |
| quick-sale-fee-section | 平台手续费区块 |
| quick-sale-fee-mode | 手续费方式单选组（无/按比例/按金额） |
| quick-sale-fee-mode-none | 手续费-无 |
| quick-sale-fee-mode-percentage | 手续费-按比例 |
| quick-sale-fee-mode-amount | 手续费-按金额 |
| quick-sale-fee-value | 手续费比例/金额 |
| quick-sale-fee-preview | 手续费与预计实收预览 |
| quick-sale-note | 备注 |
| quick-sale-item-list | 商品项列表容器 |
| quick-sale-add-item | 添加商品项按钮 |
| quick-sale-cost-preview | 成本合计预览 |
| quick-sale-received-preview | 实收预览 |
| quick-sale-submit | 保存并扣减库存按钮 |

## 商品项（重复项，追加 `{itemId}`）

| data-ai-id | 元素 |
| --- | --- |
| quick-sale-item-{itemId} | 商品项根节点 |
| quick-sale-item-{itemId}-remove | 删除该项（图标按钮，二次确认） |
| quick-sale-item-{itemId}-name | 商品名输入（自由文本/选择已有商品） |
| quick-sale-item-{itemId}-quantity | 售出数量计数器 |
| quick-sale-item-{itemId}-cost | 本单成本输入（必填，允许 0，始终可编辑且手工输入优先） |
| quick-sale-item-{itemId}-cost-fill | 按库存成本按钮（可用条件：已开启关联库存、已选择关联数据、关联数量≥1；带出=关联单位成本合计×售出数量） |
| quick-sale-item-{itemId}-link-toggle | 关联库存开关 |
| quick-sale-item-{itemId}-inventory-list | 已关联库存列表 |
| quick-sale-item-{itemId}-inventory-pick | 添加关联库存按钮 |

## 关联库存项（重复项，追加 `{itemId}-{inventoryId}`）

| data-ai-id | 元素 |
| --- | --- |
| quick-sale-item-{itemId}-inventory-item-{inventoryId} | 关联库存项根节点 |
| quick-sale-item-{itemId}-inventory-item-{inventoryId}-qty | 关联数量计数器（下限 1，上限该库存可用量） |
| quick-sale-item-{itemId}-inventory-item-{inventoryId}-remove | 删除该项关联（图标按钮，二次确认） |

## 关联库存选择弹层

| data-ai-id | 元素 |
| --- | --- |
| inventory-picker-popup | 弹层遮罩/根节点 |
| inventory-picker-sheet | 弹层面板 |
| inventory-picker-item-{inventoryId} | 可选项行 |
| inventory-picker-item-{inventoryId}-check | 选项勾选 |
| inventory-picker-cancel | 取消 |
| inventory-picker-confirm | 确认关联 |

## 普通销售数量控件

| data-ai-id | 元素 |
| --- | --- |
| sale-quantity | 普通销售数量步进器：可直接输入，最小值为 1，最大值为当前商品可卖数量；未选择商品时禁用 |

## 交易列表中的快速售出项

| data-ai-id | 元素 |
| --- | --- |
| quick-sale-item-{quickSaleId} | 快速售出列表项根节点 |
| quick-sale-source-{quickSaleId} | 列表项右上角的快速售出来源标签 |
| quick-sale-status-{quickSaleId} | 已结账或已撤销状态标签 |
| quick-sale-reversal-{quickSaleId} | 撤销快速售出操作 |

## 交易列表中的普通销售项

| data-ai-id | 元素 |
| --- | --- |
| sale-source-{saleId} | 列表项右上角的普通销售来源标签 |

## 快速售出详情页

| data-ai-id | 元素 |
| --- | --- |
| quick-sale-detail-page | 页面根节点 |
| quick-sale-detail-topbar | 顶部导航 |
| quick-sale-detail-back | 返回按钮 |
| quick-sale-detail-status | 结算状态 |
| quick-sale-detail-source | 售出方式来源标识（快速售出） |
| quick-sale-detail-summary | 摘要区 |
| quick-sale-detail-time | 成交时间 |
| quick-sale-detail-payment | 收款区 |
| quick-sale-detail-cost | 成本区 |
| quick-sale-detail-items | 商品明细区 |
| quick-sale-detail-settlement-open | 结算状态入口 |
| quick-sale-detail-reverse | 撤销按钮（危险操作，需二次确认） |

## 快速售出表单页-数量不一致确认弹窗

| data-ai-id | 元素 |
| --- | --- |
| quick-sale-mismatch-dialog | 商品项关联数量与售出数量不一致确认弹窗 |

## 交易页入口

| data-ai-id | 元素 |
| --- | --- |
| sale-create-entry | 交易页新建普通销售入口 |
| quick-sale-create-entry | 交易页新建快速售出入口 |

## 费用表单页（关联快速售出）

| data-ai-id | 元素 |
| --- | --- |
| expense-quick-sale-select | 费用关联快速售出选择控件 |
| expense-quick-sale-picker | 快速售出选择弹层 |

## 结算创建页（快速售出候选，重复项追加 {saleId}）

| data-ai-id | 元素 |
| --- | --- |
| settlement-quick-sale-{saleId} | 可勾选的快速售出候选行 |

## 结算详情页（统一交易列表）

| data-ai-id | 元素 |
| --- | --- |
| settlement-detail-transactions | 统一交易列表（含普通销售与快速售出） |
