# ThunderLedger

商品、订单、库存与收益协作管理后台的基础工程。

当前阶段只建设可维护的前后端骨架、认证、数据库迁移、容器化和部署能力，不包含具体业务模块。

## 技术栈

- Web: Vue 3, Vite, TypeScript, Element Plus, Pinia, Vue Router, Axios, Less
- API: Node.js 22 LTS, TypeScript, Fastify
- Database: PostgreSQL 16
- Deployment: Docker Compose + Caddy

## 本地启动

```powershell
Copy-Item .env.example .env
.\scripts\start-local.ps1
```

访问 `http://localhost:8188`。

停止本地服务（保留数据库数据卷）：

```powershell
.\scripts\stop-local.ps1
```

更新基础镜像并重新构建本地服务：

```powershell
.\scripts\update-images.ps1
```

## 目录

```text
apps/web        Vue 管理后台
apps/backend    Fastify 后端服务
packages        前后端契约
db/migrations   数据库迁移
deploy           Compose 与 Caddy
docs             项目专属架构、部署和安全说明
```
