# RBAC系统集成指南

## 1. 概述

本文档说明如何在 `src/server.js` 中集成RBAC权限系统。

## 2. 基础集成

### 2.1 导入RBAC模块

在 `src/server.js` 顶部添加：

```javascript
const { RBACManager } = require("./rbac-manager");
const { createRBACMiddleware } = require("./rbac-middleware");
```

### 2.2 初始化RBAC管理器

在 `initDb()` 完成后初始化：

```javascript
initDb()
  .then((db) => {
    // 创建RBAC管理器实例
    const rbacManager = new RBACManager(db);
    
    // 创建中间件
    const {
      requirePermission,
      requireServiceAccess,
      requireRole,
      requireAdmin,
      attachUserPermissions,
      debugPermissions
    } = createRBACMiddleware(rbacManager);
    
    // ... 后续代码
  });
```

## 3. 路由权限改造示例

### 3.1 旧的权限检查方式（保持兼容）

```javascript
// 旧方式：基于角色
app.post("/api/requests/:id/issue",
  requireRole([ROLE_ADMIN, ROLE_DEV]),
  upload.single("zipFile"),
  async (req, res) => {
    // ... 签发逻辑
  }
);
```

### 3.2 新的权限检查方式（推荐）

```javascript
// 新方式：基于权限码
app.post("/api/tls/requests/:id/issue",
  requirePermission('tls:cert:issue'),
  upload.single("zipFile"),
  async (req, res) => {
    // ... 签发逻辑
  }
);

// 或者要求多个权限（任一满足）
app.get("/api/tls/overview",
  requirePermission(['tls:overview:read', 'tls:overview:filter'], 'any'),
  async (req, res) => {
    // ... 总览逻辑
  }
);

// 要求多个权限（全部满足）
app.delete("/api/tls/users/:id",
  requirePermission(['tls:user:delete', 'tls:user:manage'], 'all'),
  async (req, res) => {
    // ... 删除用户逻辑
  }
);
```

### 3.3 服务级别权限检查

```javascript
// 检查用户是否有访问TLS服务的权限
app.use("/api/tls/*", requireServiceAccess('tls-cert'));

// 检查用户是否有特定角色
app.get("/api/tls/admin/dashboard",
  requireServiceAccess('tls-cert', ['tls-admin', 'tls-dev']),
  async (req, res) => {
    // ... 管理面板逻辑
  }
);
```

### 3.4 附加用户权限信息

```javascript
// 将用户权限注入到请求对象，便于在业务逻辑中使用
app.use("/tls", attachUserPermissions('tls-cert'));

app.get("/api/tls/requests", async (req, res) => {
  // 可以访问 req.userPermissions
  // {
  //   permissions: ['tls:request:read', 'tls:cert:download', ...],
  //   permissionsDetail: [...],
  //   roles: ['tls-service'],
  //   rolesDetail: [...]
  // }
  
  const canViewAll = req.userPermissions.permissions.includes('tls:request:read_all');
  // ... 根据权限返回不同数据
});
```

## 4. API路由命名空间迁移

### 4.1 新旧API路由共存

```javascript
// ============================================
// TLS服务路由（新）
// ============================================

// 证书申请
app.post("/api/tls/requests", 
  requirePermission('tls:request:create'),
  async (req, res) => { /* ... */ }
);

app.get("/api/tls/requests",
  requirePermission('tls:request:read'),
  async (req, res) => { /* ... */ }
);

// 证书签发
app.post("/api/tls/requests/:id/issue",
  requirePermission('tls:cert:issue'),
  upload.single("zipFile"),
  async (req, res) => { /* ... */ }
);

// 证书撤销
app.post("/api/tls/requests/:id/revoke",
  requirePermission('tls:cert:revoke'),
  async (req, res) => { /* ... */ }
);

// 证书总览
app.get("/api/tls/overview",
  requirePermission('tls:overview:read'),
  async (req, res) => { /* ... */ }
);

app.get("/api/tls/overview/export",
  requirePermission('tls:overview:export'),
  async (req, res) => { /* ... */ }
);

// 用户管理
app.get("/api/tls/users",
  requirePermission('tls:user:read'),
  async (req, res) => { /* ... */ }
);

app.put("/api/tls/users/:id",
  requirePermission('tls:user:update'),
  async (req, res) => { /* ... */ }
);

// 系统设置
app.get("/api/tls/settings",
  requirePermission('tls:settings:read'),
  async (req, res) => { /* ... */ }
);

app.post("/api/tls/settings",
  requirePermission('tls:settings:update'),
  async (req, res) => { /* ... */ }
);

// ============================================
// 向后兼容：旧API路由重定向到新路由
// ============================================

app.use("/api/requests", (req, res, next) => {
  req.url = req.url.replace(/^\/api\/requests/, '/api/tls/requests');
  next();
});

app.use("/api/overview", (req, res, next) => {
  req.url = req.url.replace(/^\/api\/overview/, '/api/tls/overview');
  next();
});

app.use("/api/admin", (req, res, next) => {
  req.url = req.url.replace(/^\/api\/admin/, '/api/tls/admin');
  next();
});
```

### 4.2 或者：使用路由代理（更优雅）

```javascript
// 定义TLS路由处理函数
const tlsRequestsRouter = express.Router();

tlsRequestsRouter.post("/",
  requirePermission('tls:request:create'),
  async (req, res) => { /* ... */ }
);

tlsRequestsRouter.get("/",
  requirePermission('tls:request:read'),
  async (req, res) => { /* ... */ }
);

// 新路由
app.use("/api/tls/requests", tlsRequestsRouter);

// 旧路由兼容
app.use("/api/requests", tlsRequestsRouter);
```

## 5. 门户服务API

### 5.1 获取用户可访问的服务列表

```javascript
app.get("/api/portal/services", requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  const services = await rbacManager.getUserServices(userId);
  return res.json(services);
});
```

### 5.2 获取用户在某个服务的权限

```javascript
app.get("/api/portal/services/:serviceId/permissions", requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  const { serviceId } = req.params;
  
  const permissions = await rbacManager.getUserServicePermissions(userId, serviceId);
  const roles = await rbacManager.getUserServiceRoles(userId, serviceId);
  
  return res.json({ permissions, roles });
});
```

### 5.3 管理员：授予/撤销角色

```javascript
// 授予角色
app.post("/api/portal/users/:userId/roles/:roleId", 
  requirePermission('portal:user:manage'),
  async (req, res) => {
    const { userId, roleId } = req.params;
    const { expiresAt, reason } = req.body;
    const operatorId = req.session.user.id;
    
    await rbacManager.grantRole(
      parseInt(userId),
      parseInt(roleId),
      operatorId,
      expiresAt,
      reason
    );
    
    return res.json({ ok: true });
  }
);

// 撤销角色
app.delete("/api/portal/users/:userId/roles/:roleId",
  requirePermission('portal:user:manage'),
  async (req, res) => {
    const { userId, roleId } = req.params;
    const { reason } = req.body;
    const operatorId = req.session.user.id;
    
    await rbacManager.revokeRole(
      parseInt(userId),
      parseInt(roleId),
      operatorId,
      reason
    );
    
    return res.json({ ok: true });
  }
);
```

### 5.4 获取权限变更历史

```javascript
app.get("/api/portal/users/:userId/permission-history",
  requirePermission(['portal:user:manage', 'portal:audit:read'], 'any'),
  async (req, res) => {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    
    const history = await rbacManager.getUserPermissionHistory(userId, limit);
    return res.json(history);
  }
);
```

## 6. 前端调用示例

### 6.1 获取用户服务列表

```javascript
// public/portal-home.js
async function loadUserServices() {
  const response = await fetch('/api/portal/services');
  const services = await response.json();
  
  // 渲染服务卡片
  services.forEach(service => {
    renderServiceCard(service);
  });
}
```

### 6.2 检查用户权限（前端）

```javascript
// public/tls/app.js
async function checkUserPermissions() {
  const response = await fetch('/api/portal/services/tls-cert/permissions');
  const { permissions, roles } = await response.json();
  
  const canIssue = permissions.some(p => p.code === 'tls:cert:issue');
  const canExport = permissions.some(p => p.code === 'tls:overview:export');
  
  // 根据权限显示/隐藏按钮
  if (canIssue) {
    document.getElementById('issue-btn').style.display = 'block';
  }
  
  if (canExport) {
    document.getElementById('export-btn').style.display = 'block';
  }
}
```

## 7. 渐进式迁移策略

### 7.1 阶段1：共存（当前）

- 新路由使用RBAC权限检查
- 旧路由保持原有角色检查
- 两套系统并行运行

### 7.2 阶段2：迁移

- 逐步将旧路由改为使用RBAC
- 使用 `requireRole` 作为过渡（内部会检查RBAC）
- 前端逐步迁移到新API

### 7.3 阶段3：清理

- 移除旧的角色检查代码
- 统一使用RBAC权限检查
- 移除向后兼容层

## 8. 测试验证

### 8.1 权限检查测试

```javascript
// 测试用户是否有权限
const hasPermission = await rbacManager.hasPermission(userId, 'tls:cert:issue');
console.log('Can issue certificate:', hasPermission);

// 测试用户的所有权限
const permissions = await rbacManager.getUserServicePermissions(userId, 'tls-cert');
console.log('User permissions:', permissions.map(p => p.code));

// 测试用户的角色
const roles = await rbacManager.getUserServiceRoles(userId, 'tls-cert');
console.log('User roles:', roles.map(r => r.name));
```

### 8.2 API测试

```bash
# 测试新API（需要权限）
curl -X POST http://localhost:52344/api/tls/requests \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"customerName":"Test","productSku":"混合云","vid":"V12345"}'

# 测试旧API（兼容）
curl -X POST http://localhost:52344/api/requests \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"customerName":"Test","productSku":"混合云","vid":"V12345"}'
```

## 9. 故障排查

### 9.1 权限检查失败

```javascript
// 启用调试日志
app.use("/api/tls/*", attachUserPermissions('tls-cert'), debugPermissions);
```

### 9.2 查看用户权限详情

```sql
-- 查看用户的所有角色
SELECT u.email, r.name as role_name, r.code as role_code
FROM user_roles ur
JOIN users u ON ur.user_id = u.id
JOIN roles r ON ur.role_id = r.id
WHERE u.id = 1;

-- 查看用户的所有权限
SELECT DISTINCT p.code, p.name, p.action
FROM user_roles ur
JOIN role_permissions rp ON ur.role_id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE ur.user_id = 1
ORDER BY p.code;
```

## 10. 注意事项

1. **性能优化**：权限检查会增加数据库查询，建议：
   - 在session中缓存用户权限列表
   - 使用Redis缓存权限查询结果
   - 批量权限检查避免N+1查询

2. **安全性**：
   - 始终在后端进行权限检查
   - 前端权限仅用于UI控制
   - 记录所有权限变更日志

3. **向后兼容**：
   - 保留 `users.role` 字段至少1个版本
   - 使用路由重定向保持旧API可用
   - 逐步迁移，避免大爆炸式改造
