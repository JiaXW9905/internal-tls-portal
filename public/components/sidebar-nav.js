/**
 * 通用侧边栏导航组件
 * 支持分层级、可展开/折叠的菜单结构
 */

// 侧边栏菜单配置
const SIDEBAR_CONFIG = {
  brand: {
    title: '产业互联网内部门户',
    subtitle: 'Internal Portal'
  },
  items: [
    {
      id: 'portal-home',
      label: '首页',
      icon: '🏠',
      href: '/portal',
      type: 'link'
    },
    {
      id: 'tls-service',
      label: 'TLS证书管理',
      icon: '🔐',
      type: 'group',
      expanded: true,
      items: [
        { label: '证书申请', href: '/', icon: '📝' },
        { label: '证书签发', href: '/admin', icon: '✅', roles: ['admin', 'dev'] },
        { label: '证书总览', href: '/overview', icon: '📊', roles: ['admin', 'dev', 'product'] },
        { label: '用户与权限', href: '/users', icon: '👥', roles: ['admin'] },
        { label: '系统设置', href: '/settings', icon: '⚙️', roles: ['admin'] }
      ]
    },
    {
      id: 'rtc-deployment',
      label: 'RTC部署管理',
      icon: '🚀',
      type: 'group',
      expanded: false,
      items: [
        { label: '项目列表', href: '/rtc-deployment/' },
        { label: '创建项目', href: '/rtc-deployment/create' },
        { label: '资源计算器', href: '/rtc-deployment/calculator' }
      ]
    }
  ]
};

/**
 * 渲染侧边栏导航
 * @param {string} containerId - 容器ID
 * @param {string} currentPath - 当前页面路径
 * @param {object} userInfo - 用户信息（包含角色）
 */
function renderSidebarNav(containerId = 'sidebar-nav', currentPath = window.location.pathname, userInfo = null) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`Sidebar container #${containerId} not found`);
    return;
  }

  const userRole = userInfo?.role || 'service';
  
  let html = '';
  
  SIDEBAR_CONFIG.items.forEach(item => {
    if (item.type === 'link') {
      // 简单链接
      const isActive = currentPath === item.href ? 'active' : '';
      html += `
        <a href="${item.href}" class="nav-item ${isActive}">
          <span class="nav-icon">${item.icon}</span>
          <span class="nav-label">${item.label}</span>
        </a>
      `;
    } else if (item.type === 'group') {
      // 分组菜单
      const isExpanded = item.expanded || false;
      const expandedClass = isExpanded ? 'expanded' : '';
      
      html += `
        <div class="nav-group ${expandedClass}" data-group-id="${item.id}">
          <div class="nav-group-header" onclick="toggleNavGroup('${item.id}')">
            <span class="nav-icon">${item.icon}</span>
            <span class="nav-label">${item.label}</span>
            <span class="nav-arrow">▼</span>
          </div>
          <div class="nav-group-items">
      `;
      
      // 渲染子菜单
      item.items.forEach(subItem => {
        // 检查权限
        if (subItem.roles && !subItem.roles.includes(userRole)) {
          return; // 没有权限，跳过
        }
        
        const isActive = currentPath === subItem.href ? 'active' : '';
        html += `
          <a href="${subItem.href}" class="nav-subitem ${isActive}">
            <span class="nav-label">${subItem.label}</span>
          </a>
        `;
      });
      
      html += `
          </div>
        </div>
      `;
    }
  });
  
  container.innerHTML = html;
}

/**
 * 切换导航组的展开/折叠状态
 * @param {string} groupId - 分组ID
 */
function toggleNavGroup(groupId) {
  const group = document.querySelector(`[data-group-id="${groupId}"]`);
  if (!group) return;
  
  const isExpanded = group.classList.contains('expanded');
  
  if (isExpanded) {
    group.classList.remove('expanded');
    // 保存折叠状态到localStorage
    localStorage.setItem(`nav-group-${groupId}`, 'collapsed');
  } else {
    group.classList.add('expanded');
    // 保存展开状态到localStorage
    localStorage.setItem(`nav-group-${groupId}`, 'expanded');
  }
}

/**
 * 从localStorage恢复导航组的展开/折叠状态
 */
function restoreNavGroupStates() {
  SIDEBAR_CONFIG.items.forEach(item => {
    if (item.type === 'group') {
      const savedState = localStorage.getItem(`nav-group-${item.id}`);
      if (savedState) {
        item.expanded = savedState === 'expanded';
      }
    }
  });
}

// 页面加载时恢复状态
if (typeof window !== 'undefined') {
  restoreNavGroupStates();
}

// 导出函数供全局使用
window.renderSidebarNav = renderSidebarNav;
window.toggleNavGroup = toggleNavGroup;
window.SIDEBAR_CONFIG = SIDEBAR_CONFIG;
