# Internal TLS Portal 高层设计文档（HLD）

## 1. 概览
本系统为单体 Node.js Web 应用，提供证书申请、签发、下载、总览、用户管理与系统设置。  
部署方式为 Docker 单容器 + SQLite + 本地文件存储（bind mount）。

## 2. 目标与设计原则
- **最小复杂度**：单进程 + SQLite，便于内部快速交付。
- **可升级/可回滚**：版本目录化部署（`internal-tls-portal-x.y.z`）。
- **权限优先**：接口层集中做鉴权与数据可见范围控制。
- **问题可排查**：明确健康检查、日志入口、数据目录和文件目录。

## 3. 系统架构
- 前端：静态页面 + 原生 JavaScript（`public/*.html`, `public/*.js`）。
- 后端：Express 应用（`src/server.js`）。
- 数据：SQLite（`data/app.db`）。
- 文件：证书 ZIP 存储于 `uploads/`。
- 会话：`express-session` 内存存储（当前实现）。
- 定时任务：`node-cron`（过期提醒邮件）。

## 4. 运行时组件
- 应用入口：`src/server.js`
- 数据初始化与迁移：`src/db.js`
- 容器入口：`deploy/docker-entrypoint.sh`
- 编排：`docker-compose.yml`
- 环境变量：`deploy/env.prod`（基于 `deploy/env.example`）

## 5. 关键模块设计

### 5.1 鉴权与权限
- `requireAuth`：登录态校验。
- `requireRole`：基于角色的授权校验。
- `requireAdmin`：管理员专用接口。
- 数据可见范围在业务查询中进一步限制（如 `/api/requests`）。

### 5.2 请求与证书模块
- `requests` 表保存工单状态（`pending/issued/revoked/withdrawn`）。
- `request_certificates` 表保存证书文件与签发/撤销元数据。
- 查询时通过“每个 request 取最新 active cert”关联展示。

### 5.3 总览模块
- 入口接口：`GET /api/overview`、`GET /api/overview/export`
- 支持关键字/状态/即将过期筛选。
- 过期时间展示规则：优先显式字段，否则 `cert_created_at + 730 天`。

### 5.4 用户与设置模块
- 用户管理接口：角色调整、用户编辑、重置密码、邮箱验证。
- 系统设置：SMTP 与通知参数保存在 `system_settings`。

## 6. 数据流（简述）
1. 前端页面调用 `/api/*` 接口。
2. 后端完成会话鉴权和角色校验。
3. SQL 查询 SQLite 并按权限约束过滤。
4. 文件下载接口从 `uploads/` 读取并返回。
5. 关键操作写入数据库状态（签发/撤销/撤回等）。

## 7. 部署拓扑
- Docker 容器暴露 `52344` 端口。
- 宿主机目录映射：
  - `./data -> /app/data`
  - `./uploads -> /app/uploads`
- 优点：升级容器镜像时业务数据保持持久化。

## 8. 升级与回滚设计
- 升级：新版本目录解压 -> 复制历史数据目录与环境变量 -> 启动新容器。
- 回滚：停止当前版本 -> 启动上一版本目录容器（数据仍使用挂载目录）。
- 必做：升级前备份 `data/app.db` 和 `uploads/`。

## 9. 可观测性与排障入口
- 健康检查：`GET /api/health`
- 关键日志：容器日志（`docker logs <container>`）
- 常见问题：
  - 端口占用导致启动失败
  - SQL 语法问题导致 API 崩溃
  - 文件存在性与数据库记录不一致

## 10. 当前技术债与改进建议
- `express-session` MemoryStore 不适合生产，建议迁移到 Redis。
- SQLite 适合当前规模，后续并发增长时建议迁移 MySQL/PostgreSQL。
- 建议补齐自动化测试（权限、分页、升级回归）。
- 建议将部署脚本与发布流程标准化（一键预检 + 发布 + 验证 + 回滚）。

## 11. 文档关联
- PRD：`docs/zh-CN/PRD.md`
- 后续将补充：
  - 用户操作指南
  - 开发/运维 Runbook
  - 上线检查清单
  - LLM 快速上下文提示词

