# `data-ai-id` 注册表：B1 移动端工作台

本实例遵循通用规范 [`docs/standards/frontend/data-ai-id-guidelines.md`](../../standards/frontend/data-ai-id-guidelines.md)，记录 B1 移动端工作台的稳定业务定位 ID。重复项使用业务主键，不依赖展示文案。

| ID | 类型 | 所在区域 | 用途 |
|---|---|---|---|
| `workspace-overview` | 页面根 | 工作区概览 | 页面定位 |
| `app-brand` | 区域 | 顶部 | 品牌定位 |
| `topbar` | 区域 | 顶部 | 顶部栏定位 |
| `workspace-selector` | 控件 | 顶部 | 打开工作区切换 |
| `workspace-picker` | 弹层 | Popup 根 | 工作区列表定位 |
| `workspace-option-{workspaceId}` | 列表项 | Popup | 选择工作区 |
| `workspace-header` | 区域 | 标题区 | 当前工作区信息 |
| `batch-create-overview` | 控件 | 标题区 | 新建批次 |
| `workspace-stats` | 区域 | 统计区 | 统计定位 |
| `recent-batches` | 区域 | 最近批次 | 列表定位 |
| `batch-item-{batchId}` | 列表项 | 最近批次 | 打开批次详情 |
| `recent-batches-more` | 控件 | 最近批次 | 进入批次列表 |
| `quick-actions` | 区域 | 快捷操作 | 操作列表定位 |
| `quick-members` | 控件 | 快捷操作 | 进入成员页 |
| `quick-batches` | 控件 | 快捷操作 | 进入批次页 |
| `quick-audit` | 控件 | 快捷操作 | 进入操作记录 |
| `bottom-navigation` | 导航 | 底部 | 主导航定位 |
| `nav-workspace` | 导航项 | 底部 | 工作区 |
| `nav-batches` | 导航项 | 底部 | 批次 |
| `nav-audit` | 导航项 | 底部 | 操作记录 |
| `nav-profile` | 导航项 | 底部 | 我的 |
| `batch-create-dialog` | 弹窗 | 新建批次 | 弹窗根 |
| `batch-create-name` | 输入框 | 新建批次 | 批次名称 |
| `batch-create-cancel` | 控件 | 新建批次 | 取消 |
| `batch-create-submit` | 控件 | 新建批次 | 创建 |

## 批次

| ID | 类型 | 所在区域 | 用途 |
|---|---|---|---|
| `batches-page` | 页面根 | 批次列表 | 页面定位 |
| `batch-list-header` | 区域 | 批次标题 | 标题与主操作 |
| `batch-filters` | 区域 | 筛选 | 搜索与状态筛选 |
| `batch-search` | 输入框 | 筛选 | 搜索批次 |
| `batch-status-filter` | 选择器 | 筛选 | 按状态筛选 |
| `batch-list` | 区域 | 批次列表 | 列表定位 |
| `batch-item-{batchId}` | 列表项 | 批次列表 | 打开批次详情 |
| `batch-more-{batchId}` | 控件 | 批次列表 | 更多危险操作 |
| `batch-delete-confirm` | 弹窗 | 删除批次 | 删除确认弹层根 |
| `batch-detail-page` | 页面根 | 批次详情 | 页面定位 |
| `batch-detail-topbar` | 区域 | 批次详情顶部 | 返回操作 |
| `batch-detail-summary` | 区域 | 批次详情 | 只读摘要 |
| `batch-detail-name` | 区域 | 批次详情 | 展示批次名称 |
| `batch-name-edit` | 控件 | 批次详情 | 打开批次名称修改弹窗 |
| `batch-name-edit-dialog` | 弹窗 | 批次名称修改 | 弹窗根 |
| `batch-name-edit-input` | 输入框 | 批次名称修改 | 输入批次名称 |
| `batch-member-list` | 区域 | 批次详情 | 成员列表 |
| `batch-member-item-{userId}` | 列表项 | 批次成员 | 成员定位 |
| `batch-member-role-{userId}` | 控件 | 批次成员 | 调整角色 |
| `batch-member-remove-{userId}` | 危险操作 | 批次成员 | 移除参与人 |
| `participant-add` | 控件 | 批次成员 | 打开添加参与人弹窗 |
| `participant-add-dialog` | 弹窗 | 添加参与人 | 弹窗根 |
| `participant-user` | 选择器 | 添加参与人 | 选择工作区成员 |
| `participant-role` | 选择器 | 添加参与人 | 选择批次角色 |
| `participant-role-picker` | 弹层 | 添加参与人 | 选择编辑者或查看者 |
| `participant-remove-confirm` | 弹窗 | 批次成员 | 移除参与人确认弹层根 |

## 成员、操作记录与账号

| ID | 类型 | 所在区域 | 用途 |
|---|---|---|---|
| `workspace-members-page` | 页面根 | 成员 | 页面定位 |
| `member-list` | 区域 | 成员 | 成员列表 |
| `member-item-{userId}` | 列表项 | 成员 | 成员定位 |
| `member-invite` | 控件 | 成员标题 | 打开邀请弹窗 |
| `member-invite-dialog` | 弹窗 | 邀请成员 | 弹窗根 |
| `member-invite-username` | 输入框 | 邀请成员 | 邀请用户名 |
| `member-invite-role` | 选择器 | 邀请成员 | 邀请角色 |
| `member-role-{userId}` | 控件 | 成员列表 | 调整成员角色 |
| `member-remove-{userId}` | 危险操作 | 成员列表 | 移除成员 |
| `member-remove-confirm` | 弹窗 | 成员列表 | 移除成员确认弹层根 |
| `operation-record-page` | 页面根 | 操作记录 | 页面定位 |
| `operation-record-list` | 区域 | 操作记录 | 记录列表 |
| `operation-record-{recordId}` | 列表项 | 操作记录 | 记录定位 |
| `operation-record-refresh` | 控件 | 操作记录 | 刷新当前工作区记录 |
| `profile-page` | 页面根 | 我的 | 页面定位 |
| `profile-account` | 区域 | 我的 | 当前账号 |
| `profile-workspace` | 区域 | 我的 | 当前工作区 |
| `profile-role` | 区域 | 我的 | 当前角色 |
| `profile-logout` | 危险操作 | 我的 | 退出登录 |
| `profile-logout-confirm` | 弹窗 | 我的 | 退出登录确认弹层根 |
