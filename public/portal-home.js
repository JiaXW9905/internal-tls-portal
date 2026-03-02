/**
 * Portal Home Page JavaScript
 * 门户首页逻辑
 */

let currentUser = null;

// 服务图标映射
const serviceIcons = {
  'tls-cert': '🔐',
  'asset-mgmt': '📦',
  'monitor': '📊',
  'default': '⚙️'
};

// 初始化
async function init() {
  await loadCurrentUser();
  
  // 渲染侧边栏导航
  if (typeof renderSidebarNav === 'function') {
    renderSidebarNav('sidebar-nav', window.location.pathname, currentUser);
  }
  
  await loadUserServices();
  setupEventListeners();
}

// 加载当前用户信息
async function loadCurrentUser() {
  try {
    const response = await fetch('/api/me');
    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      throw new Error('Failed to load user');
    }
    
    currentUser = await response.json();
    
    // 显示用户名
    document.getElementById('user-name').textContent = currentUser.name || currentUser.email;
    document.getElementById('user-menu-btn').textContent = currentUser.name || currentUser.email;
  } catch (err) {
    console.error('Failed to load user:', err);
    showError('加载用户信息失败');
  }
}

// 加载用户可访问的服务
async function loadUserServices() {
  try {
    const response = await fetch('/api/portal/services');
    if (!response.ok) {
      throw new Error('Failed to load services');
    }
    
    const services = await response.json();
    
    if (services.length === 0) {
      renderNoServices();
      return;
    }
    
    renderServices(services);
    renderServiceNav(services);
  } catch (err) {
    console.error('Failed to load services:', err);
    renderError();
  }
}

// 渲染服务卡片
function renderServices(services) {
  const grid = document.getElementById('service-grid');
  grid.innerHTML = '';
  
  services.forEach(service => {
    const card = createServiceCard(service);
    grid.appendChild(card);
  });
  
  // 添加"更多服务"占位卡片
  const placeholder = createPlaceholderCard();
  grid.appendChild(placeholder);
}

// 创建服务卡片
function createServiceCard(service) {
  const card = document.createElement('div');
  card.className = 'service-card';
  card.dataset.serviceId = service.id;
  
  const icon = serviceIcons[service.id] || serviceIcons.default;
  
  card.innerHTML = `
    <div class="service-badge">已启用</div>
    <div class="service-icon">${icon}</div>
    <h3>${service.name}</h3>
    <p>${service.description || service.name_en || ''}</p>
    <a href="${service.base_path}" class="service-link">
      进入服务 →
    </a>
  `;
  
  card.addEventListener('click', (e) => {
    if (e.target.tagName !== 'A') {
      window.location.href = service.base_path;
    }
  });
  
  return card;
}

// 创建占位卡片
function createPlaceholderCard() {
  const card = document.createElement('div');
  card.className = 'service-card placeholder';
  
  card.innerHTML = `
    <div class="service-badge coming-soon">即将推出</div>
    <div class="service-icon">➕</div>
    <h3>更多服务</h3>
    <p>更多企业服务正在陆续接入中，敬请期待...</p>
  `;
  
  return card;
}

// 渲染侧边栏服务导航（已废弃，由sidebar-nav.js统一处理）
function renderServiceNav(services) {
  // 不再需要，导航由sidebar-nav.js统一管理
}

// 渲染无服务状态
function renderNoServices() {
  const grid = document.getElementById('service-grid');
  grid.innerHTML = `
    <div style="text-align: center; padding: 60px; grid-column: 1 / -1;">
      <div style="font-size: 4rem; margin-bottom: 20px;">🚫</div>
      <h3 style="color: #666; margin-bottom: 10px;">暂无可用服务</h3>
      <p style="color: #999;">请联系管理员为您分配服务访问权限</p>
    </div>
  `;
}

// 渲染错误状态
function renderError() {
  const grid = document.getElementById('service-grid');
  grid.innerHTML = `
    <div style="text-align: center; padding: 60px; grid-column: 1 / -1;">
      <div style="font-size: 4rem; margin-bottom: 20px;">⚠️</div>
      <h3 style="color: #666; margin-bottom: 10px;">加载失败</h3>
      <p style="color: #999;">无法加载服务列表，请刷新页面重试</p>
      <button onclick="location.reload()" style="margin-top: 20px; padding: 10px 24px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer;">
        刷新页面
      </button>
    </div>
  `;
}

// 设置事件监听
function setupEventListeners() {
  // 用户菜单
  const menuBtn = document.getElementById('user-menu-btn');
  const menuDropdown = document.getElementById('user-menu-dropdown');
  
  if (menuBtn) {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menuDropdown.classList.toggle('show');
    });
  }
  
  // 点击外部关闭菜单
  document.addEventListener('click', () => {
    menuDropdown.classList.remove('show');
  });
  
  // 登出
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login';
      } catch (err) {
        console.error('Logout failed:', err);
      }
    });
  }
}

// 显示错误消息
function showError(message) {
  alert(message); // 简单实现，后续可改为更好的UI
}

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', init);
