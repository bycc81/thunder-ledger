# 商品组与款式技术设计

## 结论

商品组图片使用独立关联表并复用现有工作区图片上传与签名读取能力。首图用于商品列表，详情展示全部图片；不影响款式、库存、采购、销售或结算。

## 风险等级

`L2`：新增数据库表与图片资源关联。迁移仅新增表和索引；无数据删除或历史数据重写。

## 背景与目标

商品组创建、列表和详情缺少统一的图片资料，导致商品组与独立商品在识别上不一致。本轮补足商品组图片上传、列表首图及类型标签、详情图片展示。

## 非目标

不为款式单独新增图片，不改变任何库存、成本、采购、销售和结算金额规则。

## 当前实现与缺口

`products`、`inventory_purchases`、`sales` 和结算表已按独立商品工作；`listings` 已有基础表但缺少路由。销售和结算公式均以 `product_id` 为核心。

## 数据设计

- `product_groups`：工作区、名称、描述、创建/更新时间。
- `product_group_images`：商品组与工作区图片资源的有序关联，最多五张；第一张作为商品列表首图。商品组图片不关联到具体款式，避免影响款式资料与库存核算。
- `inventory_purchases`：新增商品、商品组和款式名称快照；`listings` 和 `listing_variants` 同步新增商品组/款式名称快照。后续编辑商品资料不改变已发生采购、库存记录或上架记录的展示名称。
- `products` 增加 `group_id`、`variant_name`、`group_name_snapshot`；商品组允许没有款式，独立商品/无款式商品不写款式名。
- `product_group_templates`、`product_group_template_variants`：工作区组合模板及按位置排序的款式成员；仅用于创建页预填，不引用商品、采购或账务数据。
- `sales` 增加商品组/款式展示快照；`settlement_bill_sales` 同步保存快照。
- 采购仍写入现有 `inventory_purchases` 和 `purchase_cost_shares`，商品组采购在事务内拆成多条独立采购。

## 现有与扩展 API

- `POST/GET /api/workspaces/:workspaceId/product-groups`；`variants` 可省略或为空，`assetIds` 最多五个且必须为当前工作区已完成上传的图片资源。响应新增 `firstImage` 与 `images`，用于列表首图和详情图片展示。
- `PATCH /api/workspaces/:workspaceId/product-groups/:groupId`：全量更新名称、描述、图片、款式和参考价。已有采购、上架或销售的款式不可删除；更新后只影响商品库及未来业务记录。
- `POST /api/batches/:batchId/channels` 已有渠道创建接口；采购和上架页面通过渠道选择器内的“新增渠道”调用，成功后自动选中。
- `GET/POST /api/workspaces/:workspaceId/product-group-templates`，`PATCH/DELETE /api/workspaces/:workspaceId/product-group-templates/:templateId`：组合模板管理。模板名称和成员款式均工作区/模板内唯一，写入仅 owner/admin/editor。
- `GET /api/batches/:batchId/products` 返回独立商品与商品组款式及可售数量。
- 现有批次“新增采购”页面扩展商品选择与逐款录入；商品组采购由 `POST /api/batches/:batchId/group-purchases` 在事务内拆分为独立采购。采购完成后返回库存页。
- 现有销售/结算 API 保持金额字段和 productId 兼容，新增展示字段。

商品组采购前端以 `unitPrice × quantity` 计算到分的 `totalCost`，仍向既有 `POST /group-purchases` 提交 `variants[].quantity` 与 `variants[].totalCost`，不调整成本台账、销售或结算接口。

## 事务与兼容

商品组创建、编辑和批次采购拆分均为单事务；任一已提交款式失败全部回滚。普通保存不创建采购或上架记录；采购、上架、销售和账单均在业务发生时保存名称快照，不随名称变化。现有独立商品请求保持不变。

组合模板的编辑事务会整体替换模板成员；删除依赖外键级联仅删除模板成员，不会触碰商品组、采购、销售或结算表。

## 结算快照写入修复（2026-09-22）

- 目标：修复确认结算时 `settlement_bill_sales` 的列和值数量不一致，恢复账单创建。
- 范围：仅补齐销售快照的 `occurred_at` 写入参数；不修改请求契约、结算公式、权限、迁移或既有账单。
- 数据与事务：写入仍在既有结算事务内执行。SQL 校验失败时原事务已回滚，不会留下部分账单或锁定销售；修复后新账单继续使用当时的商品组、款式和成交时间快照。
- 验收：`POST /api/batches/:batchId/settlements` 可通过 PostgreSQL 解析并写入完整销售快照；服务费、成本、利润和成员净额使用既有计算结果。

## 风险与回滚

新增表和可空字段可前向兼容；回滚应用后旧接口仍可读独立商品。不得删除或重写既有结算数据。已上传但未保存商品组的资源沿用现有工作区图片资源清理规则；已关联商品组图片不可被单独删除。

## 页面/API 契约

| 页面区域 | 原型/业务 ID | 展示或编辑字段 | 领域数据来源 | 权限 | 交互结果 |
|---|---|---|---|---|---|
| 新建商品组图片 | `product-group-image-section` | 最多五张图片、首图顺序 | 工作区 assets / 商品组 `assetIds` | 可编辑角色 | 上传完成后保存关联 |
| 商品列表封面 | `product-group-list-cover-{groupId}` / `product-list-cover-{productId}` | 首图与类型标签 | 商品或商品组 `firstImage` | 可读取角色 | 点击列表项进入详情 |
| 商品组详情图片 | `product-group-detail-images` | 全部有序图片 | 商品组 `images` | 可读取角色 | 可查看图片状态 |
| 商品组编辑 | `product-group-edit` | 当前商品组资料、图片与款式 | 商品组详情 | 可编辑角色 | 保存后返回详情 |
| 采购/上架渠道 | `inventory-purchase-channel` / `listing-channel` | 工作区渠道字典 | 批次 channels | 可编辑角色 | 选择或新增后自动选中 |

| 操作 | 入口 ID | 前置条件 | 领域动作或接口 | 成功结果 | 失败反馈 | 是否二次确认 |
|---|---|---|---|---|---|---|
| 上传商品组图片 | `product-group-image-add` | 图片格式、大小、数量有效 | 现有 assets 预签名/完成接口 | 图片处于可保存状态 | 上传失败提示重试/移除 | 否 |
| 移除未保存商品组图片 | `product-group-image-remove-{assetId}` | 选择已有图片 | 取消关联并清理未关联资源 | 图片从表单移除 | 清理失败不影响表单 | 是 |
| 编辑商品组 | `product-group-edit` | 名称与款式有效 | `PATCH /product-groups/:groupId` | 更新商品资料 | 有业务记录的款式拒绝删除 | 否 |
| 新增渠道 | `inventory-purchase-channel-add` / `listing-channel-add` | 渠道名称未重复 | `POST /batches/:batchId/channels` | 自动选中新渠道 | 名称无效或重复提示 | 否 |

## 验收标准

- 商品组可上传最多五张符合现有格式与大小限制的图片；未完成或失败上传不能保存。
- 商品列表的商品组显示首图与“商品组”标签，独立商品显示首图与“商品”标签；无图不影响标签展示。
- 商品组详情按上传顺序展示全部图片；无图片显示明确空态。
- 图片关联仅作用于资料展示，不改变采购、库存、销售、手续费或结算金额。
- 商品组编辑后，既有采购、库存、上架、销售和结算的名称展示不变；未来新建采购、上架和销售使用更新后的名称。
- 交易页先选择商品组、再选择有可售库存的款式；销售和结算显示“商品组 · 款式”。
