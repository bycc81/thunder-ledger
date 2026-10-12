# 个人结算明细专项验证

- 基线：对比HEAD现有settlements.ts/cost-ledger.ts/quick-sales.ts字节，确保算法与确认写入代码完全不变。
- 隔离真实Fastify路由fixture：普通、快速、混合、有/无关联库存、付款与承担不同、零成本、亏损、分币尾差。先取recommendation/preview/确认fixture结果，再查询新明细、再次取结果，响应与写入记录（排除生成账单ID）逐项一致。
- 明细查询数据库边界禁止业务INSERT/UPDATE/DELETE、FOR UPDATE和账本重建；只允许只读事务控制/SELECT。失败、校验提前返回也必须ROLLBACK/release。
- 权限/有效性：401、viewer403、跨批次404、非成员404、关闭409、UUID/重复400、普通/快速销售撤销或已结账409、无效费用409；原origin检查保留。
- 分项：承担/付款从已有记录求和，费用自动关联与收款净额一致；缺失分摊/非成员/商品项合计异常不补齐，返回诊断；快速商品顺序与原position一致、跨类型时间倒序。
- Web真实构建：第2/3步入口、默认成本展开、来源/库存入口、所有分类、0/缺失/不一致、长列表/长姓名、加载/错误/重试、切人/关闭过期请求、缓存及重新推荐失效；操作后selected/profits/payload不变、筛选外选择纳入。
- 390×844、430×932截图/交互/data-ai-id三项验收，无横向溢出，90dvh、Escape/焦点返回、滚动头部固定。
- API typecheck/test，Web typecheck/build；对新SELECT用开发PostgreSQL只读EXPLAIN，不创建或确认真实账单；UTF-8、文档链接及git diff --check。
- evidence/输出截图、日志、结果，正式文字不链接生成物。最终记录未验证分支与实际库仅只读范围。


## 执行结果（2026-10-12）

| 检查 | 结果 |
| --- | --- |
| Backend typecheck / test | 通过，19/19 |
| Web typecheck / build | 通过，新增弹窗独立资源 |
| verify-api.mjs | 通过，六类金额不变、只读记录、权限/有效性、异常回滚、缺失来源诊断 |
| verify-web.mjs | 通过，390×844、430×932真实页面交互、截图、定位ID及原payload不变 |
| 原结算成员筛选 verify.mjs | 通过，两视口筛选/隐藏选择/费用联动/推荐与预览负载回归 |
| verify-sql.mjs | 通过，开发PostgreSQL只读EXPLAIN 23条SELECT |
| 本地Web/API健康 | 5665 / 3000可用，healthz/readyz 200，新接口未认证401 |

API涵盖工作区owner/admin、批次owner/viewer、跨批次、关闭、无效成员、UUID/重复、无效销售/快速销售/费用、个人无分摊、分摊涉及非当前成员、快速商品项缺失/合计不符，以及数据库查询异常后ROLLBACK/release和下一请求恢复。

原型与实现分别生成截图；人工检查第3步公式、快速来源及长列表底部的版式/金额/固定头部。实际页面的个人分类空态显示零金额与明确提示；全局无明细兜底由原型覆盖，正式接口有效选择始终有销售，未伪造空响应扩充实际验收结论。

## 重复运行

先运行 Backend build/test 与 Web build。API/Web脚本必须通过环境变量提供隔离 `SESSION_SECRET` 和 fixture `DATABASE_URL`（不会连接该地址）；Web脚本使用Playwright Chromium，可通过 `PLAYWRIGHT_MODULE_PATH` 指向已有模块。不要在文档或Git中保存实际会话密钥。

```powershell
npm.cmd --prefix apps/backend run typecheck
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/web run typecheck
npm.cmd --prefix apps/web run build
node docs/changes/20261012-settlement-member-details/verify-api.mjs
node docs/changes/20261012-settlement-member-details/verify-web.mjs
# 在新进程使用开发环境的 .env；不要带入 fixture DATABASE_URL 覆盖真实只读连接。
node --env-file=.env docs/changes/20261012-settlement-member-details/verify-sql.mjs
```

原结算筛选验证脚本为 `docs/changes/20261009-settlement-member-filter/verify.mjs`；运行时 `THUNDERLEDGER_EVIDENCE_DIR` 指向本变更的 evidence/original-settlement/，避免改写旧交付记录。SQL脚本读取本次API捕获的SELECT参数，所以先运行API专项验证。

专项测试数据包含付款人与承担人不同、快速填写成本与库存消耗不同及未关联库存，不推算逐商品项个人承担。确认测试只捕获夹具写入，不连接真实业务数据库。真实库仅只读EXPLAIN和健康检查，真实业务确认、生产数据一致性与性能、Safari/WebView和真实移动设备未验证。

初始综合脚本连续三次失败均为验证夹具问题，已停止修复并保留失败脚本记录；采用分开的API和Web脚本完成验收，最终结果均通过。完整自审与剩余边界见[design.md](design.md)。
