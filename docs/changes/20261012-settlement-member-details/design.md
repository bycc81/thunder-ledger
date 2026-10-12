# 结算个人明细：技术设计

日期2026-10-12；风险L2；原型已获用户明确确认。产品定义见[product-ux.md](product-ux.md)。

## 不变边界

settlements.ts、cost-ledger.ts、quick-sales.ts及采购/调整算法不修改。现有recommendation/preview/confirm响应、提交参数、舍入、分摊和账单写入不修改。新增独立路由模块仅读取现存记录；不重建账本，不调用calculate/allocated/split，不添加迁移。

## 页面/API契约

POST /api/batches/:batchId/settlements/members/:userId/details：请求saleIds、quickSaleIds、expenseIds（允许空数组，至少一笔销售）；UUID、重复、成员及批次范围校验。沿用创建账单权限：批次owner或管理权限，开放批次。未登录401，无权限403/404，批次关闭409，选择失效409，无效参数400，非本批次成员404。

响应member{id,username}、totals{costTotal,costShare,purchasesPaid,expensesPaid,salesReceived}、transactions[]、expenses[]、issues[]。金额字符串保留2位，所有汇总仅对存储的分整数求和。
每笔transaction包括来源、名称、数量、卖出时间、商品ID、成本、售价、手续费、收款人员、本人承担/付款归属、全部现存分摊、quickItems。quickItems保留position，含本单成本与关联库存的数量/已存消耗成本；不推算逐商品项个人分摊。
issues标记销售分摊合计与已存成本不符、非当前成员分摊、缺失快速商品行或商品行成本合计不一致。无法完整核对时本人无分摊金额用null表达未知；合法零成本无记录为0。汇总仍读取已有成员记录，不能伪造补齐。姓名来自users，仅显示，不用于匹配。

认证/批次权限沿用现有只读检查；数据查询使用BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY，所有业务查询均SELECT，最终ROLLBACK并release。事务中再次检查批次开放与人员范围。费用选择/自动关联沿用已有结算的查询条件及ID并集，不扩大为整个批次。查询不写业务审计、不调用账本或重建方法。

## 前端

公共SettlementMemberDetailsPopup接受人员、expected（costTotal、costShare）、可选result/profitTotal（原预览结果）、只读详情/加载/错误与show，发出关闭/重试/库存导航。组件不计算利润或应收应付；类别金额来自API，只做整数金额比较与格式化。
父页面按人员+批次+已选普通/快速/费用ID缓存成功响应。用递增请求序号隔离切人/关闭/重试的过期响应；返回选择、加载草稿、获取新推荐或预览即失效。选择/比例/原有payload和next/confirm的请求保持原契约，只增加失效动作和入口。
弹窗只比较新的分项与原推荐/预览金额，不覆盖原结果；不一致显示固定提示。第2步只展成本及已有来源，不提前显示结果/利润；第3步原预览公式直接读取原memberResult。
原生details/summary分类，Vant Popup teleport到body，90dvh、固定头部、滚动与安全区域，44px关闭、Escape、焦点限制和关闭返回。库存入口在独立浏览器页签打开既有商品详情，避免路由卸载导致结算选择/利润比例丢失，原弹窗及父页保持状态；不弹窗叠弹窗。来源和稳定ID生成data-ai-id，沿用注册表与旧入口ID。

## 验收及回滚

见[test-plan.md](test-plan.md)。回滚只撤销新增路由注册、类型、公共组件及页面入口，不涉及业务数据或迁移。生产部署和Git提交不在本次授权范围。

## 结果

2026-10-12 已完成开发、自审及专项验收。

- 新增独立只读查询、`SettlementMemberDetails` 类型和公共弹窗，接入创建账单第2/3步；明细面板拆成独立构建资源，保持移动端首屏资源规模。
- `settlements.ts`、`cost-ledger.ts`、`quick-sales.ts` 与 HEAD 内容一致（仅统一 CRLF 比较）；现有金额、分摊、确认写入与转账计算未改动。数据库结构及迁移未改动。
- 六类隔离用例的推荐、预览、确认响应、转账建议及写入参数在明细查询前后相同；数据库夹具拒绝只读事务中的业务写入与行锁，并核对查询前后记录无变化。路由依赖检查禁止引入计算/账本及重建/分摊调用。
- Backend typecheck、test（19/19）与 Web typecheck、build 通过。真实开发 PostgreSQL 在只读事务内 EXPLAIN 23 条新增及相关结算 SELECT，未执行这些业务查询。
- 390×844、430×932 的实际 Vue 构建页面通过两个入口、来源、分类、缓存与过期请求、失败重试、分摊缺失/金额差异、长名称/26笔列表、键盘焦点、定位ID和无横向溢出验证；截图已与原型对照并人工检查。原结算筛选专项回归同时通过，包含筛选外选择、关联费用、推荐与预览提交负载。
- 本地 Web 5665、API 3000 已运行，healthz/readyz 均返回200；新增明细路由的未认证访问返回401。未登录或确认任何真实账单。
- 已更新[用户手册](../../user-manual.md)、[产品说明](product-ux.md)、[定位注册表](data-ai-id-registry.md)及[测试计划](test-plan.md)。证据按规范留在被忽略的 evidence/ 中。

自审：范围/权限/只读事务、金额来源、无迁移、来源边界、选择缓存、定位ID、敏感信息与原有修改保留均已检查。综合验收脚本早期连续三轮遇到夹具问题（换行比较、确认URL、错误写入正则），已按流程停止该脚本并保留失败记录；后续使用独立API/Web专项脚本通过验证。

未验证项与边界：确认与写入比对仅在隔离夹具执行，未对真实业务库创建或确认账单；SQL EXPLAIN 不验证生产数据完整性或性能。真实移动设备、Safari/WebView、生产负载未验证；全局“暂无明细”兜底仅原型验证（有效请求至少选择一笔销售），个人各分类空态已在实际页面验证。历史账单、逐商品项个人分摊与销售前库存快照不在本次范围。库存参考在独立浏览器页签打开以保留结算状态，浏览器需允许该点击导航。

未进行 Git 暂存/提交/推送或生产部署；工作区原有 Caddyfile 与其他无关文件保留。
