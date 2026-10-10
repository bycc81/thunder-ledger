# 公共下拉多选定位注册表

两个业务调用均保持既有前缀和用户 ID，通用组件内部 DOM ID 使用 Vue `useId()` 避免实例间重复，不作为业务定位或 CSS 选择器。

| ID 模式 | 节点 |
| --- | --- |
| `{aiId}` | 整个字段：标签和选择框 |
| `{aiId}-dropdown` | 选择框容器 |
| `{aiId}-trigger` | 选择框值，位于 combobox 按钮内 |
| `{aiId}-panel` | Teleport 后的菜单实际根节点 |
| `{aiId}-options` | 多选列表 |
| `{aiId}-option-{value}` | 选项，value 为稳定业务 ID |
| `{aiId}-reset` | 清空待确认值 |
| `{aiId}-apply` | 应用选择并关闭 |
| `{aiId}-empty` | 无选项提示；可用 emptyAiId 保留旧 ID |

业务实例：

- 交易页：`transaction-member-filter`，旧空态 `transaction-members-empty` 保持原值；具体节点见 [交易页注册表](../20261010-transaction-filters/data-ai-id-registry.md)。
- 创建账单页：`settlement-member-filter`，增加 `settlement-member-filter-empty`；具体节点见 [账单页注册表](../20261009-settlement-member-filter/data-ai-id-registry.md)。
