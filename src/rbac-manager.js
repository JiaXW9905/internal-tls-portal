/**
 * RBAC Permission Manager
 * 
 * 提供完整的RBAC权限管理功能，包括：
 * - 权限检查
 * - 角色管理
 * - 用户授权
 * - 审计日志
 */

const fs = require('fs');
const path = require('path');

class RBACManager {
  constructor(db) {
    this.db = db;
  }

  // ============================================
  // 初始化与迁移
  // ============================================

  /**
   * 初始化RBAC表结构
   */
  async initialize() {
    console.log('[RBAC] Initializing RBAC tables...');
    
    // 执行Schema创建
    const schemaSQL = fs.readFileSync(
      path.join(__dirname, 'migrations', '001-portal-rbac.sql'),
      'utf-8'
    );
    await this.db.exec(schemaSQL);
    
    // 初始化TLS服务权限
    const tlsInitSQL = fs.readFileSync(
      path.join(__dirname, 'migrations', '002-init-tls-service.sql'),
      'utf-8'
    );
    await this.db.exec(tlsInitSQL);
    
    console.log('[RBAC] RBAC tables initialized successfully.');
  }

  /**
   * 从旧的users.role字段迁移到RBAC体系
   */
  async migrateFromLegacyRoles() {
    console.log('[RBAC] Migrating legacy user roles to RBAC...');
    
    const now = new Date().toISOString();
    
    // 角色映射关系
    const roleMapping = {
      'admin': 'tls-admin',
      'dev': 'tls-dev',
      'service': 'tls-service',
      'product': 'tls-product'
    };
    
    // 获取所有用户
    const users = await this.db.all('SELECT id, role FROM users WHERE role IS NOT NULL');
    
    let migratedCount = 0;
    
    for (const user of users) {
      const newRoleCode = roleMapping[user.role];
      if (!newRoleCode) {
        console.warn(`[RBAC] Unknown legacy role: ${user.role} for user ${user.id}`);
        continue;
      }
      
      // 获取新角色ID
      const role = await this.db.get('SELECT id FROM roles WHERE code = ?', newRoleCode);
      if (!role) {
        console.warn(`[RBAC] Role not found: ${newRoleCode}`);
        continue;
      }
      
      // 检查是否已经迁移
      const existing = await this.db.get(
        'SELECT id FROM user_roles WHERE user_id = ? AND role_id = ?',
        user.id, role.id
      );
      
      if (!existing) {
        // 授予角色
        await this.db.run(
          `INSERT INTO user_roles (user_id, role_id, granted_at)
           VALUES (?, ?, ?)`,
          user.id, role.id, now
        );
        migratedCount++;
      }
    }
    
    console.log(`[RBAC] Migrated ${migratedCount} user roles successfully.`);
  }

  // ============================================
  // 权限检查核心方法
  // ============================================

  /**
   * 检查用户是否拥有指定权限
   * @param {number} userId - 用户ID
   * @param {string} permissionCode - 权限码，如 'tls:cert:create'
   * @returns {Promise<boolean>}
   */
  async hasPermission(userId, permissionCode) {
    // 1. 检查用户直接权限（优先级最高）
    const directPerm = await this.db.get(
      `SELECT up.effect 
       FROM user_permissions up
       JOIN permissions p ON up.permission_id = p.id
       WHERE up.user_id = ? AND p.code = ?
       AND (up.expires_at IS NULL OR datetime(up.expires_at) > datetime('now'))`,
      userId, permissionCode
    );
    
    if (directPerm) {
      return directPerm.effect === 'allow';
    }
    
    // 2. 检查角色权限
    const rolePerm = await this.db.get(
      `SELECT 1 
       FROM user_roles ur
       JOIN role_permissions rp ON ur.role_id = rp.role_id
       JOIN permissions p ON rp.permission_id = p.id
       WHERE ur.user_id = ? AND p.code = ?
       AND (ur.expires_at IS NULL OR datetime(ur.expires_at) > datetime('now'))`,
      userId, permissionCode
    );
    
    return !!rolePerm;
  }

  /**
   * 检查用户是否拥有任一权限
   * @param {number} userId - 用户ID
   * @param {string[]} permissionCodes - 权限码数组
   * @returns {Promise<boolean>}
   */
  async hasAnyPermission(userId, permissionCodes) {
    for (const code of permissionCodes) {
      if (await this.hasPermission(userId, code)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 检查用户是否拥有所有权限
   * @param {number} userId - 用户ID
   * @param {string[]} permissionCodes - 权限码数组
   * @returns {Promise<boolean>}
   */
  async hasAllPermissions(userId, permissionCodes) {
    for (const code of permissionCodes) {
      if (!(await this.hasPermission(userId, code))) {
        return false;
      }
    }
    return true;
  }

  /**
   * 获取用户在某个服务的所有权限
   * @param {number} userId - 用户ID
   * @param {string} serviceId - 服务ID
   * @returns {Promise<Array>}
   */
  async getUserServicePermissions(userId, serviceId) {
    const permissions = await this.db.all(
      `SELECT DISTINCT p.id, p.code, p.name, p.description, p.action, p.resource_type
       FROM permissions p
       WHERE p.service_id = ? AND (
         -- 通过角色获得
         EXISTS (
           SELECT 1 FROM user_roles ur
           JOIN role_permissions rp ON ur.role_id = rp.role_id
           WHERE ur.user_id = ? AND rp.permission_id = p.id
           AND (ur.expires_at IS NULL OR datetime(ur.expires_at) > datetime('now'))
         )
         -- 或直接授权（且为允许）
         OR EXISTS (
           SELECT 1 FROM user_permissions up
           WHERE up.user_id = ? AND up.permission_id = p.id
           AND up.effect = 'allow'
           AND (up.expires_at IS NULL OR datetime(up.expires_at) > datetime('now'))
         )
       )
       -- 排除直接拒绝的权限
       AND NOT EXISTS (
         SELECT 1 FROM user_permissions up2
         WHERE up2.user_id = ? AND up2.permission_id = p.id
         AND up2.effect = 'deny'
         AND (up2.expires_at IS NULL OR datetime(up2.expires_at) > datetime('now'))
       )
       ORDER BY p.resource_type, p.action`,
      serviceId, userId, userId, userId
    );
    
    return permissions;
  }

  /**
   * 获取用户在某个服务的所有角色
   * @param {number} userId - 用户ID
   * @param {string} serviceId - 服务ID
   * @returns {Promise<Array>}
   */
  async getUserServiceRoles(userId, serviceId) {
    const roles = await this.db.all(
      `SELECT r.id, r.code, r.name, r.description, ur.granted_at, ur.expires_at
       FROM user_roles ur
       JOIN roles r ON ur.role_id = r.id
       WHERE ur.user_id = ? AND r.service_id = ?
       AND (ur.expires_at IS NULL OR datetime(ur.expires_at) > datetime('now'))
       ORDER BY r.name`,
      userId, serviceId
    );
    
    return roles;
  }

  /**
   * 获取用户有权访问的所有服务
   * @param {number} userId - 用户ID
   * @returns {Promise<Array>}
   */
  async getUserServices(userId) {
    const services = await this.db.all(
      `SELECT DISTINCT s.*
       FROM portal_services s
       WHERE s.enabled = 1 AND EXISTS (
         SELECT 1 FROM user_roles ur
         JOIN roles r ON ur.role_id = r.id
         WHERE ur.user_id = ? AND r.service_id = s.id
         AND (ur.expires_at IS NULL OR datetime(ur.expires_at) > datetime('now'))
       )
       ORDER BY s.sort_order, s.name`,
      userId
    );
    
    return services;
  }

  // ============================================
  // 角色与权限管理
  // ============================================

  /**
   * 授予用户角色
   * @param {number} userId - 用户ID
   * @param {number} roleId - 角色ID
   * @param {number} operatorId - 操作人ID
   * @param {string} expiresAt - 过期时间（可选）
   * @param {string} reason - 原因说明（可选）
   */
  async grantRole(userId, roleId, operatorId, expiresAt = null, reason = null) {
    const now = new Date().toISOString();
    
    await this.db.run('BEGIN');
    try {
      // 授予角色
      await this.db.run(
        `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, role_id) DO UPDATE SET
           granted_by = excluded.granted_by,
           granted_at = excluded.granted_at,
           expires_at = excluded.expires_at`,
        userId, roleId, operatorId, now, expiresAt
      );
      
      // 记录审计日志
      await this.db.run(
        `INSERT INTO permission_audit_logs 
         (user_id, operator_id, operation, role_id, reason, created_at)
         VALUES (?, ?, 'grant_role', ?, ?, ?)`,
        userId, operatorId, roleId, reason, now
      );
      
      await this.db.run('COMMIT');
    } catch (err) {
      await this.db.run('ROLLBACK');
      throw err;
    }
  }

  /**
   * 撤销用户角色
   * @param {number} userId - 用户ID
   * @param {number} roleId - 角色ID
   * @param {number} operatorId - 操作人ID
   * @param {string} reason - 原因说明（可选）
   */
  async revokeRole(userId, roleId, operatorId, reason = null) {
    const now = new Date().toISOString();
    
    await this.db.run('BEGIN');
    try {
      // 撤销角色
      await this.db.run(
        'DELETE FROM user_roles WHERE user_id = ? AND role_id = ?',
        userId, roleId
      );
      
      // 记录审计日志
      await this.db.run(
        `INSERT INTO permission_audit_logs 
         (user_id, operator_id, operation, role_id, reason, created_at)
         VALUES (?, ?, 'revoke_role', ?, ?, ?)`,
        userId, operatorId, roleId, reason, now
      );
      
      await this.db.run('COMMIT');
    } catch (err) {
      await this.db.run('ROLLBACK');
      throw err;
    }
  }

  /**
   * 直接授予用户权限（用于特殊场景）
   * @param {number} userId - 用户ID
   * @param {number} permissionId - 权限ID
   * @param {number} operatorId - 操作人ID
   * @param {string} effect - 'allow' 或 'deny'
   * @param {string} expiresAt - 过期时间（可选）
   * @param {string} reason - 原因说明（必填）
   */
  async grantDirectPermission(userId, permissionId, operatorId, effect = 'allow', expiresAt = null, reason = null) {
    if (!reason) {
      throw new Error('Direct permission grant requires a reason');
    }
    
    const now = new Date().toISOString();
    
    await this.db.run('BEGIN');
    try {
      // 授予权限
      await this.db.run(
        `INSERT INTO user_permissions 
         (user_id, permission_id, effect, granted_by, granted_at, expires_at, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, permission_id) DO UPDATE SET
           effect = excluded.effect,
           granted_by = excluded.granted_by,
           granted_at = excluded.granted_at,
           expires_at = excluded.expires_at,
           reason = excluded.reason`,
        userId, permissionId, effect, operatorId, now, expiresAt, reason
      );
      
      // 记录审计日志
      await this.db.run(
        `INSERT INTO permission_audit_logs 
         (user_id, operator_id, operation, permission_id, effect, reason, created_at)
         VALUES (?, ?, 'grant_permission', ?, ?, ?, ?)`,
        userId, operatorId, permissionId, effect, reason, now
      );
      
      await this.db.run('COMMIT');
    } catch (err) {
      await this.db.run('ROLLBACK');
      throw err;
    }
  }

  /**
   * 撤销用户直接权限
   * @param {number} userId - 用户ID
   * @param {number} permissionId - 权限ID
   * @param {number} operatorId - 操作人ID
   * @param {string} reason - 原因说明（可选）
   */
  async revokeDirectPermission(userId, permissionId, operatorId, reason = null) {
    const now = new Date().toISOString();
    
    await this.db.run('BEGIN');
    try {
      // 撤销权限
      await this.db.run(
        'DELETE FROM user_permissions WHERE user_id = ? AND permission_id = ?',
        userId, permissionId
      );
      
      // 记录审计日志
      await this.db.run(
        `INSERT INTO permission_audit_logs 
         (user_id, operator_id, operation, permission_id, reason, created_at)
         VALUES (?, ?, 'revoke_permission', ?, ?, ?)`,
        userId, operatorId, permissionId, reason, now
      );
      
      await this.db.run('COMMIT');
    } catch (err) {
      await this.db.run('ROLLBACK');
      throw err;
    }
  }

  // ============================================
  // 审计日志
  // ============================================

  /**
   * 记录服务访问日志
   * @param {number} userId - 用户ID
   * @param {string} serviceId - 服务ID
   * @param {string} action - 操作类型
   * @param {string} result - 'success' 或 'denied'
   * @param {Object} options - 额外选项
   */
  async logAccess(userId, serviceId, action, result, options = {}) {
    const now = new Date().toISOString();
    
    await this.db.run(
      `INSERT INTO service_access_logs 
       (user_id, service_id, permission_code, action, resource_type, resource_id, 
        result, ip_address, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      userId, serviceId, options.permissionCode || null, action,
      options.resourceType || null, options.resourceId || null,
      result, options.ipAddress || null, options.userAgent || null, now
    );
  }

  /**
   * 获取用户权限变更历史
   * @param {number} userId - 用户ID
   * @param {number} limit - 返回条数限制
   * @returns {Promise<Array>}
   */
  async getUserPermissionHistory(userId, limit = 50) {
    const history = await this.db.all(
      `SELECT 
         pal.*,
         operator.name as operator_name,
         r.name as role_name,
         p.name as permission_name
       FROM permission_audit_logs pal
       LEFT JOIN users operator ON pal.operator_id = operator.id
       LEFT JOIN roles r ON pal.role_id = r.id
       LEFT JOIN permissions p ON pal.permission_id = p.id
       WHERE pal.user_id = ?
       ORDER BY pal.created_at DESC
       LIMIT ?`,
      userId, limit
    );
    
    return history;
  }

  // ============================================
  // 辅助方法
  // ============================================

  /**
   * 获取所有服务列表
   * @param {boolean} enabledOnly - 仅返回启用的服务
   * @returns {Promise<Array>}
   */
  async getAllServices(enabledOnly = true) {
    const where = enabledOnly ? 'WHERE enabled = 1' : '';
    return await this.db.all(
      `SELECT * FROM portal_services ${where} ORDER BY sort_order, name`
    );
  }

  /**
   * 获取服务的所有角色
   * @param {string} serviceId - 服务ID
   * @returns {Promise<Array>}
   */
  async getServiceRoles(serviceId) {
    return await this.db.all(
      'SELECT * FROM roles WHERE service_id = ? ORDER BY name',
      serviceId
    );
  }

  /**
   * 获取服务的所有权限
   * @param {string} serviceId - 服务ID
   * @returns {Promise<Array>}
   */
  async getServicePermissions(serviceId) {
    return await this.db.all(
      'SELECT * FROM permissions WHERE service_id = ? ORDER BY resource_type, action',
      serviceId
    );
  }

  /**
   * 根据权限码获取权限ID
   * @param {string} permissionCode - 权限码
   * @returns {Promise<number|null>}
   */
  async getPermissionIdByCode(permissionCode) {
    const perm = await this.db.get(
      'SELECT id FROM permissions WHERE code = ?',
      permissionCode
    );
    return perm ? perm.id : null;
  }

  /**
   * 根据角色码获取角色ID
   * @param {string} roleCode - 角色码
   * @returns {Promise<number|null>}
   */
  async getRoleIdByCode(roleCode) {
    const role = await this.db.get(
      'SELECT id FROM roles WHERE code = ?',
      roleCode
    );
    return role ? role.id : null;
  }
}

module.exports = { RBACManager };
