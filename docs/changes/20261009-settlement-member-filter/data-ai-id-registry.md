# 创建账单人员筛选定位注册表

既有 ID 保留，新增或调整的节点如下；动态部分仅使用接口返回的稳定业务 ID。

| ID | 节点 | 用途 |
| --- | --- | --- |
| `settlement-member-filter` | 下拉筛选区域 | 收款人筛选入口及键盘操作 |
| `settlement-member-filter-trigger` | 下拉标题 | 全部人员 / 已选人员数 |
| `settlement-member-filter-dropdown` | 下拉实际容器 | Vant 下拉框的可见弹层容器 |
| `settlement-member-filter-panel` | 面板根 | 人员多选与操作区 |
| `settlement-member-filter-options` | 复选框组 | 当前批次全部人员 |
| `settlement-member-filter-option-{memberId}` | 复选框 | 指定批次人员 |
| `settlement-member-filter-reset` | 按钮 | 清空待确认的筛选 |
| `settlement-member-filter-apply` | 按钮 | 应用筛选并关闭 |
| `settlement-member-filter-summary` | 状态 | 可见 / 已选 / 隐藏已选笔数 |
| `settlement-sales-empty` | 空态 | 没有待结算销售或筛选无匹配 |
| `settlement-sales-select-all` | 既有按钮 | 全选当前可见普通及快速销售 |
| `settlement-sales-clear` | 既有按钮 | 清空当前可见销售勾选 |
| `settlement-sales-list` | 既有列表 | 当前筛选结果 |
| `settlement-sale-{saleId}` | 既有列表项 | 普通销售及勾选 |
| `settlement-quick-sale-{saleId}` | 既有列表项 | 快速售出及勾选 |
| `settlement-next` | 步骤主按钮 | 进入利润、预览和确认步骤 |
