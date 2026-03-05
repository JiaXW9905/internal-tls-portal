/**
 * RBAC Middleware
 * 
 * Express中间件，用于在路由中检查用户权限
 */

/**
 * 创建权限检查中间件
 * @param {RBACManager} rbacManager - RBAC管理器实例
 * @returns {Object} 中间件函数集合
 */
function createRBACMiddleware(rbacManager) {
  /**
   * 要求用户拥有指定权限
   * @param {string|string[]} permissionCodes - 权限码或权限码数组
   * @param {string} mode - 'any'(任一权限) 或 'all'(所有权限)，默认'any'
   */
  function requirePermission(permissionCodes, mode = 'any') {
    const codes = Array.isArray(permissionCodes) ? permissionCodes : [permissionCodes];
    
    return async (req, res, next) => {
      if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      const userId = req.session.user.id;
      let hasAccess = false;
      
      try {
        if (mode === 'all') {
          hasAccess = await rbacManager.hasAllPermissions(userId, codes);
        } else {
          hasAccess = await rbacManager.hasAnyPermission(userId, codes);
        }
        
        if (hasAccess) {
          // 记录成功访问日志（可选，用于审计）
          const permCode = codes[0]; // 记录第一个权限码
          const [serviceId] = permCode.split(':');
          
          await rbacManager.logAccess(
            userId,
            serviceId,
            req.method + ' ' + req.path,
            'success',
            {
              permissionCode: permCode,
              ipAddress: req.ip,
              userAgent: req.get('user-agent')
            }
          ).catch(err => {
            console.error('[RBAC] Failed to log access:', err);
          });
          
          return next();
        }
        
        // 记录拒绝访问日志
        const permCode = codes[0];
        const [serviceId] = permCode.split(':');
        
        await rbacManager.logAccess(
          userId,
          serviceId,
          req.method + ' ' + req.path,
          'denied',
          {
            permissionCode: permCode,
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
          }
        ).catch(err => {
          console.error('[RBAC] Failed to log denied access:', err);
        });
        
        return res.status(403).json({ 
          error: 'Forbidden',
          message: '您没有执行此操作的权限'
        });
      } catch (err) {
        console.error('[RBAC] Permission check error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
    };
  }

  /**
   * 要求用户拥有指定服务的任一角色
   * @param {string} serviceId - 服务ID
   * @param {string[]} roleCodes - 角色码数组（可选）
   */
  function requireServiceAccess(serviceId, roleCodes = null) {
    return async (req, res, next) => {
      if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      const userId = req.session.user.id;
      
      try {
        const userRoles = await rbacManager.getUserServiceRoles(userId, serviceId);
        
        if (userRoles.length === 0) {
          return res.status(403).json({ 
            error: 'Forbidden',
            message: '您没有访问此服务的权限'
          });
        }
        
        // 如果指定了角色要求，检查用户是否拥有这些角色之一
        if (roleCodes && roleCodes.length > 0) {
          const userRoleCodes = userRoles.map(r => r.code);
          const hasRequiredRole = roleCodes.some(code => userRoleCodes.includes(code));
          
          if (!hasRequiredRole) {
            return res.status(403).json({ 
              error: 'Forbidden',
              message: '您的角色权限不足'
            });
          }
        }
        
        return next();
      } catch (err) {
        console.error('[RBAC] Service access check error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
    };
  }

  /**
   * 向后兼容：根据旧的角色系统检查权限
   * @param {string[]} allowedRoles - 允许的角色列表
   */
  function requireRole(allowedRoles) {
    return async (req, res, next) => {
      if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      // 优先使用旧的role字段（向后兼容）
      const legacyRole = req.session.user.role;
      if (legacyRole && allowedRoles.includes(legacyRole)) {
        return next();
      }
      
      // 检查RBAC角色
      const userId = req.session.user.id;
      try {
        const tlsRoles = await rbacManager.getUserServiceRoles(userId, 'tls-cert');
        const roleMapping = {
          'tls-admin': 'admin',
          'tls-dev': 'dev',
          'tls-service': 'service',
          'tls-product': 'product'
        };
        
        for (const role of tlsRoles) {
          const mappedRole = roleMapping[role.code];
          if (mappedRole && allowedRoles.includes(mappedRole)) {
            return next();
          }
        }
        
        return res.status(403).json({ error: 'Forbidden' });
      } catch (err) {
        console.error('[RBAC] Role check error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
    };
  }

  /**
   * 向后兼容：要求管理员权限
   */
  function requireAdmin(req, res, next) {
    return requireRole(['admin'])(req, res, next);
  }

  /**
   * 将用户权限信息注入到请求对象
   */
  function attachUserPermissions(serviceId) {
    return async (req, res, next) => {
      if (!req.session || !req.session.user) {
        return next();
      }
      
      const userId = req.session.user.id;
      
      try {
        const permissions = await rbacManager.getUserServicePermissions(userId, serviceId);
        const roles = await rbacManager.getUserServiceRoles(userId, serviceId);
        
        req.userPermissions = {
          permissions: permissions.map(p => p.code),
          permissionsDetail: permissions,
          roles: roles.map(r => r.code),
          rolesDetail: roles
        };
        
        return next();
      } catch (err) {
        console.error('[RBAC] Failed to attach user permissions:', err);
        return next();
      }
    };
  }

  /**
   * 权限调试中间件（仅开发环境）
   */
  function debugPermissions(req, res, next) {
    if (process.env.NODE_ENV === 'production') {
      return next();
    }
    
    if (req.userPermissions) {
      console.log('[RBAC Debug] User:', req.session.user.email);
      console.log('[RBAC Debug] Roles:', req.userPermissions.roles);
      console.log('[RBAC Debug] Permissions:', req.userPermissions.permissions);
    }
    
    return next();
  }

  return {
    requirePermission,
    requireServiceAccess,
    requireRole,
    requireAdmin,
    attachUserPermissions,
    debugPermissions
  };
}

module.exports = { createRBACMiddleware };
