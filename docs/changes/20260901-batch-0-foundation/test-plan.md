# 批次 0 测试与验收计划

## 结论

通过静态文档检查确认需求、路线图和架构边界一致；本批次不执行 API 或 Web 功能测试。

## 验收场景

1. 需求文档包含个人空间、协作空间和批次参与人边界。
2. 需求文档明确销售收入进入公共池，销售人不改变收益比例。
3. 需求文档明确 0.1 元精度和整数“角”存储。
4. 路线图 Markdown 与 HTML 均包含 B0-B6 阶段及门禁。
5. 架构 Markdown 与 HTML 均包含模块边界、数据流和渠道插件方向。
6. 两个 HTML 文件具备完整 doctype、html 和 body 标签。

## 自动化/静态验证

- 检查五个目标文档存在且非空。
- 检查 HTML 结构标签闭合。
- 检查关键术语 `Workspace`、`CollaborationBatch`、`ChannelAdapter`、公共收入池和金额精度均有记录。
- 运行 `git diff --check`；若发现既有文件问题，不归因于本批次。

## 未执行项

- 未运行 `apps/backend` typecheck/test，因为本批次未修改后端。
- 未运行 `apps/web` typecheck/build，因为本批次未修改前端。
- 未执行数据库 migration、容器构建或部署检查。
