# B2 技术设计：商品资料、图片与商品列表

## 结论

在现有 Fastify + PostgreSQL 单体中新增工作区商品、工作区资源和图片关联模型；Web 沿用现有移动端 `MobileShell`、工作区 Store、Vant 和路由结构实现列表、详情、表单、上传、轮播和大图预览。Render 与私有 R2 已完成配置，B2 合并交付商品资料及已确认的图片体验；所有 R2 永久凭据继续只保存在 Render Secret。

当前 B2 本地实现与验收已完成；生产发布和生产迁移仍须单独获得明确确认。库存批次、数量、成本和库存流水属于后续独立模块，不在本次范围。

## 风险等级

`L2`。本次新增 PostgreSQL 表与迁移，并把商品读取、写入和图片资源授权置于工作区成员角色校验之下。

## 产品与 UX 输入

- 产品与 UX 定义：[product-ux.md](product-ux.md)，已确认。
- HTML 原型：[prototype/index.html](prototype/index.html)，已确认。
- 页面/API 契约：本文件“页面/API 契约”章节，已确认并在 R2 配置完成后扩展图片接口。
- 技术设计不改变已确认的列表、详情、表单、角色和图片交互方向。

## 背景与目标

现有系统已有 `workspaces`、`workspace_members`、工作区选择 Store、移动端工作台和批次 API，但没有商品资料或商品入口。现有 `assets` 接口只允许上传者读取资产，因此协作空间中的其他成员无法安全读取同一商品图片。

B2 目标是在当前工作区内完成商品名称、描述、参考价与最多五张图片的查看、名称搜索、新建和编辑，并服务端保证 owner/admin/editor 可写、viewer 只读。列表展示第一张图片；没有图片时使用已确认的无图占位。

## 非目标

- 不实现商品删除、分类、标签、SKU、状态、批次绑定、库存、成本、上架、销售、费用或结算。
- 不引入新的服务、队列、对象存储桶或 UI 组件库。

## 页面/API 契约

本章节是 B2 原型与实现之间唯一的字段、操作、权限和接口契约。

### 页面与数据

| 页面区域 | 原型/业务 ID | 展示或编辑字段 | 领域数据来源 | 权限 | 交互结果 |
|---|---|---|---|---|---|
| 商品列表 | `product-list-page`、`product-list` | id、name、description、referencePrice、firstImage | 当前工作区商品列表 | 工作区成员 | 点击列表项进入详情；firstImage 为第一张图片的短时读取 URL 或 null |
| 商品搜索 | `product-search`、`product-search-clear` | 名称关键词 | 商品列表查询 | 工作区成员 | 刷新当前工作区匹配结果 |
| 商品详情 | `product-detail-page`、`product-detail-content` | 名称、描述、参考价、创建/更新时间、images | 单个商品详情 | 工作区成员 | 返回列表或进入编辑；images 按 position 返回 assetId 与短时读取 URL |
| 商品表单 | `product-form-page`、`product-form` | name、description、referencePrice、按顺序 assetIds | 创建或更新商品 | owner/admin/editor | 成功后刷新列表或详情 |
| 图片管理 | `product-image-section`、`product-image-list` | 待上传、就绪、失败图片与顺序 | 工作区资源接口与商品写入 | owner/admin/editor | 添加、重试、移到首图、解除关联 |
| 无图占位 | `product-list-no-image-{productId}` | 无图状态 | 商品摘要/详情 | 工作区成员 | 无图片时稳定展示 |

### 操作与接口边界

| 操作 | 入口 ID | 前置条件 | 领域动作或接口 | 成功结果 | 失败反馈 | 是否二次确认 |
|---|---|---|---|---|---|---|
| 查询商品列表 | `product-list-page` | 已选工作区 | `GET /api/workspaces/:workspaceId/products?q=` | 展示当前工作区匹配结果 | `product-list-error` 与重试 | 否 |
| 查看商品详情 | `product-item-{productId}` | 有该商品读取权 | `GET /api/workspaces/:workspaceId/products/:productId` | 打开详情 | 详情错误或返回列表 | 否 |
| 新建商品 | `product-create` | owner/admin/editor；已选工作区 | `POST /api/workspaces/:workspaceId/products` | Toast 后刷新列表 | 保留输入并显示字段/保存错误 | 否 |
| 编辑商品 | `product-edit`、`product-form-submit` | owner/admin/editor；有编辑权 | `PATCH /api/workspaces/:workspaceId/products/:productId` | Toast 后刷新详情和列表摘要 | 保留输入并显示字段/保存错误 | 否 |
| 上传图片 | `product-image-add`、`product-image-input` | owner/admin/editor；当前图片少于 5 张 | `POST /api/workspaces/:workspaceId/assets/presign` → 浏览器 PUT R2 → `POST /api/workspaces/:workspaceId/assets/complete` | 图片成为可排序的表单项 | 保留失败项，支持重试或删除 | 否 |
| 获取图片 | `product-detail-image-{assetId}` | 工作区成员 | 商品列表/详情响应内短时 URL | 展示首图、轮播或大图 | 签名失效时重新加载详情 | 否 |
| 移到首图/移除关联 | `product-image-move-first-{assetId}`、`product-image-remove-{assetId}` | owner/admin/editor | `PATCH` 提交完整按顺序 assetIds | 更新首图和轮播 | 保留当前顺序并显示失败 | 移除关联是，`product-image-remove-confirm` |
| 放弃表单变更 | `product-form-cancel`、`product-form-topbar` | 表单有未保存变更 | 不发送领域写入 | 返回来源页面 | 无 | 是，`product-discard-confirm` |

- 每个商品请求通过路径中的 `workspaceId` 定位上下文；服务端从 JWT 得到用户，禁止依赖前端传入用户 ID 或角色。
- 商品摘要返回 id、name、description、referencePrice、firstImage；详情额外返回创建/更新时间和按 position 排序的 images（assetId、position、url）。金额 API 保持字符串，最多一位小数。
- 本期仅按名称关键词筛选当前工作区商品，默认按 created_at DESC；暂不分页，后续可通过 cursor 扩展。
- 名称缺失或金额非法返回 `400 INVALID_PRODUCT`；未认证为 `401 UNAUTHORIZED`；写入越权为 `403 FORBIDDEN`；不存在、跨空间或无读取权的详情为 `404 NOT_FOUND`。
- 服务端必须校验认证用户、工作区成员身份、商品归属及 owner/admin/editor 写权限；viewer 只能读取已授权范围。
- 创建与更新接收去重的、最多五个按展示顺序的 ready assetIds。服务端验证它们属于同一工作区、未删除且为当前用户有编辑权的工作区资源；移除商品图片仅通过新的 assetIds 集合解除关联，不删除底层资源。

### 状态与定位

| 状态 | 页面表现 | 可执行操作 | 数据和权限要求 |
|---|---|---|---|
| Loading | 列表显示首图位置骨架；详情保留导航和布局 | 禁用搜索、新建、编辑、保存 | 当前工作区上下文仍可见 |
| Empty | 显示 `product-list-empty`；不重复提供新建按钮 | 通过标题右侧的新建入口创建；viewer 阅读说明 | 当前工作区无商品 |
| 搜索无结果 | 显示 `product-search-empty` 并保留关键词 | 清除或修改关键词 | 查询成功但无匹配项 |
| Error | 显示 `product-list-error` 或详情错误说明 | 重试、返回 | 不清空表单输入 |
| 无权限 | 显示只读说明；不显示写入口 | 查看已授权商品、返回 | viewer 只读，服务端仍校验 |
| Disabled | 提交、加载、上传中或达到五张时禁用对应操作 | 等待完成或继续其他字段 | 待上传与已就绪图片合计最多五张 |
| 图片上传中/失败 | 图片网格显示状态、重试或删除入口 | 填写其他字段；重试、删除失败项 | 不重复提交同一文件；失败项不影响其他图片 |
| Success | 具体 Toast；刷新事实数据 | 查看结果、继续操作 | 创建或更新成功 |

- 对应注册表：[data-ai-id-registry.md](data-ai-id-registry.md)。
- 页面根、主要区域、控件、弹层、重复列表项和危险操作已覆盖；重复商品项使用稳定 productId，不使用名称、随机值或用户输入。
- 图片相关 ID 直接复用原型中已登记的稳定业务 ID，不改动已确认 ID。

## 交付范围

| 模块 | 交付 | 状态 | 收口条件 |
|---|---|---|---|
| B2 商品资料与图片 | 工作区隔离 API、受控图片上传、最多 5 张、首图排序、轮播/大图、无图状态、审计和移动端导航 | 本地完成 | 云端部署、浏览器 Smoke 与目标视口验收完成 |
| 后续库存模块 | 库存批次、数量、成本与库存流水 | 不在本次范围 | 单独确认业务规则、Product/UX 与设计 |

## 当前实现与缺口

- `apps/backend/src/access.ts` 已有 JWT 认证、工作区角色查询、owner/admin/editor/viewer 定义和审计日志写入；其工作区辅助函数目前仅供该文件内部路由使用。
- `apps/backend/migrations/002_batch1_access.sql` 已建立工作区、成员和审计日志；迁移由 `src/db/migrate.ts` 按版本和校验和顺序执行。
- `apps/backend/src/assets.ts` 支持 JPEG、PNG、WebP、GIF 的预签名上传，最大 10 MB，但 `GET /api/assets/:id/url` 以 `created_by` 限制读取，不能作为工作区共享商品图的直接实现基础。
- `apps/web/src/stores/workspace.ts` 已保存当前工作区与角色，`MobileShell.vue` 已提供工作区选择和四项底部导航，`WorkspaceOverview.vue` 是工作区快捷入口位置；当前没有商品路由、页面、Store 或 API 类型。

## 方案与影响范围

### 数据与迁移

新增一份顺序递增且不可修改既有迁移的 SQL 迁移（实施时确定实际编号）：

```text
products
  id uuid PK
  workspace_id uuid NOT NULL REFERENCES workspaces(id)
  name text NOT NULL
  description text NULL
  reference_price numeric(12,1) NULL CHECK (reference_price >= 0)
  created_by uuid NOT NULL REFERENCES users(id)
  updated_by uuid NOT NULL REFERENCES users(id)
  created_at timestamptz NOT NULL DEFAULT now()
  updated_at timestamptz NOT NULL DEFAULT now()
```

新增工作区资源与商品图片关联：

```text
assets.workspace_id uuid NULL REFERENCES workspaces(id)
product_images
  product_id uuid NOT NULL REFERENCES products(id)
  asset_id uuid NOT NULL REFERENCES assets(id)
  position integer NOT NULL CHECK (position BETWEEN 1 AND 5)
  PRIMARY KEY (product_id, asset_id)
  UNIQUE (product_id, position)
```

- 服务端在写入前 trim 名称；空名称返回字段错误。描述为空白时保存为 `NULL`；未设置参考价保存为 `NULL`。金额请求与响应使用字符串，避免 JavaScript 浮点误差，并在服务端校验非负且最多一位小数。
- 建立 `products(workspace_id, created_at DESC)` 索引。B2 没有删除或状态字段，避免为未来流程预建规则。
- 当前不存在商品数据，迁移只新增表和索引；执行前仍须备份目标数据库。迁移成功但应用回滚时旧应用不会读取新表；默认不执行破坏性反向迁移。
- 同步更新 `apps/backend/src/db/schema.ts`，使 Drizzle 声明与实际表保持一致。
- 图片关联、商品创建/更新及最多五张校验在同一数据库事务内完成。位置 1 固定为列表首图；更新传入的有序 assetIds 是唯一顺序来源。

### 访问控制与审计

- 从现有 `access.ts` 提取最小的共享认证、工作区角色、`canEditWorkspace`（owner/admin/editor）和审计辅助函数，供商品与资源路由复用；不改变现有批次授权结果。
- 每个商品请求以路径中的 `workspaceId` 定位上下文，服务端从 JWT 得到用户；绝不接收前端传入的用户 ID 或角色作为授权依据。
- 所有工作区成员可读取本空间商品；owner/admin/editor 可创建或更新；viewer 返回 `403 FORBIDDEN`，且 Web 不展示写入口。不存在的商品、跨空间商品或无工作区读取权的详情请求统一返回 `404 NOT_FOUND`，避免泄露存在性。
- 成功创建与更新分别写入 `audit_logs`：`product.create`、`product.update`，实体为 `product`，记录工作区、操作者、商品 ID 和变更字段名；不记录完整描述或图片 URL。
- 工作区资源在 presign 时先以 `pending` 状态写入 `assets`，完成时由上传者在同一工作区标记为 `ready`。读取签名 URL 只在当前请求用户仍有工作区成员身份时签发；图片 URL 有效期十分钟。

### API 实现约束

接口路径、请求/响应字段、权限、排序和错误语义以本设计“页面/API 契约”章节为唯一事实来源。实现应对数据库或存储层未预期错误返回统一 5xx，不把底层错误细节暴露给页面。

工作区图片接口为 `POST /api/workspaces/:workspaceId/assets/presign`、`POST /api/workspaces/:workspaceId/assets/complete`、`GET /api/workspaces/:workspaceId/assets/:assetId/url` 与仅限未关联资产的删除接口。对象 Key 固定为 `workspaces/{workspaceId}/assets/{assetId}`；服务端用 R2 HeadObject 确认对象存在和大小一致后才标记 ready。

### Web

- 新增 `/products`、`/products/new`、`/products/:id`、`/products/:id/edit` 认证路由；详情和表单使用独立全屏页面，商品作为底部主导航入口，工作区概览保留快捷入口；底部四项导航为工作区、商品、批次、我的。
- 在 `workspace.ts` 增加 `canEditProducts`，值为 owner/admin/editor；新商品 API 类型、请求和加载状态放在产品域 API/Store，不把商品数据混入批次数组。
- `WorkspaceOverview.vue` 增加“商品”快捷入口，稳定 ID 为 `quick-products`；同步登记进本变更的注册表，不替换既有 ID。
- 使用 Vant `NavBar`、`Search`、`Cell`、`Field`、`Form`、`Popup/Dialog`、`Toast` 和现有主题变量；实现原型的 Loading、Empty、搜索无结果、Error、viewer 只读、Disabled 和 Success 状态。列表首图固定显示 `product-list-no-image-{productId}`。
- 图片列表固定展示第一张图片；详情显示 184px 高轮播和全屏预览；表单显示上传、重试、首图调整和垃圾桶图标删除关联。未关联的取消上传资源可由上传者删除；已关联资源不提供通用删除入口，防止影响商品资料。

## 风险、备份与回滚

| 风险 | 控制措施 | 回滚 |
|---|---|---|
| 跨工作区读取或写入 | 所有 SQL 带 `workspace_id`；详情/更新先验证成员关系；测试双工作区越权 | 回滚应用；保留数据，修复后再发布 |
| viewer 越权写入 | 前端隐藏与后端角色校验双层控制；API 测试直接调用写接口 | 回滚应用；审计日志定位受影响操作 |
| 金额精度错误 | API 使用字符串，数据库 `numeric(12,1)` 和非负约束 | 数据库备份后按受控 SQL 修正；不自动删除数据 |
| 迁移失败或误操作 | 先备份，受控环境执行迁移，检查 `schema_migrations` 和表结构 | 事务内迁移失败自动回滚；成功后默认不执行破坏性逆迁移 |
| 把私有个人资产泄露给工作区 | 资源绑定 workspace；每次签名读取校验成员关系；跨工作区接口返回 404 | 禁用图片路由、撤销 R2 Token 并轮换 Secret；不影响商品资料 |

## 验收标准

- 当前工作区成员只能查询本空间商品；跨工作区详情不泄露商品存在性。
- owner/admin/editor 可创建并更新名称、描述、参考价；viewer 的 API 写请求被拒绝，界面没有写入口。
- 名称空白、负数和超过一位小数的参考价被明确拒绝，输入在页面保留；未设置参考价和描述得到一致展示。
- 商品列表可按名称关键词过滤，含 Loading、Empty、搜索无结果、Error、Disabled、Success 和无图状态。
- 每商品最多 5 张、第一张为首图、详情轮播与大图预览、工作区共享读取受控。
- 商品快捷入口、页面根、列表项、表单、状态和危险操作继续使用注册表的稳定 `data-ai-id`。

## 开发任务绑定

| 实施任务 | 产品/UX 条目 | 验收场景 | 验证 |
|---|---|---|---|
| 商品、资源、关联迁移与工作区 API | 商品资料可复用；最小资料维护；多图和唯一封面 | 浏览、新建、名称缺失、搜索、viewer、上传、首图、移除与越权读取 | API 集成测试、R2 联通测试、`db:check`、迁移检查 |
| 移动端商品页面和工作区入口 | 商品列表、详情、新建/编辑与图片管理 | 新建、编辑、上传、轮播、大图、只读、加载/空/错误/禁用/成功 | Web typecheck/build、390×844 和 430×932 人工验收、ID 扫描 |
