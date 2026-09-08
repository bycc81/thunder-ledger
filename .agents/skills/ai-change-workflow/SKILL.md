---
name: ai-change-workflow
description: 用于 ThunderLedger 的功能开发、缺陷修复、重构、部署和文档变更，把轻量风险流程转成可执行步骤。
---

# ThunderLedger AI 变更执行器

本 Skill 服务于单人维护、低并发的 Vue + Fastify + PostgreSQL 经营管理后台。核心目标是快速交付，同时保证认证、数据、部署和界面质量。

## 执行步骤

### 1. 确认输入

用简短文字确认需求、期望产出、影响范围、非目标和验收方式。信息不足但可以安全判断时，直接说明假设并继续。

### 2. 判断风险

- `L0`：文档、注释、样式和低风险脚本。直接修改并做静态检查。
- `L1`：普通页面、CRUD、API、列表、表单和交互。先写简短变更说明，再运行相关 typecheck/test/build。
- `L2`：认证、权限、数据库结构、收益计算、敏感数据、安全策略、生产部署和不可逆操作。先写设计与测试计划，明确数据、权限、迁移、回滚和验收；生产或不可逆操作前必须获得用户明确确认。

无法判断时按更高等级处理。风险等级不是审批层级，默认由开发者完成设计、实现、测试和自审。

### 3. 读取事实来源

先读取 `AGENTS.md` 和 `docs/standards/ai-workflow.md`，再按任务读取当前模块的 README、类型、接口、迁移和测试。

涉及 `apps/web`、Vue、TypeScript、Less、路由、页面、组件、表单、表格或视觉样式时，必须先读取并遵循 `docs/standards/frontend/frontend-guidelines.md`；部署任务读取 `docs/deployment.md`；安全任务读取 `docs/standards/security.md`。

不得引用不存在的旧平台组件、协议、目录或历史计划。

### 4. 选择流程深度与 Product/UX 路由

- `L0`：保持范围最小，直接修改并自检。
- `L1`：写明目标、影响和验收后实现，必要时补充测试。
- `L2`：使用 `docs/standards/change-templates/design.md` 和 `docs/standards/change-templates/test-plan.md` 建立记录，明确接口、数据、权限、迁移、回滚和残留风险后再实现。

新模块和新页面必须在技术设计前进入 Product/UX 阶段：

1. 在对话中提出产品方案，明确用户、问题、目标、范围、主流程和关键边界。
2. 用户确认产品目标、用户流程和关键边界后，创建 `product-ux.md`，在同一文档记录产品规则、页面规格、关键状态和页面验收。
3. 创建可运行的 `prototype/index.html`。
4. 用户确认原型的页面结构、主流程和关键交互后，才创建或更新 `design.md`；其中的页面/API 契约章节确定字段、操作、权限、状态、接口边界和 `data-ai-id` 绑定，再进入 Vue/后端实现。

新模块/新页面必须使用 `docs/changes/YYYYMMDD-feature/` 目录，并包含 `product-ux.md`、`prototype/index.html`、`data-ai-id-registry.md` 和 `design.md`；`test-plan.md` 仅 L2 必需，`changelog.md` 仅多阶段或需要持续记录时使用。原型只使用原生 HTML/CSS/少量 JavaScript，可直接浏览器打开，不接真实 API。

已有页面的小范围样式、文案或字段调整不触发完整 Product/UX 流程。若已有页面优化明显改变布局、信息层级、主流程或操作路径，先询问用户是否需要原型；用户要求时才进入该阶段。`data-ai-id` 通用规则见 `docs/standards/frontend/data-ai-id-guidelines.md`。截图仅用于留档、远程审查或视觉回归，不作为默认门禁。不默认读取 BMAD、OpenSpec 或其他外部项目全文。

### 5. 设计后实现

沿用现有模块、类型、接口和视觉规范，不为未来场景提前引入服务、队列或复杂抽象。新增 SQL 必须有中文说明、表/字段含义和可重复迁移。

### 6. 验证与修复

- 后端：在 `apps/backend` 运行 `npm run typecheck`、`npm test`。
- 前端：在 `apps/web` 运行 `npm run typecheck`、`npm run build`。
- 数据库/部署：按改动运行 `npm run db:check`、`docker compose config`、`docker compose build` 和 `/api/healthz`、`/api/readyz` 检查。
- UI 变更：检查目标页面的空态、错误态、禁用态、键盘焦点和主要交互。

测试失败时可修复后重跑相关命令；连续三轮失败后停止自动修复并记录原因和替代验证。不运行与本次改动无关的重型检查。

### 7. 高风险确认

生产发布、不可逆迁移、删除或重置数据、放开权限、修改收益规则或启用安全策略前，先报告影响、备份、回滚和验证结果，等待用户明确确认。

### 8. 交付自审

交付前确认目标、范围、风险等级、验收证据、密钥安全、文档路径和未验证项清晰。最终说明必须包含风险等级、改动摘要、验证结果、残留风险、待确认动作和更新的文档或记录。

## 禁止事项

- 不自动生产发布、删除数据或启用高风险安全/权限/收益策略。
- 不把构建通过当作完整业务验收。
- 不提交密码、Token、连接串或真实隐私数据。
- 不创建或引用不存在的目录、旧平台专属组件或未确认的业务规则。

## 文档编码规范

- Markdown、HTML 和 Skill 文件统一使用 UTF-8 编码。
- 中文文档禁止使用乱码、替换字符或经过错误编码转换的文本。
- 修改文档后，必须用 UTF-8 重新读取检查，并搜索旧路径和不可见替换字符。
- 文档路径变更必须同步更新 `AGENTS.md`、相关 Skill、索引和交付记录。
