# 产业互联网内部门户 开发与运维快速上手（Runbook）

## 1. 目标与适用范围
本文档面向后续开发/运维人员，覆盖：
- 本地开发启动
- Docker 部署
- 发布打包
- 升级与回滚
- 日常运维
- RBAC权限管理
- 常见故障排查

当前基线版本：`1.0.0`

---

## 2. 项目结构速览
- 后端入口：`src/server.js`
- 数据初始化：`src/db.js`
- 前端页面：`public/*.html` + `public/*.js`
- Docker 编排：`docker-compose.yml`
- 容器入口：`deploy/docker-entrypoint.sh`
- 打包脚本：`deploy/package.sh`
- 基础镜像脚本（可选）：`deploy/build-base-image.sh`
- 数据目录（持久化）：`data/`
- 证书文件目录（持久化）：`uploads/`

---

## 3. 本地开发

### 3.1 环境要求
- Node.js 18+
- npm
- Docker / Docker Compose（用于容器化验证）

### 3.2 本地运行（非 Docker）
```bash
npm install
npm start
```
默认访问：`http://localhost:52344`

### 3.3 本地运行（Docker）
```bash
docker-compose up -d --build
docker-compose ps
```
停止：
```bash
docker-compose down
```

---

## 4. 环境变量与配置

示例文件：`deploy/env.example`

关键变量：
- `PORT`：服务端口（默认 `52344`）
- `SESSION_SECRET`：会话密钥（生产必须强随机）
- `ADMIN_EMAIL`：管理员邮箱
- `NODE_ENV=production`
- `ENV_TYPE=prod`

生产建议：
- 使用 `deploy/env.prod`，不要把真实密钥提交到代码仓库。
- 每次发布前检查 `SESSION_SECRET` 是否正确配置。

---

## 5. 发布与打包

### 5.1 生成安装包
```bash
bash deploy/package.sh
```
输出示例：`internal-tls-portal-0.9.8.3.tar.gz`

### 5.2 重要说明（依赖打包策略）
- 若本地存在 `node_modules`，安装包会包含依赖，服务器构建更快。
- 若不存在，服务器构建阶段会执行 `npm install`（较慢，受网络影响）。

---

## 6. 生产部署（Docker）

## 6.1 标准方式（手动）
```bash
# 1) 上传安装包到服务器
scp internal-tls-portal-<version>.tar.gz devops@<server>:/home/devops/wjx/tls/

# 2) 服务器解压到新目录
tar -xzf internal-tls-portal-<version>.tar.gz -C /home/devops/wjx/tls/internal-tls-portal-<version>

# 3) 准备 env
cp /home/devops/wjx/tls/internal-tls-portal-<prev>/deploy/env.prod /home/devops/wjx/tls/internal-tls-portal-<version>/deploy/env.prod

# 4) 复制持久化数据（首次或必要时）
cp -r /home/devops/wjx/tls/internal-tls-portal-<prev>/data /home/devops/wjx/tls/internal-tls-portal-<version>/
cp -r /home/devops/wjx/tls/internal-tls-portal-<prev>/uploads /home/devops/wjx/tls/internal-tls-portal-<version>/

# 5) 启动
cd /home/devops/wjx/tls/internal-tls-portal-<version>
docker-compose up -d --build
docker-compose ps
```

### 6.2 如果环境已有 `docker-upgrade.sh`
可使用团队现有升级脚本执行一键升级：
```bash
bash docker-upgrade.sh internal-tls-portal-<version>.tar.gz
```
> 该脚本不在本仓库内，由服务器运维环境维护。

---

## 7. 升级与回滚

### 7.1 升级前必做
- 备份数据库：`data/app.db`
- 备份文件：`uploads/`
- 记录当前运行版本与容器名
- 预检查端口占用（`52344`）

### 7.2 快速回滚
原则：回滚到“上一个可用版本目录”，并继续挂载同一份持久化数据。

```bash
# 停止当前版本
cd /home/devops/wjx/tls/internal-tls-portal-<bad_version>
docker-compose down

# 启动上一版本
cd /home/devops/wjx/tls/internal-tls-portal-<good_version>
docker-compose up -d
```

如有数据损坏风险，回滚前先恢复备份的 `app.db` 与 `uploads/`。

---

## 8. 日常运维

### 8.1 健康检查
```bash
curl -s http://127.0.0.1:52344/api/health
```
应返回：`{"ok":true}`

### 8.2 查看日志
```bash
docker ps
docker logs <container_name>
docker logs -f <container_name>
```

### 8.3 常用检查
```bash
docker-compose ps
docker-compose top
```

---

## 9. 故障排查手册

### 9.1 页面报 `Failed to fetch` / `ERR_CONNECTION_REFUSED`
原因通常是服务未启动或崩溃。排查顺序：
1. `docker ps` 确认容器是否存活
2. `docker logs <container>` 查看启动报错
3. `curl /api/health` 确认健康状态

### 9.2 证书总览无数据或 API 报错
重点检查：
- 最近是否修改了 `/api/overview` SQL
- 是否出现 SQL 语法错误（如 `ORDER BY` 与 `LIMIT/OFFSET` 顺序）

### 9.3 构建阶段卡在 `npm install`
可选方案：
1. 打包时包含 `node_modules`（当前已支持）
2. 预构建基础镜像（`Dockerfile.base` + `deploy/build-base-image.sh`）

### 9.4 升级后出现旧数据/测试数据
检查：
- 是否正确复制了目标版本的 `data/` 与 `uploads/`
- 是否误访问了 localhost 环境
- 数据目录挂载是否指向当前版本目录

### 9.5 版本角标不显示
检查：
- `public/version.js` 的版本值
- 页面是否引入了 `version.js`
- 是否成功加载注入角标的前端脚本

---

## 10. RBAC权限管理（v1.0新增）

### 10.1 查看用户权限

```bash
# 查看用户的角色
sqlite3 data/app.db "
SELECT u.email, r.name as role_name, r.code 
FROM user_roles ur 
JOIN users u ON ur.user_id = u.id 
JOIN roles r ON ur.role_id = r.id 
WHERE u.email = 'user@shengwang.cn';
"

# 查看用户的权限列表
sqlite3 data/app.db "
SELECT p.code, p.name, p.action 
FROM user_roles ur 
JOIN role_permissions rp ON ur.role_id = rp.role_id 
JOIN permissions p ON rp.permission_id = p.id 
JOIN users u ON ur.user_id = u.id 
WHERE u.email = 'user@shengwang.cn';
"
```

### 10.2 手工授予角色

```bash
# 授予用户TLS服务角色
sqlite3 data/app.db "
INSERT INTO user_roles (user_id, role_id, granted_at)
SELECT u.id, r.id, datetime('now')
FROM users u, roles r
WHERE u.email = 'user@shengwang.cn'
AND r.code = 'tls-service';
"
```

### 10.3 查看服务访问日志

```bash
# 查看最近的访问日志
sqlite3 data/app.db "
SELECT u.email, s.name, sal.action, sal.result, sal.created_at
FROM service_access_logs sal
JOIN users u ON sal.user_id = u.id
JOIN portal_services s ON sal.service_id = s.id
ORDER BY sal.created_at DESC
LIMIT 20;
"

# 查看权限拒绝记录
sqlite3 data/app.db "
SELECT u.email, sal.action, sal.created_at
FROM service_access_logs sal
JOIN users u ON sal.user_id = u.id
WHERE sal.result = 'denied'
ORDER BY sal.created_at DESC
LIMIT 10;
"
```

### 10.4 清理审计日志

```bash
# 清理30天前的访问日志
sqlite3 data/app.db "
DELETE FROM service_access_logs 
WHERE created_at < datetime('now', '-30 days');
"

# 清理90天前的权限变更日志
sqlite3 data/app.db "
DELETE FROM permission_audit_logs 
WHERE created_at < datetime('now', '-90 days');
"
```

---

## 11. 数据维护与清理

清理证书业务数据（保留用户和系统设置）：
```bash
node deploy/clear-all-certificates.js
```
> 仅建议在测试数据清理或初始化导入前使用。

---

## 12. 发布前检查清单（Go-Live Checklist）

### 基础检查
- [ ] `CHANGELOG.md` 已更新
- [ ] `package.json` 与 `public/version.js` 版本一致
- [ ] `deploy/env.prod` 参数正确（尤其 `SESSION_SECRET`）
- [ ] 完成数据库与上传目录备份

### 功能检查
- [ ] 门户首页正常显示
- [ ] 服务导航正常工作
- [ ] 核心流程冒烟测试通过（登录、申请、签发、下载、总览）
- [ ] 分层级侧边栏展开/折叠正常

### 权限检查
- [ ] RBAC表结构正确创建（8张表）
- [ ] 用户角色正确迁移
- [ ] 权限校验通过（tls-admin/tls-dev/tls-service/tls-product）
- [ ] 门户API正常返回数据

### 兼容性检查
- [ ] 旧API路径仍可访问
- [ ] TLS所有功能保持正常
- [ ] 升级与回滚路径已验证

### 发布后检查
- [ ] `api/health` 返回正常
- [ ] 错误日志无异常
- [ ] 版本角标显示 1.0.0
- [ ] 权限审计日志正常记录

---

## 12. 交接建议
- 把本 Runbook 与 PRD/HLD 一并放入内部文档站首页导航。
- 每次发版后在 Runbook 追加“版本特殊说明”小节（若有迁移步骤）。
- 形成固定发布节奏：发布前评审 -> 发布窗口 -> 发布后观察期。

