# 商品删除测试计划

## 验收场景

| 编号 | 场景 | 预期结果 |
| --- | --- | --- |
| S1 | 编辑者打开商品详情 | 可见“更多操作”；菜单内可见删除和二次确认弹窗 |
| S2 | 取消确认 | 不发送删除请求，商品保留 |
| S3 | 确认删除商品 | 返回列表，接口返回 204，写入软删除审计记录 |
| S4 | 商品有采购、库存调整、上架、普通销售或关联库存快速售出 | 删除成功；历史库存、上架和交易数据仍可读，商品不再用于新建采购/销售 |
| S5 | 删除商品组款式后新建同名款式 | 已删除款式不显示，可创建同名新款式 |
| S6 | 删除商品组 | 商品组和全部款式从目录、新采购/销售选择中隐藏；已有上架、库存和交易记录仍可读 |

## 自动化验证

- `apps/backend`: `npm run typecheck`、`npm test`、`npm run db:check`。
- `apps/web`: `npm run typecheck`、`npm run build`。
- Web 构建前自动检查所有 `<van-*>` 模板标签均已在 `src/main.ts` 注册，缺少注册即失败。

## 人工验收

在 390x844 和 430x932 视口分别打开一个有关联库存快速售出的商品和商品组，检查删除按钮、确认弹窗和成功返回列表；再确认库存、快速售出详情仍可读，且该商品或商品组款式不再出现在新建采购/销售选择中。

## 残留风险

2026-09-30 已通过：

- `apps/backend`: `npm run typecheck`、`npm test`（19/19）、`npm run db:check`。
- `apps/web`: `npm run typecheck`、`npm run build`。
- 本地开发数据库已应用 `022_product_soft_delete` 和 `023_product_group_soft_delete`，确认存在 `products.deleted_at`、`product_groups.deleted_at`。

未接入专用验收数据时，S1-S5 的真实页面与历史数据路径仍需人工验证；构建通过不替代删除操作验收。
