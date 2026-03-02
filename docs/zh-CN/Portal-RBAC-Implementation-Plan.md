# 产业互联网内部门户 - RBAC方案实施计划

## 文档信息
- **方案名称**: 完整RBAC权限模型实施
- **目标版本**: 1.0.0
- **当前基线**: 0.9.8.3
- **预计工期**: 5-7个工作日
- **文档日期**: 2026-03-02

---

## 一、变更概览

### 1.1 架构升级

**从**: 单一TLS证书管理系统  
**到**: 产业互联网内部门户（多服务平台）

**核心变化**:
1. 引入完整RBAC（基于角色的访问控制）模型
2. 支持多服务接入和管理
3. 细粒度权限控制（功能级别）
4. 完善的权限审计体系

### 1.2 技术栈变化

| 组件 | 现有 | 升级后 |
|------|------|--------|
| 权限模型 | 简单角色(users.role) | RBAC(8张表) |
| API路由 | /api/* | /api/{service}/* |
| 权限检查 | requireRole() | requirePermission() |
| 前端导航 | 单层菜单 | 门户+服务二级菜单 |

---

## 二、数据库改造详情

### 2.1 新增表结构（8张表）

#### 核心表
1. **portal_services** - 服务注册表
2. **permissions** - 权限定义表
3. **roles** - 角色定义表
4. **role_permissions** - 角色-权限映射
5. **user_roles** - 用户-角色映射
6. **user_permissions** - 用户直接权限表

#### 审计表
7. **service_access_logs** - 服务访问日志
8. **permission_audit_logs** - 权限变更历史

### 2.2 现有表变更

**users表**: 保持不变
- `role` 字段保留（向后兼容）
- 新RBAC系统通过 `user_roles` 表关联

**其他TLS业务表**: 完全不变
- `requests`
- `request_certificates`
- `system_settings`
- `email_verifications`
- `password_resets`

### 2.3 数据迁移

**迁移策略**: 自动迁移，零手工干预

```sql
-- 自动执行的迁移逻辑
-- 1. users.role = 'admin' → user_roles关联到'tls-admin'角色
-- 2. users.role = 'dev' → user_roles关联到'tls-dev'角色
-- 3. users.role = 'service' → user_roles关联到'tls-service'角色
-- 4. users.role = 'product' → user_roles关联到'tls-product'角色
```

**迁移时机**: 应用首次启动时自动执行

---

## 三、文件变更清单

### 3.1 新增文件（7个）

```
src/
├── migrations/
│   ├── 001-portal-rbac.sql          # RBAC表结构
│   └── 002-init-tls-service.sql     # TLS服务权限初始化
├── rbac-manager.js                   # RBAC管理器（核心逻辑）
└── rbac-middleware.js                # Express权限中间件

docs/zh-CN/
├── RBAC-Integration-Guide.md        # 集成指南
├── Portal-RBAC-Implementation-Plan.md # 本文档
└── Portal-Architecture.md            # 门户架构文档（待创建）
```

### 3.2 修改文件（预估15+个）

#### 后端文件
- **src/db.js** - 集成RBAC初始化
- **src/server.js** - 路由命名空间化、权限中间件集成
- **src/changelog-data.js** - 更新版本号

#### 前端文件（所有页面）
- **public/*.html** (9个) - 侧边栏导航改造
- **public/app.js** - TLS申请页逻辑
- **public/admin.js** - TLS签发页逻辑
- **public/overview.js** - TLS总览页逻辑
- **public/users.js** - 用户管理页逻辑
- **public/settings.js** - 系统设置页逻辑
- **public/styles.css** - 门户样式

#### 新增前端文件
- **public/portal-home.html** - 门户首页
- **public/portal-home.js** - 门户首页逻辑
- **public/components/service-card.js** - 服务卡片组件
- **public/components/nav-sidebar.js** - 统一侧边栏组件

#### 配置文件
- **package.json** - 版本号升级到1.0.0
- **public/version.js** - 版本角标更新
- **README.md** - 项目说明更新
- **CHANGELOG.md** - 变更日志

#### 文档文件
- **docs/zh-CN/PRD.md** - PRD更新
- **docs/zh-CN/HLD.md** - HLD更新
- **docs/zh-CN/Developer-Runbook.md** - 运维文档更新
- **docs/zh-CN/LLM-Context-Prompt.md** - AI上下文提示更新

---

## 四、实施步骤

### 第1天：数据库与核心模块

**任务**:
1. ✅ 创建 RBAC SQL Schema
2. ✅ 实现 RBACManager 类
3. ✅ 实现权限中间件
4. ✅ 集成到 db.js 初始化流程

**验证**:
```bash
# 启动应用，检查RBAC表是否创建成功
npm start
# 查看日志输出
[RBAC] Initializing RBAC tables...
[RBAC] RBAC tables initialized successfully.
[RBAC] Migrated X user roles successfully.
```

```sql
-- 验证表结构
SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'portal_%' OR name LIKE '%_roles' OR name LIKE '%permissions';

-- 验证数据迁移
SELECT u.email, r.name as role_name FROM user_roles ur
JOIN users u ON ur.user_id = u.id
JOIN roles r ON ur.role_id = r.id;
```

---

### 第2天：API路由改造

**任务**:
1. 在 server.js 中集成RBAC中间件
2. 创建 /api/tls/* 命名空间路由
3. 实现旧API兼容层（/api/* → /api/tls/*）
4. 新增门户API (/api/portal/*)

**代码示例**:
```javascript
// src/server.js
const rbacManager = new RBACManager(db);
const { requirePermission, requireServiceAccess } = createRBACMiddleware(rbacManager);

// 新API
app.post("/api/tls/requests", 
  requirePermission('tls:request:create'),
  async (req, res) => { /* ... */ }
);

// 兼容旧API
app.use("/api/requests", (req, res, next) => {
  req.url = req.url.replace(/^\/api\/requests/, '/api/tls/requests');
  next();
});

// 门户API
app.get("/api/portal/services", requireAuth, async (req, res) => {
  const services = await rbacManager.getUserServices(req.session.user.id);
  return res.json(services);
});
```

**验证**:
```bash
# 测试新API
curl -X GET http://localhost:52344/api/tls/requests -b cookies.txt

# 测试旧API兼容
curl -X GET http://localhost:52344/api/requests -b cookies.txt

# 测试门户API
curl -X GET http://localhost:52344/api/portal/services -b cookies.txt
```

---

### 第3天：前端门户框架

**任务**:
1. 创建门户首页 (portal-home.html)
2. 创建服务卡片组件
3. 重构侧边栏导航（支持二级菜单）
4. 更新品牌标识

**门户首页结构**:
```html
<!-- public/portal-home.html -->
<div class="portal-home">
  <h1>产业互联网内部门户</h1>
  <p>Industrial Internet Internal Portal</p>
  
  <div class="service-grid">
    <!-- 服务卡片动态加载 -->
    <div class="service-card" data-service-id="tls-cert">
      <div class="service-icon">🔐</div>
      <h3>TLS证书管理</h3>
      <p>证书申请、签发与生命周期管理</p>
      <a href="/tls">进入服务 →</a>
    </div>
    
    <!-- 未来服务预留位 -->
    <div class="service-card placeholder">
      <div class="service-icon">➕</div>
      <h3>更多服务</h3>
      <p>敬请期待...</p>
    </div>
  </div>
</div>
```

**导航结构**:
```html
<!-- 所有页面的侧边栏 -->
<aside class="sidebar">
  <div class="brand">
    <div class="brand-title">产业互联网内部门户</div>
    <div class="brand-subtitle">Internal Portal</div>
  </div>
  <nav class="nav">
    <a href="/portal">🏠 首页</a>
    
    <!-- TLS服务菜单 -->
    <div class="nav-group">
      <div class="nav-group-title">🔐 TLS证书管理</div>
      <a href="/tls">证书申请</a>
      <a href="/tls/admin">证书签发</a>
      <a href="/tls/overview">证书总览</a>
      <a href="/tls/users">用户与权限</a>
      <a href="/tls/settings">系统设置</a>
    </div>
    
    <!-- 未来服务预留 -->
  </nav>
</aside>
```

**验证**:
- ✅ 访问 http://localhost:52344/ 显示门户首页
- ✅ 点击"TLS证书管理"进入TLS服务
- ✅ 侧边栏显示二级菜单
- ✅ 品牌标识已更新

---

### 第4天：前端页面路由调整

**任务**:
1. 所有TLS相关页面路由改为 /tls/* 前缀
2. 更新前端API调用路径
3. 页面权限控制改为基于RBAC
4. 测试所有页面功能

**路由映射**:
```
旧路由              → 新路由
/                  → /portal (门户首页)
/                  → /tls (TLS申请页，service角色默认)
/admin             → /tls/admin
/overview          → /tls/overview
/users             → /tls/users
/settings          → /tls/settings
/account           → /account (保持不变)
```

**前端API调用更新**:
```javascript
// 旧代码
fetch('/api/requests')

// 新代码（推荐）
fetch('/api/tls/requests')

// 或保持兼容（旧API仍可用）
fetch('/api/requests')  // 后端会重定向到 /api/tls/requests
```

**验证**:
- ✅ 所有TLS功能页面正常访问
- ✅ 申请、签发、下载流程正常
- ✅ 总览、导出功能正常
- ✅ 用户管理、系统设置正常

---

### 第5天：权限管理UI

**任务**:
1. 在用户管理页面增加"服务角色"列
2. 实现角色授予/撤销UI
3. 显示用户的权限列表
4. 权限变更历史查看

**用户管理页面改造**:
```html
<!-- public/tls/users.html -->
<table>
  <thead>
    <tr>
      <th>用户</th>
      <th>邮箱</th>
      <th>TLS角色</th>
      <th>权限详情</th>
      <th>操作</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>张三</td>
      <td>zhangsan@shengwang.cn</td>
      <td><span class="badge">TLS管理员</span></td>
      <td><button onclick="showPermissions(userId)">查看权限</button></td>
      <td>
        <button onclick="editRoles(userId)">编辑角色</button>
        <button onclick="viewHistory(userId)">变更历史</button>
      </td>
    </tr>
  </tbody>
</table>
```

**验证**:
- ✅ 可以查看用户在TLS服务的角色
- ✅ 可以授予/撤销用户角色
- ✅ 可以查看用户的详细权限列表
- ✅ 可以查看权限变更历史

---

### 第6天：测试与文档

**任务**:
1. 完整功能回归测试
2. 权限边界测试
3. 性能测试
4. 更新所有文档

**功能测试清单**:
```
TLS服务核心流程:
✅ 用户注册、登录
✅ 提交证书申请
✅ 研发签发证书
✅ 申请人下载证书
✅ 证书撤销（7天内）
✅ 证书总览查询、筛选、导出
✅ 用户管理（角色调整）
✅ 系统设置（SMTP配置）
✅ 邮件通知功能

门户功能:
✅ 门户首页访问
✅ 服务列表显示
✅ 服务权限检查
✅ 服务导航跳转

权限系统:
✅ 权限检查正常
✅ 角色授予/撤销
✅ 访问日志记录
✅ 权限审计日志
```

**权限边界测试**:
```
场景1: service角色用户
❌ 不能访问 /tls/admin (签发页)
❌ 不能访问 /tls/overview (总览页)
✅ 可以访问 /tls (申请页)
✅ 可以下载自己的证书

场景2: dev角色用户
✅ 可以访问签发页
✅ 可以访问总览页
❌ 不能访问用户管理
❌ 不能访问系统设置

场景3: admin角色用户
✅ 可以访问所有TLS功能
✅ 可以管理用户和角色
✅ 可以修改系统设置
```

**性能测试**:
```bash
# 权限检查性能
# 目标：单次权限检查 < 10ms
ab -n 1000 -c 10 http://localhost:52344/api/tls/requests

# 门户首页加载
# 目标：页面加载 < 500ms
ab -n 100 -c 5 http://localhost:52344/portal
```

**文档更新清单**:
- ✅ PRD.md - 增加门户和多服务描述
- ✅ HLD.md - 更新架构图和RBAC设计
- ✅ Developer-Runbook.md - 增加RBAC管理章节
- ✅ User-Guide.md - 更新导航和权限说明
- ✅ LLM-Context-Prompt.md - 更新业务规则
- ✅ CHANGELOG.md - 记录1.0.0版本变更
- ✅ README.md - 更新项目简介

---

### 第7天：打包发布

**任务**:
1. 版本号更新
2. 生成发布包
3. 部署验证
4. 回滚预案准备

**版本号更新**:
```json
// package.json
{
  "version": "1.0.0"
}
```

```javascript
// public/version.js
window.__APP_VERSION__ = '1.0.0';
```

```markdown
# CHANGELOG.md
## [1.0.0] - 2026-03-0X

### 重大变更
- **架构升级**: 从单一TLS系统升级为产业互联网内部门户
- **RBAC引入**: 完整的基于角色的访问控制系统
- **多服务支持**: 支持多个服务接入和统一管理

### 新增功能
- 门户首页和服务导航
- 细粒度权限控制（功能级别）
- 权限审计日志
- 服务访问日志

### API变更
- 新增 /api/portal/* 门户API
- 新增 /api/tls/* TLS服务API
- 保持 /api/* 旧API兼容（重定向）

### 数据库变更
- 新增8张RBAC相关表
- 自动迁移现有用户角色到RBAC体系
- 保持现有业务表不变

### 向后兼容
- 旧API路由继续可用
- users.role字段保留
- 现有前端页面路径兼容
```

**打包**:
```bash
bash deploy/package.sh
# 输出: internal-tls-portal-1.0.0.tar.gz
```

**部署验证**:
```bash
# 1. 备份现有数据
cp -r data/ data-backup-$(date +%Y%m%d)/
cp -r uploads/ uploads-backup-$(date +%Y%m%d)/

# 2. 部署新版本
tar -xzf internal-tls-portal-1.0.0.tar.gz
cd internal-tls-portal-1.0.0
docker-compose up -d --build

# 3. 验证
curl http://localhost:52344/api/health
curl http://localhost:52344/api/portal/services -b cookies.txt

# 4. 检查日志
docker-compose logs -f
```

---

## 五、风险评估与缓解

### 5.1 高风险项

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 数据迁移失败 | 🔴高 | 🟡中 | ① 启动前自动备份<br>② 迁移失败自动回滚<br>③ 提供手工修复脚本 |
| API兼容性破坏 | 🔴高 | 🟢低 | ① 保留所有旧API路由<br>② 充分测试兼容层<br>③ 提供降级开关 |
| 权限配置错误 | 🟡中 | 🟡中 | ① 预置TLS权限模板<br>② 自动迁移现有角色<br>③ 提供权限验证工具 |
| 性能下降 | 🟡中 | 🟡中 | ① 优化权限查询SQL<br>② 增加索引<br>③ 考虑缓存 |

### 5.2 回滚预案

**场景1: 应用启动失败**
```bash
# 停止新版本
docker-compose down

# 恢复旧版本
cd ../internal-tls-portal-0.9.8.3
docker-compose up -d
```

**场景2: 数据库迁移失败**
```bash
# 恢复数据库
rm data/app.db
cp data-backup-YYYYMMDD/app.db data/

# 重启旧版本
cd ../internal-tls-portal-0.9.8.3
docker-compose up -d
```

**场景3: 功能异常但应用可运行**
- 启用旧API兼容模式（默认已启用）
- 前端切换回旧路由
- 不影响现有用户使用

---

## 六、验证清单

### 6.1 数据库验证

```sql
-- 1. 检查RBAC表是否创建
SELECT name FROM sqlite_master 
WHERE type='table' AND (
  name LIKE 'portal_%' OR 
  name LIKE '%_roles' OR 
  name LIKE '%permissions%'
);
-- 预期返回: 8张表

-- 2. 检查TLS服务是否注册
SELECT * FROM portal_services WHERE id = 'tls-cert';
-- 预期返回: 1条记录

-- 3. 检查权限是否初始化
SELECT COUNT(*) as perm_count FROM permissions WHERE service_id = 'tls-cert';
-- 预期返回: ≥15条权限

-- 4. 检查角色是否初始化
SELECT * FROM roles WHERE service_id = 'tls-cert';
-- 预期返回: 4个角色 (tls-admin, tls-dev, tls-service, tls-product)

-- 5. 检查用户角色是否迁移
SELECT COUNT(*) as migrated_users FROM user_roles;
-- 预期返回: 与原users表中有role的用户数量一致

-- 6. 验证角色权限关联
SELECT r.name, COUNT(rp.permission_id) as perm_count
FROM roles r
LEFT JOIN role_permissions rp ON r.id = rp.role_id
WHERE r.service_id = 'tls-cert'
GROUP BY r.id, r.name;
-- 预期: 每个角色都有权限关联
```

### 6.2 API验证

```bash
# 1. 健康检查
curl http://localhost:52344/api/health
# 预期: {"ok":true}

# 2. 门户服务列表（需登录）
curl http://localhost:52344/api/portal/services -b cookies.txt
# 预期: 返回服务列表，包含tls-cert

# 3. TLS新API
curl http://localhost:52344/api/tls/requests -b cookies.txt
# 预期: 返回申请列表（根据权限）

# 4. TLS旧API兼容
curl http://localhost:52344/api/requests -b cookies.txt
# 预期: 与新API返回相同数据

# 5. 用户权限查询
curl http://localhost:52344/api/portal/services/tls-cert/permissions -b cookies.txt
# 预期: 返回用户在TLS服务的权限和角色
```

### 6.3 功能验证

**验证矩阵**:

| 功能 | admin | dev | service | product | 验证状态 |
|------|-------|-----|---------|---------|---------|
| 访问门户首页 | ✅ | ✅ | ✅ | ✅ | □ |
| 查看服务列表 | ✅ | ✅ | ✅ | ✅ | □ |
| 提交证书申请 | ✅ | ❌ | ✅ | ❌ | □ |
| 签发证书 | ✅ | ✅ | ❌ | ❌ | □ |
| 撤销证书 | ✅ | ✅ | ❌ | ❌ | □ |
| 下载证书 | ✅ | ✅ | ✅ | ❌ | □ |
| 查看总览 | ✅ | ✅ | ❌ | ✅ | □ |
| 导出数据 | ✅ | ✅ | ❌ | ✅ | □ |
| 用户管理 | ✅ | ❌ | ❌ | ❌ | □ |
| 系统设置 | ✅ | ❌ | ❌ | ❌ | □ |

### 6.4 性能验证

| 指标 | 目标 | 实际 | 验证状态 |
|------|------|------|---------|
| 首页加载时间 | <500ms | ___ | □ |
| API响应时间 | <200ms | ___ | □ |
| 权限检查耗时 | <10ms | ___ | □ |
| 数据库迁移耗时 | <5s | ___ | □ |
| 并发用户支持 | ≥50 | ___ | □ |

---

## 七、发布后监控

### 7.1 关键指标

```sql
-- 1. 每日活跃用户数
SELECT DATE(created_at) as date, COUNT(DISTINCT user_id) as active_users
FROM service_access_logs
WHERE created_at >= datetime('now', '-7 days')
GROUP BY DATE(created_at);

-- 2. 权限拒绝统计
SELECT DATE(created_at) as date, COUNT(*) as denied_count
FROM service_access_logs
WHERE result = 'denied'
AND created_at >= datetime('now', '-7 days')
GROUP BY DATE(created_at);

-- 3. 最常用的权限
SELECT permission_code, COUNT(*) as usage_count
FROM service_access_logs
WHERE permission_code IS NOT NULL
AND created_at >= datetime('now', '-7 days')
GROUP BY permission_code
ORDER BY usage_count DESC
LIMIT 10;

-- 4. 权限变更统计
SELECT operation, COUNT(*) as count
FROM permission_audit_logs
WHERE created_at >= datetime('now', '-7 days')
GROUP BY operation;
```

### 7.2 告警规则

1. **权限拒绝率 > 10%** → 检查权限配置
2. **API错误率 > 1%** → 检查兼容性问题
3. **权限检查耗时 > 50ms** → 考虑优化/缓存
4. **数据库大小增长 > 10MB/天** → 日志清理策略

---

## 八、后续优化建议

### 8.1 短期优化（1-2周）

1. **性能优化**
   - 在session中缓存用户权限列表
   - 增加权限查询的数据库索引
   - 考虑引入Redis缓存

2. **用户体验**
   - 优化权限拒绝的错误提示
   - 增加权限帮助文档
   - 提供权限自助查询工具

3. **运维工具**
   - 权限批量导入/导出工具
   - 权限问题诊断工具
   - 访问日志分析脚本

### 8.2 中期规划（1-3个月）

1. **接入第二个服务**
   - 验证RBAC系统扩展性
   - 优化服务注册流程
   - 完善跨服务权限管理

2. **权限可视化**
   - 权限关系图谱
   - 用户权限面板
   - 角色权限对比工具

3. **审计增强**
   - 敏感操作告警
   - 异常访问检测
   - 合规性报告生成

### 8.3 长期规划（3-6个月）

1. **SSO集成** - 对接公司统一认证
2. **多租户支持** - 如需要支持多组织
3. **API网关** - 统一API入口和限流
4. **微服务拆分** - 服务独立部署（如需要）

---

## 九、附录

### A. 快速命令参考

```bash
# 查看RBAC表结构
sqlite3 data/app.db ".schema portal_services"
sqlite3 data/app.db ".schema permissions"
sqlite3 data/app.db ".schema roles"

# 查看用户权限
sqlite3 data/app.db "SELECT * FROM user_roles WHERE user_id = 1;"

# 手工授予角色（紧急情况）
sqlite3 data/app.db "INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (1, 1, datetime('now'));"

# 清理旧日志（保留30天）
sqlite3 data/app.db "DELETE FROM service_access_logs WHERE created_at < datetime('now', '-30 days');"
```

### B. 故障排查指南

**问题1: 用户登录后看不到任何服务**
```sql
-- 检查用户是否有角色
SELECT * FROM user_roles WHERE user_id = ?;

-- 如果没有，手工授予TLS服务角色
INSERT INTO user_roles (user_id, role_id, granted_at)
SELECT ?, id, datetime('now') FROM roles WHERE code = 'tls-service';
```

**问题2: 权限检查总是返回403**
```javascript
// 启用调试模式
app.use("/api/tls/*", debugPermissions);

// 检查用户权限
const permissions = await rbacManager.getUserServicePermissions(userId, 'tls-cert');
console.log('User permissions:', permissions);
```

**问题3: 旧API不工作**
```javascript
// 检查路由重定向是否生效
app.use((req, res, next) => {
  console.log('Original URL:', req.url);
  next();
});
```

### C. 联系方式

- **技术负责人**: [填写]
- **运维负责人**: [填写]
- **紧急联系**: [填写]

---

**文档版本**: v1.0  
**最后更新**: 2026-03-02  
**批准人**: ___________  
**生效日期**: ___________
