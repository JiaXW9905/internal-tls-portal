-- ============================================
-- Portal RBAC Migration
-- Version: 1.0.0
-- Description: 引入完整的RBAC权限模型，支持多服务场景
-- ============================================

-- ============================================
-- 1. 服务注册表
-- ============================================
CREATE TABLE IF NOT EXISTS portal_services (
  id TEXT PRIMARY KEY,                    -- 服务唯一标识，如: 'tls-cert', 'asset-mgmt'
  name TEXT NOT NULL,                     -- 服务中文名称
  name_en TEXT,                           -- 服务英文名称
  description TEXT,                       -- 服务描述
  icon TEXT,                              -- 服务图标标识
  base_path TEXT NOT NULL,                -- 前端路由基础路径，如: '/tls'
  api_prefix TEXT NOT NULL,               -- API路由前缀，如: '/api/tls'
  enabled INTEGER DEFAULT 1,              -- 是否启用: 1启用, 0禁用
  sort_order INTEGER DEFAULT 0,           -- 显示排序，数字越小越靠前
  config_json TEXT,                       -- 服务特定配置(JSON格式)
  created_at TEXT NOT NULL,
  updated_at TEXT
);

-- ============================================
-- 2. 权限定义表
-- ============================================
CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id TEXT NOT NULL,               -- 所属服务ID
  code TEXT NOT NULL,                     -- 权限唯一码，如: 'tls:cert:create'
  name TEXT NOT NULL,                     -- 权限显示名称
  description TEXT,                       -- 权限描述
  resource_type TEXT,                     -- 资源类型，如: 'certificate', 'request'
  action TEXT NOT NULL,                   -- 操作类型，如: 'create', 'read', 'update', 'delete'
  created_at TEXT NOT NULL,
  UNIQUE(service_id, code),
  FOREIGN KEY(service_id) REFERENCES portal_services(id) ON DELETE CASCADE
);

CREATE INDEX idx_permissions_service ON permissions(service_id);
CREATE INDEX idx_permissions_code ON permissions(code);

-- ============================================
-- 3. 角色定义表
-- ============================================
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id TEXT,                        -- 所属服务ID，NULL表示全局角色
  code TEXT NOT NULL,                     -- 角色唯一码，如: 'tls-admin', 'global-viewer'
  name TEXT NOT NULL,                     -- 角色显示名称
  description TEXT,                       -- 角色描述
  is_system INTEGER DEFAULT 0,            -- 是否系统角色: 1系统角色(不可删除), 0自定义角色
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE(service_id, code)
);

CREATE INDEX idx_roles_service ON roles(service_id);
CREATE INDEX idx_roles_code ON roles(code);

-- ============================================
-- 4. 角色-权限映射表
-- ============================================
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY(permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE INDEX idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission ON role_permissions(permission_id);

-- ============================================
-- 5. 用户-角色映射表
-- ============================================
CREATE TABLE IF NOT EXISTS user_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  role_id INTEGER NOT NULL,
  granted_by INTEGER,                     -- 授权人用户ID
  granted_at TEXT NOT NULL,
  expires_at TEXT,                        -- 权限过期时间，NULL表示永久
  UNIQUE(user_id, role_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY(granted_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_role ON user_roles(role_id);
CREATE INDEX idx_user_roles_user_active ON user_roles(user_id) WHERE expires_at IS NULL OR datetime(expires_at) > datetime('now');

-- ============================================
-- 6. 用户直接权限表（用于特殊授权）
-- ============================================
CREATE TABLE IF NOT EXISTS user_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  effect TEXT NOT NULL DEFAULT 'allow',   -- 'allow' 允许 或 'deny' 拒绝
  granted_by INTEGER,                     -- 授权人用户ID
  granted_at TEXT NOT NULL,
  expires_at TEXT,                        -- 权限过期时间，NULL表示永久
  reason TEXT,                            -- 授权原因说明
  UNIQUE(user_id, permission_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
  FOREIGN KEY(granted_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_user_permissions_user ON user_permissions(user_id);
CREATE INDEX idx_user_permissions_permission ON user_permissions(permission_id);
CREATE INDEX idx_user_permissions_user_active ON user_permissions(user_id) WHERE expires_at IS NULL OR datetime(expires_at) > datetime('now');

-- ============================================
-- 7. 服务访问日志表（审计用）
-- ============================================
CREATE TABLE IF NOT EXISTS service_access_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  service_id TEXT NOT NULL,
  permission_code TEXT,                   -- 使用的权限码
  action TEXT NOT NULL,                   -- 操作类型
  resource_type TEXT,                     -- 资源类型
  resource_id TEXT,                       -- 资源ID
  result TEXT NOT NULL,                   -- 'success' 或 'denied'
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(service_id) REFERENCES portal_services(id) ON DELETE CASCADE
);

CREATE INDEX idx_access_logs_user_time ON service_access_logs(user_id, created_at);
CREATE INDEX idx_access_logs_service_time ON service_access_logs(service_id, created_at);
CREATE INDEX idx_access_logs_result ON service_access_logs(result);

-- ============================================
-- 8. 权限变更历史表（审计用）
-- ============================================
CREATE TABLE IF NOT EXISTS permission_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,               -- 被操作的用户
  operator_id INTEGER NOT NULL,           -- 操作人
  operation TEXT NOT NULL,                -- 操作类型: 'grant_role', 'revoke_role', 'grant_permission', 'revoke_permission'
  role_id INTEGER,                        -- 相关角色ID
  permission_id INTEGER,                  -- 相关权限ID
  effect TEXT,                            -- 对于直接权限: 'allow' 或 'deny'
  reason TEXT,                            -- 操作原因
  metadata_json TEXT,                     -- 额外元数据
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(operator_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE SET NULL,
  FOREIGN KEY(permission_id) REFERENCES permissions(id) ON DELETE SET NULL
);

CREATE INDEX idx_permission_audit_user ON permission_audit_logs(user_id, created_at);
CREATE INDEX idx_permission_audit_operator ON permission_audit_logs(operator_id, created_at);
