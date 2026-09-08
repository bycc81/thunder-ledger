# ThunderLedger 文档目录

这里集中维护 ThunderLedger 的产品需求、总体架构、研发路线和开发规范。

```text
docs/
├─ product-requirements.md       产品需求基线
├─ architecture/                 总体架构（Markdown + HTML）
├─ roadmap/                      产品路线图（Markdown + HTML）
├─ standards/                    开发规范、流程、模板和检查清单
├─ changes/                      各批次设计、测试和变更记录
├─ deployment.md                 部署说明
└─ assets/                       文档及部署相关静态资源
```

阅读入口建议：先看 `product-requirements.md`，再看 `architecture/`、`roadmap/` 和 `deployment.md`；开发任务遵循 `standards/`，每个批次的实际记录放在 `changes/`。安全规范统一见 `standards/security.md`。

Markdown 是维护和评审的事实来源，HTML 是路线图和架构图的浏览版本。

新模块与新页面使用 `standards/change-templates/product-ux.md` 记录产品与 UX 定义；页面/API 契约是 `standards/change-templates/design.md` 的章节。`data-ai-id` 通用规范见 `standards/frontend/data-ai-id-guidelines.md`，具体前端需求在 `changes/` 下保留 ID 注册表实例。

已完成的 B1 移动端迁移记录见 `changes/20260904-mobile-migration/`；收口验收和历史页面/API 契约见 `changes/20260904-mobile-remediation/`。B2 商品目录已采用精简后的产品/UX 与技术设计流程。
