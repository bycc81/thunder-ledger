---
version: alpha
name: ThunderLedger-design-system
description: 面向订单、账目、报表和协作的友好型个人经营工作台。借鉴 Airtable 的结构化语言，使用明亮画布、珊瑚色主操作、低饱和状态面、紧凑表格和克制圆角。

colors:
  canvas: "#f8fafc"
  surface: "#ffffff"
  surface-soft: "#f5f7f9"
  surface-muted: "#eef1f4"
  ink: "#181d26"
  body: "#333840"
  muted: "#68717d"
  hairline: "#dfe3e8"
  hairline-strong: "#b9c1cb"
  primary: "#aa2d00"
  primary-active: "#872400"
  primary-soft: "#fff0eb"
  on-primary: "#ffffff"
  accent-forest: "#0a2e0e"
  accent-mint: "#a8d8c4"
  accent-peach: "#fcab79"
  accent-yellow: "#f4d35e"
  accent-mustard: "#d9a441"
  success: "#237a52"
  success-soft: "#e6f5ed"
  warning: "#9a6500"
  warning-soft: "#fff5d9"
  danger: "#b9412e"
  danger-soft: "#fcebe8"
  info: "#4267a8"
  info-soft: "#eaf0fb"
  focus: "#458fff"

typography:
  display: { fontFamily: "Inter, system-ui, sans-serif", fontSize: 28px, fontWeight: 600, lineHeight: 1.2, letterSpacing: 0 }
  title-lg: { fontFamily: "Inter, system-ui, sans-serif", fontSize: 22px, fontWeight: 600, lineHeight: 1.3, letterSpacing: 0 }
  title-md: { fontFamily: "Inter, system-ui, sans-serif", fontSize: 18px, fontWeight: 600, lineHeight: 1.4, letterSpacing: 0 }
  label: { fontFamily: "Inter, system-ui, sans-serif", fontSize: 14px, fontWeight: 600, lineHeight: 1.4, letterSpacing: 0 }
  body: { fontFamily: "Inter, system-ui, sans-serif", fontSize: 14px, fontWeight: 400, lineHeight: 1.45, letterSpacing: 0 }
  body-sm: { fontFamily: "Inter, system-ui, sans-serif", fontSize: 13px, fontWeight: 400, lineHeight: 1.4, letterSpacing: 0 }
  caption: { fontFamily: "Inter, system-ui, sans-serif", fontSize: 12px, fontWeight: 500, lineHeight: 1.35, letterSpacing: 0 }
  numeric: { fontFamily: "Inter, system-ui, sans-serif", fontSize: 24px, fontWeight: 600, lineHeight: 1.2, letterSpacing: 0 }
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12px, fontWeight: 400, lineHeight: 1.4, letterSpacing: 0 }

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 10px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px

---

## 总览

ThunderLedger 是个人经营工作台，不是企业级控制中心。界面应像整理好的桌面：中性、安静的表面，紧凑的信息块，以及帮助快速扫描工作的少量色彩。Airtable 提供结构语言，轻盈画布和友好状态色降低生硬的企业感。

登录后的工作区是第一体验。不要使用营销式 Hero、超大的宣传卡片或装饰渐变；优先保证表格可读性、快速筛选、键盘友好的表单和可预测的导航。

## 颜色角色

- `{colors.canvas}` 用于应用背景和页面留白。
- `{colors.surface}` 用于面板、表格、抽屉和弹窗表面。
- `{colors.primary}` 只用于新建、保存、确认等主操作和当前导航标记。
- `{colors.primary-soft}` 用于选中行和激活筛选的浅色提示，不用于大面积页面色带。
- `{colors.accent-mint}`、`{colors.accent-peach}`、`{colors.accent-yellow}`、`{colors.accent-mustard}` 只用于统计卡片、标签和分类标记等小面积区域。
- 语义色只表示状态、校验和通知；珊瑚色主色不能代替成功色。
- 正文使用 `{colors.ink}` 或 `{colors.body}`；`{colors.muted}` 只用于元数据。

## 字体

全站使用 Inter 或平台系统无衬线字体。标题使用中等字重并保持紧凑，通过字号和表面对比建立层级，不依赖过粗字重。订单号、账目引用和技术值使用 `{typography.mono}`。

## 布局原则

- 应用外壳桌面端使用 232px 固定侧边栏和弹性内容区；1024px 时折叠为图标栏，768px 以下改为抽屉。
- 顶栏高度 56px，包含面包屑、全局搜索、快速新建和用户菜单。
- 主内容最大宽度 1440px；桌面左右留白 24px，移动端留白 16px。
- 以 4px 为间距基数。紧凑表格行使用 12px 垂直内边距，表单分区间距 24px。
- 每个视口只突出一个主任务；次要操作使用文字按钮或描边按钮。
- 不在卡片内嵌套卡片；整页区域使用无框布局，卡片只用于重复记录、统计、弹窗和有明确边界的工具。

## 层次与形状

通过 `{colors.canvas}` 与 `{colors.surface}` 的对比和细边框建立层次。阴影只用于菜单、抽屉、弹窗和 Toast（`0 12px 32px rgba(24,29,38,.12)`）。标准卡片使用 1px `{colors.hairline}` 边框和 `{rounded.lg}`（10px）圆角；输入框和按钮使用 `{rounded.sm}` 或 `{rounded.md}`。胶囊形只用于状态标签和分段筛选。

## 组件规范

### 应用外壳

**`sidebar`**：`{colors.surface}` 背景、右侧细边框、桌面宽度 232px、水平内边距 12px。按工作区域分组导航（概览、订单、账目、报表、团队）。当前项使用 `{colors.primary-soft}` 背景、`{colors.primary}` 图标/文字和 3px 左侧标记。标签使用自然、易懂的业务语言。

**`topbar`**：高度 56px，`{colors.surface}` 背景和底部细边框。左侧放面包屑，右侧放搜索、快速新建、通知和头像。快速新建是顶栏唯一的实心操作。

### 操作

**`button-primary`**：`{colors.primary}` 背景、白色文字、最小高度 36px、水平内边距 12px、`{rounded.md}` 圆角。用于新建、保存、确认和提交；激活态使用 `{colors.primary-active}`。

**`button-secondary`**：白色或 `{colors.surface-soft}` 背景、`{colors.ink}` 文字、1px `{colors.hairline}` 边框，尺寸和圆角与主按钮一致。

**`button-ghost`**：透明背景、`{colors.body}` 文字、水平内边距 8px。用于行操作、取消和低强调导航。

**`button-icon`**：32px 正方形、`{rounded.sm}` 圆角；不熟悉的图标必须提供 tooltip。优先使用 lucide 图标。

### 筛选与表单

**`filter-bar`**：位于页面标题下方的横向区域，先放搜索和选择控件。激活筛选显示为 `{rounded.full}` 胶囊，使用 `{colors.primary-soft}` 背景；有筛选时提供清空全部操作。

**`text-input`、`select`、`textarea`**：`{colors.surface}` 背景、`{colors.ink}` 文字、1px `{colors.hairline}` 边框、44px 高度、12px 水平内边距、`{rounded.sm}` 圆角。聚焦时使用 2px `{colors.focus}` 外轮廓，不改变布局尺寸。

**`field`**：标签位于控件上方，标签与控件间距 6px，辅助/错误文字位于控件下方。错误使用 `{colors.danger}` 和 `{colors.danger-soft}`，并保留用户原始输入。

**`form-section`**：无框内容分组，包含标题、可选说明和桌面端双列网格；768px 以下变为单列。长表单的保存/取消操作固定在底部。

### 数据与状态

**`data-table`**：全宽表面，1px 细边框和 8px 外圆角。表头使用 `{colors.surface-soft}`，标签使用 `{typography.caption}`，单元格水平内边距 12px。正文使用 `{typography.body-sm}`，垂直内边距 12px。行使用底部细边框，悬停使用淡 `{colors.primary-soft}`，选中行使用 3px 珊瑚色内侧标记。需要横向滚动时，首个标识列和右侧操作列保持固定。

**`table-toolbar`**：包含视图切换、列显示、导出和批量操作。只有选中行后才显示批量操作，使用 `{colors.surface-soft}`，不要再增加第二个实心主按钮。

**`status-badge`**：紧凑胶囊，文字 12px，垂直内边距 4px、水平内边距 8px。使用成功、警告、危险或信息的浅色背景，并始终显示文字。

**`stat-card`**：白色表面、1px 细边框、10px 圆角、16px 内边距。用 `{typography.numeric}` 数值配短标签和一个小趋势/状态标记。 pastel 色只用于顶部边框或图标底，不铺满整个仪表盘。

**`empty-state`**：在内容区居中，包含简单线性图标、一句话和一个主/次操作。不要使用抢占首次任务注意力的插画。

### 覆盖层与反馈

**`modal`**：白色表面、10px 圆角、24px 内边距、中等阴影、最大宽度 560px。仅用于确认或短表单，长记录编辑使用抽屉。

**`record-drawer`**：桌面宽度 480px，移动端全宽；白色表面、左侧阴影、固定头部和底部操作，保留后方表格上下文。

**`toast`**：白色表面、语义色 3px 左边框、12px 圆角、简洁消息和关闭图标，不能只靠颜色传达含义。

## 响应式行为

- 1024px：侧边栏折叠为图标栏，表格密度不变。
- 768px：侧边栏改为抽屉，表单网格变为单列，表格工具栏允许换行。
- 640px 以下：表格横向滚动，标识列和操作列固定；文字不小于 12px。
- 抽屉变为全屏页面，主操作放在固定底部栏，触控目标不小于 44px。

## 应该做与不要做

### 应该做

- 保持画布明亮、信息密度高。
- 每个视口只用珊瑚色突出一个主操作和一个当前导航信号。
- 用低饱和色分类记录，不用来装饰所有表面。
- 让 ID、金额、日期和状态易于扫描和复制。
- 将危险操作与主操作分开并要求确认。

### 不要做

- 不使用深色优先表面、渐变、玻璃效果或超大 Hero 标题。
- 不让每个按钮都变成胶囊，也不把每个区域都做成圆角卡片。
- 不只用珊瑚、绿色或黄色表示状态。
- 不把筛选、批量操作或表格密度控制隐藏在无说明的图标后。
- 不把仪表盘做成五颜六色的卡片墙；表格和最近活动仍应是主要内容。

## 工程规范

### 技术栈与目录

使用 Vue 3、Vite、TypeScript、Element Plus 和 Less，代码位于 `apps/web`。公共 token 和组件样式放在 `apps/web/src/styles/`，页面私有规则使用 `<style lang="less" scoped>`。没有设计记录时不要新增其他 UI 框架。

### 组件与数据

- 先定义数据模型和 `props`/`emits`，再实现界面；子组件不得直接修改父状态。
- 展示组件与取数/编排组件分离，请求、弹窗等副作用集中在容器或 composable。
- 只抽取真实复用的组件，不为假设中的未来场景建立基类。
- API 返回是列表事实源；筛选条件发送前 trim，分页总数和列表必须来自同一查询。
- 页面显示业务名称和中文状态，只有排障、审计或契约场景直接显示 ID/编码。

### 页面与交互

- 列表页遵循“标题区、查询区、工具栏、一个主表格、分页”的顺序。
- 表单和列表都提供加载、空数据、错误、成功和重置反馈。
- 删除、覆盖、导出等危险操作需要确认，完成后从 API 事实源刷新数据。
- 前端显隐不等于授权，权限必须由 API 同时校验。
- 日期、金额和状态使用后端返回的业务字段，前端不拼造业务事实。

### 验证

在 `apps/web` 执行：

```powershell
npm run typecheck
npm run build
```

构建通过只代表产物可生成。涉及路由、表单、权限、列表状态或布局时，还必须在桌面和移动宽度完成可复现的页面检查，覆盖空态、错误态、禁用态、键盘焦点和主操作反馈。
