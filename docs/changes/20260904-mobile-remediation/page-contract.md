# 页面、数据与接口契约：工作区概览

本文件是原型确认后前后端共同使用的契约。接口仍面向工作区、批次等业务领域，不按页面组件拆分。

本实例保留其形成时的页面/API/权限契约；当前流程已将页面/API 契约并入 [`design.md`](../../standards/change-templates/design.md)，后续原型迭代应同步更新对应设计，而不是只修改 HTML。

| 页面区域 | 原型 ID | 数据来源 | 权限 | 交互结果 |
|---|---|---|---|---|
| 页面根 | `workspace-overview` | 当前工作区状态 | 已登录 | 显示概览 |
| 工作区按钮 | `workspace-selector` | `GET /workspaces` | 已登录 | 打开切换 Popup |
| 工作区选项 | `workspace-option-{workspaceId}` | workspace.id/name/role | 已登录 | 选择后刷新范围数据 |
| 统计条 | `workspace-stats` | members.length、batches.length、audits.length | 按当前工作区 | 只读 |
| 新建批次 | `batch-create-overview` | `POST /batches` | owner/admin | 打开新建 Dialog |
| 最近批次区域 | `recent-batches` | `GET /batches?workspaceId=` | 当前工作区可访问 | 进入批次详情 |
| 最近批次项 | `batch-item-{batchId}` | batch.id/name/created_at/role/status | 当前工作区可访问 | 打开详情 |
| 成员快捷入口 | `quick-members` | 当前工作区成员计数 | 已登录 | 进入成员页 |
| 批次快捷入口 | `quick-batches` | 当前工作区批次数 | 已登录 | 进入批次页 |
| 操作记录快捷入口 | `quick-audit` | 当前工作区操作记录计数 | 按权限 | 进入操作记录页 |
| 底部导航 | `bottom-navigation` | 页面状态 | 已登录 | 切换主模块 |

## 批次项与详情补充契约

| 页面区域 | 结构约束 | 交互 |
|---|---|---|
| 首页/批次列表批次项 | 单列列表项；名称单独一行；创建时间和角色单独一行；状态标签固定右上角；箭头固定右侧 | 点击整项进入批次详情；更多菜单进入删除确认 |
| 批次详情摘要 | 不使用三列卡片；每个字段占满一行，label 右对齐、value 左对齐；创建时间不得截断 | 只读展示 |
| 批次名称 | 使用有边界的输入框；label 与 value 同行；value 左对齐 | owner/admin 可编辑并保存，其他角色只读 |
| 批次成员 | 单列成员项；角色使用 Tag；加入时间作为辅助文字 | 管理者可调整角色或移除 |

## 接口核对要求

- `GET /workspaces` 必须返回工作区 ID、名称和当前用户角色。
- `GET /workspaces/{id}/members`、`GET /batches?workspaceId={id}` 和 `GET /audit?workspaceId={id}` 必须使用同一个当前工作区 ID。
- 统计值必须由事实列表或后端明确字段计算，不使用原型中的固定数字。
- 权限判断前端只用于呈现，服务端继续做最终校验。
- 本轮不新增 API；如现有响应缺字段，先记录差异，回到产品/API 契约阶段确认后再改后端。
