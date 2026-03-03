let currentUser = null;

const STATUS_LABELS = {
  draft: '草稿',
  calculating: '资源评估中',
  designing: 'AI设计中',
  configured: '已配置',
  deployed: '已部署'
};

const STATUS_CLASSES = {
  draft: 'pending',
  calculating: 'pending',
  designing: 'pending',
  configured: 'issued',
  deployed: 'issued'
};

const DEPLOYMENT_LABELS = {
  pure: '纯私有',
  hybrid: '混合云'
};

async function init() {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/login'; return; }
  currentUser = await res.json();
  document.getElementById('user-menu-btn').textContent = currentUser.name || currentUser.email;

  if (typeof renderSidebarNav === 'function') {
    renderSidebarNav('sidebar-nav', window.location.pathname, currentUser);
  }

  setupEventListeners();
  loadProjects();
}

function setupEventListeners() {
  document.getElementById('user-menu-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('user-menu-dropdown').classList.toggle('show');
  });
  document.addEventListener('click', () => {
    document.getElementById('user-menu-dropdown')?.classList.remove('show');
  });
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  });
}

async function loadProjects() {
  const msgEl = document.getElementById('projects-message');
  try {
    const res = await fetch('/api/rtc-deployment/projects');
    if (!res.ok) throw new Error('加载失败');
    const projects = await res.json();

    if (projects.length === 0) {
      msgEl.textContent = '暂无部署项目。点击右上角"创建部署项目"开始。';
      return;
    }

    msgEl.style.display = 'none';
    const table = document.getElementById('projects-table');
    const tbody = document.getElementById('projects-tbody');
    table.style.display = '';

    tbody.innerHTML = projects.map(p => `
      <tr>
        <td>${p.project_name}</td>
        <td>${p.customer_name}</td>
        <td>${DEPLOYMENT_LABELS[p.deployment_type] || p.deployment_type}</td>
        <td>${p.concurrent_users.toLocaleString()}</td>
        <td>${p.channels.toLocaleString()}</td>
        <td><span class="status ${STATUS_CLASSES[p.status] || 'pending'}">${STATUS_LABELS[p.status] || p.status}</span></td>
        <td>${new Date(p.created_at).toLocaleDateString('zh-CN')}</td>
        <td>
          <a href="/rtc-deployment/calculator?project_id=${p.id}" class="link-btn">计算器</a>
          <a href="/rtc-deployment/architect?project_id=${p.id}" class="link-btn">AI架构</a>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    msgEl.textContent = '加载失败: ' + err.message;
    msgEl.className = 'error';
  }
}

document.addEventListener('DOMContentLoaded', init);
