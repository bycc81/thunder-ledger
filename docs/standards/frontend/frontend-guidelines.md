# ThunderLedger 移动端前端规范

本规范是当前 `apps/web` 的生效前端规范。旧版桌面端规范保留在
[`frontend-guidelines-pc-legacy.md`](frontend-guidelines-pc-legacy.md)，仅用于追溯历史实现。

## 技术栈与结构

- 使用 Vue 3、Vite、TypeScript、Vue Router、Pinia 和 Vant 4。
- 页面按业务域拆分为 `pages`、`layouts`、`components`、`stores`、`api` 和 `composables`。
- 移动端 H5/PWA 是当前正式入口；桌面端暂不维护并行布局。
- 继续复用现有 API 和权限校验，前端显隐不等于授权。

## 页面与导航

- 顶部显示当前工作区和切换入口，工作区切换使用 Popup/Picker。
- 底部主导航分为工作区、批次、操作记录、我的四个入口。
- 工作区管理、批次管理、操作记录是不同业务模块，不能混在一个页面。
- 批次详情使用独立页面；短表单和添加参与人使用 Dialog 或全屏弹层。
- 页面必须提供加载、空数据、错误、无权限、禁用和成功反馈状态。

## 视觉与交互

- 使用 Vant 4 组件和统一主题变量，不引入第二套 UI 组件库。
- 页面以清晰列表和详情为主，避免卡片墙、渐变、营销 Hero 和装饰性大面积背景。
- 触控目标不小于 44px；正文和说明文字有明确层级，说明文字不得大于字段标签。
- 表单在移动端优先采用单列布局，字段标签和值清晰对齐。
- 角色使用 Tag，状态必须同时使用文字和颜色表达。
- 删除、移除等危险操作使用红色样式和二次确认，并放在主操作之外。
- 删除批次只从批次列表或更多操作入口发起，不放在编辑表单主操作区。

## 语义化 AI 定位标识

完整规则见 [`data-ai-id-guidelines.md`](data-ai-id-guidelines.md)。

实现页面时只需按该通用规范绑定业务定位 ID，并在需求目录维护对应注册表；本文件不重复列出命名和覆盖细则。

## 验证

在 `apps/web` 执行：

```powershell
npm run typecheck
npm run build
```

关键流程的自动化测试优先使用 `data-ai-id`，并在移动端常用视口检查无横向溢出、遮挡和拥挤。
