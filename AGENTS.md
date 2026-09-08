# ThunderLedger 开发规则

ThunderLedger 是 Vue + Fastify + PostgreSQL 的经营管理后台单体应用，当前优先保证功能可用、数据准确和界面易用。

## 工作原则

- 开始任务先判断风险等级，再选择最小必要流程。
- 先确认目标、范围和验收结果，再修改代码或文档。
- 优先沿用现有模块、接口、数据库迁移和前端组件风格。
- 密码、连接串、会话密钥和 R2 凭据只通过环境变量或云 Secret 注入，不进 Git。
- 不在基础平台阶段提前实现未提出的商品、订单、库存或收益分配规则。
- 未获得用户明确指令时，不得执行 `git commit`、`git push`、变基、重写历史或其他改变 Git 历史/远端状态的操作；完成修改和验证后仅报告状态并等待指示。

## 三档风险

- **L0**：文档、注释、样式、低风险脚本。直接修改并做静态检查。
- **L1**：普通页面、CRUD、API 和交互。写简短变更说明，完成相关 typecheck/test/build。
- **L2**：认证、权限、数据库结构、收益计算、敏感数据、安全策略、生产部署或不可逆操作。先写设计和验收记录，完成专项验证；生产或不可逆操作前必须获得用户明确确认。

无法判断时按更高等级处理。日常开发由开发者完成设计、实现、测试和自审。

## 文档入口

- 流程：`docs/standards/ai-workflow.md`
- 设计模板：`docs/standards/change-templates/design.md`
- 产品与 UX 模板：`docs/standards/change-templates/product-ux.md`
- 测试模板：`docs/standards/change-templates/test-plan.md`
- 自审清单：`docs/standards/checklists/review-checklist.md`
- 前端规范：`docs/standards/frontend/frontend-guidelines.md`（当前移动端规范）
- 历史桌面端规范：`docs/standards/frontend/frontend-guidelines-pc-legacy.md`，仅用于追溯，不作为新页面实现依据。
- 凡涉及 `apps/web`、Vue、TypeScript、Less、路由、页面、组件、表单、表格或视觉样式的任务，必须先读取并遵循当前移动端前端规范。
- 关键业务 DOM 必须使用稳定的语义化 `data-ai-id`：页面区域、交互控件、弹窗、列表项和危险操作必填；命名使用 ASCII kebab-case；不得把用户输入直接拼入；不得用于 CSS；UI 改版需保留既有 ID。
- `data-ai-id` 通用规则见 `docs/standards/frontend/data-ai-id-guidelines.md`；具体需求在变更目录维护 `data-ai-id-registry.md`。
- 关键业务 DOM 必须使用稳定的语义化 `data-ai-id`：页面区域、交互控件、弹窗、列表项和危险操作必填；命名使用 ASCII kebab-case；不得把用户输入直接拼入；不得用于 CSS；UI 改版需保留既有 ID。
- 前端任务涉及 `data-ai-id` 时，遵循 `docs/standards/frontend/data-ai-id-guidelines.md`，并在具体需求目录维护 `data-ai-id-registry.md`。
- 新模块、新页面必须在技术设计前完成产品与 UX 定义和可运行 HTML 原型确认；确认后，在 `design.md` 的页面/API 契约章节确定字段、操作、权限和接口，再设计或调整 API。已有页面小修不触发该阶段，明显改变布局、信息层级、主流程或操作路径时先询问用户是否需要原型。具体顺序以 `docs/standards/ai-workflow.md` 和 `ai-change-workflow` Skill 为准。
- 部署说明：`docs/deployment.md`
- 安全规范：`docs/standards/security.md`

## 文档编码与路径规范

- Markdown、HTML 和 Skill 文件统一使用 UTF-8 编码，中文内容必须可正常显示，禁止提交乱码或替换字符。
- 修改文档后按 UTF-8 标准检查，确保内容和引用正确。
- 文档目录或文件改名时，必须同步更新 `AGENTS.md`、相关 Skill、`docs/README.md`、规范文档和变更记录。
- 文档引用只能指向仓库中实际存在的路径；个人预留资料若不属于交付范围，不纳入正式索引。
- 移动端页面必须在目标视口完成截图、关键交互和 `data-ai-id` 三项验收；typecheck/build 不能替代页面验收。

## 交付最低验证

- API：在 `apps/backend` 运行 `npm run typecheck`、`npm test`。
- Web：在 `apps/web` 运行 `npm run typecheck`、`npm run build`。
- 容器或部署改动：运行 `docker compose config`、`docker compose build`，并检查 `/api/healthz`、`/api/readyz`。
- 未运行的检查必须说明原因和替代验证。

## 交付输出

最终说明必须包含风险等级、改动摘要、验证结果、未验证项/残留风险，以及已更新的文档或记录。
