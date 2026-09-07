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

页面契约模板见 `standards/change-templates/page-contract.md`；`data-ai-id` 通用规范见 `standards/frontend/data-ai-id-guidelines.md`。具体需求在 `changes/` 下保留页面契约和 ID 注册表实例。

已完成的 B1 移动端迁移记录见 `changes/20260904-mobile-migration/`；收口验收、设计先行契约、页面/API 契约、`data-ai-id` 注册表和可运行原型见 `changes/20260904-mobile-remediation/`。下一阶段 B2 必须沿用该流程。
