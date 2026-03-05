# 快速验证指南 - 产业互联网内部门户 v1.0.0

## 🚀 5分钟快速验证

### 步骤1: 验证应用运行 ✅

```bash
# 检查应用状态
curl http://localhost:52344/api/health
# 预期输出: {"ok":true}
```

---

### 步骤2: 登录系统

1. 打开浏览器访问: `http://localhost:52344`
2. 自动跳转到登录页面
3. 使用现有账号登录（如 `wangjiaxin@shengwang.cn`）

---

### 步骤3: 验证门户首页 ⭐️

登录成功后，您应该看到：

**门户首页 (`/portal`)**
- ✨ 欢迎信息显示您的用户名
- 🔐 TLS证书管理服务卡片
- ➕ "更多服务"占位卡片

**侧边栏导航**
- 🏠 首页
- 🔐 TLS证书管理
  - 服务首页

---

### 步骤4: 测试TLS服务

点击"TLS证书管理"卡片，进入TLS服务：

**验证功能**:
- ✅ 证书申请功能正常
- ✅ 证书签发功能正常（admin/dev角色）
- ✅ 证书总览功能正常
- ✅ 用户管理功能正常（admin角色）

---

### 步骤5: 测试门户API（可选）

```bash
# 先登录获取cookie（在浏览器控制台运行）
document.cookie

# 1. 获取服务列表
curl http://localhost:52344/api/portal/services \
  -H "Cookie: YOUR_COOKIE_HERE"

# 预期输出:
[
  {
    "id": "tls-cert",
    "name": "TLS证书管理",
    "name_en": "TLS Certificate Management",
    "description": "内部TLS证书申请、签发、下载与生命周期管理",
    "icon": "certificate",
    "base_path": "/tls",
    "api_prefix": "/api/tls",
    "enabled": 1,
    "sort_order": 1
  }
]

# 2. 获取TLS权限
curl http://localhost:52344/api/portal/services/tls-cert/permissions \
  -H "Cookie: YOUR_COOKIE_HERE"

# 预期输出: 根据您的角色返回相应权限列表
```

---

## 🔍 详细验证清单

### A. 数据库验证

```bash
# 进入数据库
sqlite3 data/app.db

# 1. 检查RBAC表
.tables
# 应该看到: permissions, portal_services, role_permissions, user_permissions, user_roles

# 2. 查看TLS服务
SELECT * FROM portal_services WHERE id = 'tls-cert';

# 3. 查看角色
SELECT code, name FROM roles WHERE service_id = 'tls-cert';
# 应该看到: tls-admin, tls-dev, tls-service, tls-product

# 4. 查看您的角色
SELECT r.name 
FROM user_roles ur 
JOIN roles r ON ur.role_id = r.id 
JOIN users u ON ur.user_id = u.id 
WHERE u.email = 'YOUR_EMAIL@shengwang.cn';

# 5. 查看您的权限
SELECT p.code, p.name 
FROM user_roles ur 
JOIN role_permissions rp ON ur.role_id = rp.role_id 
JOIN permissions p ON rp.permission_id = p.id 
JOIN users u ON ur.user_id = u.id 
WHERE u.email = 'YOUR_EMAIL@shengwang.cn';

# 退出
.quit
```

---

### B. 权限功能验证

#### 场景1: Admin用户验证

登录后应该能够：
- ✅ 访问门户首页
- ✅ 提交证书申请
- ✅ 签发证书
- ✅ 撤销证书
- ✅ 查看证书总览
- ✅ 导出证书数据
- ✅ 管理用户
- ✅ 修改系统设置

#### 场景2: Dev用户验证

登录后应该能够：
- ✅ 访问门户首页
- ✅ 查看申请列表（仅与自己相关）
- ✅ 签发证书
- ✅ 撤销证书
- ✅ 查看证书总览
- ✅ 导出证书数据
- ❌ 不能管理用户
- ❌ 不能修改系统设置

#### 场景3: Service用户验证

登录后应该能够：
- ✅ 访问门户首页
- ✅ 提交证书申请
- ✅ 查看自己的申请
- ✅ 撤回待处理的申请
- ✅ 下载已签发的证书
- ❌ 不能访问签发页面
- ❌ 不能访问总览页面
- ❌ 不能管理用户

#### 场景4: Product用户验证

登录后应该能够：
- ✅ 访问门户首页
- ✅ 查看证书总览
- ✅ 导出证书数据
- ❌ 不能提交申请
- ❌ 不能访问签发页面
- ❌ 不能管理用户

---

### C. 向后兼容性验证

```bash
# 1. 旧API路径仍可用
curl http://localhost:52344/api/requests -b cookies.txt
# 应该正常返回数据

# 2. 旧页面路径兼容
# 访问 http://localhost:52344/admin
# 应该能正常打开签发页面

# 3. 数据完整性
# 检查现有的证书申请、签发记录是否都正常显示
```

---

## 🐛 常见问题排查

### 问题1: 登录后看不到门户首页

**解决方案**:
- 清除浏览器缓存
- 检查是否正确跳转到 `/portal`
- 查看浏览器控制台是否有JavaScript错误

### 问题2: 显示"暂无可用服务"

**可能原因**: 用户没有被分配任何角色

**解决方案**:
```sql
-- 检查用户角色
SELECT * FROM user_roles WHERE user_id = YOUR_USER_ID;

-- 如果为空，手工授予角色（以tls-service为例）
INSERT INTO user_roles (user_id, role_id, granted_at)
SELECT YOUR_USER_ID, id, datetime('now') 
FROM roles WHERE code = 'tls-service';
```

### 问题3: API返回403 Forbidden

**可能原因**: 权限不足

**解决方案**:
- 检查您的角色是否有相应权限
- 查看 `data/app.db` 中的 `user_roles` 和 `role_permissions` 表

### 问题4: 旧功能不工作了

**解决方案**:
- 检查浏览器控制台错误
- 验证旧API路径是否仍可访问
- 查看服务器日志: `docker-compose logs -f`

---

## 📊 性能检查

```bash
# 1. 健康检查响应时间
time curl http://localhost:52344/api/health
# 应该 < 100ms

# 2. 门户API响应时间
time curl http://localhost:52344/api/portal/services -b cookies.txt
# 应该 < 200ms

# 3. 权限检查性能
# 在浏览器控制台查看API响应时间
# Network标签 → 查看API请求耗时
```

---

## ✅ 验收标准

### 必须通过（P0）

- [ ] 应用能够正常启动
- [ ] 登录功能正常
- [ ] 门户首页正常显示
- [ ] TLS服务卡片可点击
- [ ] TLS所有核心功能正常（申请/签发/下载/总览）
- [ ] 权限检查正常（不同角色有不同权限）
- [ ] 旧API路径仍可访问

### 应该通过（P1）

- [ ] 门户API正常返回数据
- [ ] 数据库RBAC表正确创建
- [ ] 用户角色正确迁移
- [ ] 权限列表正确显示
- [ ] 版本号显示为1.0.0

### 建议通过（P2）

- [ ] 侧边栏导航美观
- [ ] 服务卡片样式美观
- [ ] 移动端适配良好
- [ ] 加载动画流畅

---

## 📝 验证报告模板

### 验证人: ___________
### 验证日期: ___________

| 测试项 | 结果 | 备注 |
|--------|------|------|
| 应用启动 | ☐ 通过 ☐ 失败 | |
| 登录功能 | ☐ 通过 ☐ 失败 | |
| 门户首页 | ☐ 通过 ☐ 失败 | |
| TLS申请 | ☐ 通过 ☐ 失败 | |
| TLS签发 | ☐ 通过 ☐ 失败 | |
| TLS总览 | ☐ 通过 ☐ 失败 | |
| 权限检查 | ☐ 通过 ☐ 失败 | |
| 向后兼容 | ☐ 通过 ☐ 失败 | |

### 发现的问题:
1. 
2. 
3. 

### 总体评价:
☐ 可以上线  
☐ 需要修复后上线  
☐ 重大问题，不能上线

---

## 🎉 验证通过后

如果所有P0和P1测试项都通过，恭喜！系统已准备就绪。

**下一步**:
1. 更新用户文档
2. 通知团队成员
3. 计划后续优化
4. 考虑接入新服务

**回滚预案**（如需要）:
```bash
cd /path/to/deployment
docker-compose down
cd ../internal-tls-portal-0.9.8.3
docker-compose up -d
```

---

**文档版本**: v1.0  
**最后更新**: 2026-03-02
