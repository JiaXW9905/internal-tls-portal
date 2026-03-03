let currentUser = null;

async function init() {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/login'; return; }
  currentUser = await res.json();
  document.getElementById('user-menu-btn').textContent = currentUser.name || currentUser.email;

  if (typeof renderSidebarNav === 'function') {
    renderSidebarNav('sidebar-nav', window.location.pathname, currentUser);
  }

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

  document.getElementById('create-form').addEventListener('submit', handleSubmit);
}

async function handleSubmit(e) {
  e.preventDefault();
  const msgEl = document.getElementById('form-message');
  msgEl.textContent = '创建中...';
  msgEl.className = 'muted';

  const formData = new FormData(e.target);
  const data = Object.fromEntries(formData.entries());
  data.has_video = data.has_video === '1';

  try {
    const res = await fetch('/api/rtc-deployment/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error || '创建失败');

    msgEl.textContent = '✅ 项目创建成功！正在跳转到资源计算器...';
    msgEl.className = 'success';

    // 跳转到计算器
    setTimeout(() => {
      window.location.href = `/rtc-deployment/calculator?project_id=${result.id}`;
    }, 1000);
  } catch (err) {
    msgEl.textContent = '❌ ' + err.message;
    msgEl.className = 'error';
  }
}

document.addEventListener('DOMContentLoaded', init);
