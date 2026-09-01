# 测试与验收计划

## 结论

说明本次验收最需要证明的结果。

## 验收场景

列出成功、失败、边界、权限和空数据场景。

## 自动化验证

- API：`npm run typecheck`、`npm test`
- Web：`npm run typecheck`、`npm run build`
- 数据库：`npm run db:check` 或受控 migration 检查
- 容器/部署：`docker compose config`、`docker compose build`、健康检查

按实际改动选择命令，不机械运行无关检查。

## 人工验收

列出需要打开页面、登录、操作表单或检查部署结果的步骤。

## 结果与残留风险

记录实际命令、结果、未验证项、残留风险和需要用户确认的动作。
