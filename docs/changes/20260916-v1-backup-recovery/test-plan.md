# v1 数据库备份与隔离恢复测试计划

## 结论

验收重点是证明备份可恢复且不会影响现有数据库。

## 验收场景

- Compose 数据库健康时可生成备份。
- 备份可恢复到全新 PostgreSQL 16 容器。
- 核心表计数和迁移数量一致。
- 任一步失败时返回非零退出码并清理临时资源。
- 数据库未启动或工具缺失时给出明确错误。

## 自动化验证

- `powershell -ExecutionPolicy Bypass -File scripts/verify-backup-restore.ps1`
- 演练后 `docker compose ps` 确认原服务不受影响。
- `/api/healthz`、`/api/readyz` 继续返回 200。

## 人工验收

- 确认临时目录没有遗留 `.dump`。
- 确认没有遗留恢复演练容器。
- 生产演练前单独确认 Neon 备份来源、目标隔离项目和访问权限。

## 结果与残留风险

2026-09-16 已完成本地隔离恢复演练：

- `scripts/verify-backup-restore.ps1` 成功生成 107,782 字节 custom-format 备份并恢复到全新 PostgreSQL 16 临时容器。
- 备份耗时约 1.053 秒，恢复耗时约 1.143 秒。
- 14 个迁移版本与 checksum 聚合签名一致：`5f28e2fd78f83464772e3147ad2e0a4e`。
- 核心表计数一致：用户 3、工作区 3、批次 1、商品 4、采购 5、销售 9、费用 3、结算账单 3。
- 演练结束后恢复容器、角色测试容器和临时备份文件残留均为 0。
- 原 Compose 数据库持续健康，`/api/healthz`、`/api/readyz` 均返回 200。

残留风险：

- 本次只证明本地 PostgreSQL 备份可恢复，不代表 Neon 的实际备份保留能力和恢复时效。
- 正式上线前仍需确认 Neon 备份策略、保留周期、负责人、RPO/RTO，以及生产恢复目标的隔离方式。
