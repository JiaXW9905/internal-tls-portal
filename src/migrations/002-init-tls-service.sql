-- ============================================
-- TLS Service RBAC Initialization
-- Description: 初始化TLS证书管理服务的角色和权限
-- ============================================

-- ============================================
-- 1. 注册TLS服务
-- ============================================
INSERT OR REPLACE INTO portal_services (
  id, name, name_en, description, icon, base_path, api_prefix, 
  enabled, sort_order, created_at
) VALUES (
  'tls-cert',
  'TLS证书管理',
  'TLS Certificate Management',
  '内部TLS证书申请、签发、下载与生命周期管理',
  'certificate',
  '/tls',
  '/api/tls',
  1,
  1,
  datetime('now')
);

-- ============================================
-- 2. 定义TLS服务权限
-- ============================================

-- 证书申请相关权限
INSERT OR IGNORE INTO permissions (service_id, code, name, description, resource_type, action, created_at) VALUES
('tls-cert', 'tls:request:create', '创建证书申请', '允许用户提交新的证书申请', 'request', 'create', datetime('now')),
('tls-cert', 'tls:request:read', '查看证书申请', '查看证书申请列表和详情', 'request', 'read', datetime('now')),
('tls-cert', 'tls:request:read_all', '查看所有申请', '查看所有用户的证书申请（管理员）', 'request', 'read_all', datetime('now')),
('tls-cert', 'tls:request:withdraw', '撤回申请', '撤回待处理状态的证书申请', 'request', 'withdraw', datetime('now'));

-- 证书签发相关权限
INSERT OR IGNORE INTO permissions (service_id, code, name, description, resource_type, action, created_at) VALUES
('tls-cert', 'tls:cert:issue', '签发证书', '上传证书文件并完成签发', 'certificate', 'issue', datetime('now')),
('tls-cert', 'tls:cert:revoke', '撤销证书', '撤销已签发的证书（7天内）', 'certificate', 'revoke', datetime('now')),
('tls-cert', 'tls:cert:download', '下载证书', '下载已签发的证书文件', 'certificate', 'download', datetime('now')),
('tls-cert', 'tls:cert:view_password', '查看解压密码', '查看证书的解压密码', 'certificate', 'view_password', datetime('now'));

-- 证书总览相关权限
INSERT OR IGNORE INTO permissions (service_id, code, name, description, resource_type, action, created_at) VALUES
('tls-cert', 'tls:overview:read', '查看证书总览', '访问证书总览页面并查看统计数据', 'overview', 'read', datetime('now')),
('tls-cert', 'tls:overview:export', '导出证书数据', '导出证书总览数据为CSV文件', 'overview', 'export', datetime('now')),
('tls-cert', 'tls:overview:filter', '筛选证书数据', '使用高级筛选条件查询证书', 'overview', 'filter', datetime('now'));

-- 用户管理相关权限
INSERT OR IGNORE INTO permissions (service_id, code, name, description, resource_type, action, created_at) VALUES
('tls-cert', 'tls:user:read', '查看用户列表', '查看系统用户列表', 'user', 'read', datetime('now')),
('tls-cert', 'tls:user:create', '创建用户', '创建新用户账号', 'user', 'create', datetime('now')),
('tls-cert', 'tls:user:update', '编辑用户', '修改用户信息和角色', 'user', 'update', datetime('now')),
('tls-cert', 'tls:user:delete', '删除用户', '删除用户账号', 'user', 'delete', datetime('now')),
('tls-cert', 'tls:user:reset_password', '重置密码', '重置用户密码', 'user', 'reset_password', datetime('now'));

-- 系统设置相关权限
INSERT OR IGNORE INTO permissions (service_id, code, name, description, resource_type, action, created_at) VALUES
('tls-cert', 'tls:settings:read', '查看系统设置', '查看SMTP等系统配置', 'settings', 'read', datetime('now')),
('tls-cert', 'tls:settings:update', '修改系统设置', '修改系统配置参数', 'settings', 'update', datetime('now'));

-- ============================================
-- 3. 定义TLS服务角色
-- ============================================

-- 角色1: TLS管理员（拥有所有权限）
INSERT OR IGNORE INTO roles (service_id, code, name, description, is_system, created_at) VALUES
('tls-cert', 'tls-admin', 'TLS管理员', '拥有TLS证书管理的所有权限，包括用户管理和系统设置', 1, datetime('now'));

-- 角色2: TLS研发（签发和撤销权限）
INSERT OR IGNORE INTO roles (service_id, code, name, description, is_system, created_at) VALUES
('tls-cert', 'tls-dev', 'TLS研发', '负责证书签发和撤销，可查看总览数据', 1, datetime('now'));

-- 角色3: TLS服务申请人（申请和下载）
INSERT OR IGNORE INTO roles (service_id, code, name, description, is_system, created_at) VALUES
('tls-cert', 'tls-service', 'TLS服务申请人', '可以提交证书申请、撤回申请和下载证书', 1, datetime('now'));

-- 角色4: TLS产品（只读总览）
INSERT OR IGNORE INTO roles (service_id, code, name, description, is_system, created_at) VALUES
('tls-cert', 'tls-product', 'TLS产品', '可以查看和导出证书总览数据', 1, datetime('now'));

-- ============================================
-- 4. 关联角色与权限
-- ============================================

-- TLS管理员：所有权限
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, granted_at)
SELECT 
  (SELECT id FROM roles WHERE code = 'tls-admin'),
  p.id,
  datetime('now')
FROM permissions p
WHERE p.service_id = 'tls-cert';

-- TLS研发：签发、撤销、总览
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, granted_at)
SELECT 
  (SELECT id FROM roles WHERE code = 'tls-dev'),
  p.id,
  datetime('now')
FROM permissions p
WHERE p.code IN (
  'tls:request:read',
  'tls:cert:issue',
  'tls:cert:revoke',
  'tls:cert:download',
  'tls:cert:view_password',
  'tls:overview:read',
  'tls:overview:export',
  'tls:overview:filter'
);

-- TLS服务申请人：申请、撤回、下载
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, granted_at)
SELECT 
  (SELECT id FROM roles WHERE code = 'tls-service'),
  p.id,
  datetime('now')
FROM permissions p
WHERE p.code IN (
  'tls:request:create',
  'tls:request:read',
  'tls:request:withdraw',
  'tls:cert:download',
  'tls:cert:view_password'
);

-- TLS产品：总览查看和导出
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, granted_at)
SELECT 
  (SELECT id FROM roles WHERE code = 'tls-product'),
  p.id,
  datetime('now')
FROM permissions p
WHERE p.code IN (
  'tls:overview:read',
  'tls:overview:export',
  'tls:overview:filter'
);
