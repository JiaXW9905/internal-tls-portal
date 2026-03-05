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

  document.getElementById('network_security_template')?.addEventListener('change', onTemplateChange);

  // 网络安全 checkbox 联动显示/隐藏描述输入
  ['air_gap', 'proxy', 'firewall'].forEach(key => {
    const cb = document.getElementById(`has_${key}`);
    const inputId = key === 'proxy' ? 'proxy_address'
      : key === 'air_gap' ? 'air_gap_description' : 'firewall_description';
    const input = document.getElementById(inputId);
    if (cb && input) {
      cb.addEventListener('change', () => {
        input.style.display = cb.checked ? '' : 'none';
        if (!cb.checked) input.value = '';
      });
    }
  });
}

function onTemplateChange(e) {
  const template = e.target.value;
  if (!template) return;

  const hasAirGap = document.getElementById('has_air_gap');
  const hasProxy = document.getElementById('has_proxy');
  const hasFirewall = document.getElementById('has_firewall');
  const airGapDesc = document.getElementById('air_gap_description');
  const proxyAddr = document.getElementById('proxy_address');
  const firewallDesc = document.getElementById('firewall_description');

  const setField = (cb, input, checked, value) => {
    if (cb) cb.checked = checked;
    if (input) {
      input.style.display = checked ? '' : 'none';
      input.value = checked ? value : '';
    }
  };

  if (template === 'strict_intranet') {
    setField(hasAirGap, airGapDesc, true, '业务区与DMZ间部署网闸，仅开放必要单向链路，变更需安全审批');
    setField(hasProxy, proxyAddr, false, '');
    setField(hasFirewall, firewallDesc, true, '默认拒绝，仅放通控制面TCP 443与媒体面UDP端口段（按白名单审批）');
  } else if (template === 'proxy_outbound') {
    setField(hasAirGap, airGapDesc, false, '');
    setField(hasProxy, proxyAddr, true, 'http://proxy.company.local:8080');
    setField(hasFirewall, firewallDesc, true, '应用区到RTC区放通必要端口，RTC区出网必须经代理');
  } else if (template === 'dmz_bridge') {
    setField(hasAirGap, airGapDesc, true, '内网业务区通过DMZ中转区与外部通信，网闸部署在业务区边界');
    setField(hasProxy, proxyAddr, true, 'http://dmz-proxy.company.local:8080');
    setField(hasFirewall, firewallDesc, true, '业务区<->DMZ<->RTC区分段放通，严格按源目地址与端口审批');
  }
}

async function handleSubmit(e) {
  e.preventDefault();
  const msgEl = document.getElementById('form-message');
  msgEl.textContent = '创建中...';
  msgEl.className = 'muted';

  const formData = new FormData(e.target);
  const data = Object.fromEntries(formData.entries());
  data.has_video = data.has_video === '1';

  // 组装 network_security JSON
  const networkSecurity = {};
  if (data.has_air_gap === '1') {
    networkSecurity.has_air_gap = true;
    networkSecurity.air_gap_description = data.air_gap_description || '';
  }
  if (data.has_proxy === '1') {
    networkSecurity.has_proxy = true;
    networkSecurity.proxy_address = data.proxy_address || '';
  }
  if (data.has_firewall === '1') {
    networkSecurity.has_firewall = true;
    networkSecurity.firewall_description = data.firewall_description || '';
  }
  if (Object.keys(networkSecurity).length > 0) {
    data.network_security = JSON.stringify(networkSecurity);
  }
  // 清理不需要直接发送的字段
  delete data.has_air_gap;
  delete data.air_gap_description;
  delete data.has_proxy;
  delete data.proxy_address;
  delete data.has_firewall;
  delete data.firewall_description;
  delete data.network_security_template;

  try {
    const res = await fetch('/api/rtc-deployment/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error || '创建失败');

    msgEl.textContent = '✅ 项目创建成功！正在跳转到方案生成页并自动计算资源...';
    msgEl.className = 'success';

    // 直接跳转到方案生成页，触发自动计算+自动生成
    setTimeout(() => {
      window.location.href = `/rtc-deployment/architect?project_id=${result.id}&auto=1`;
    }, 1000);
  } catch (err) {
    msgEl.textContent = '❌ ' + err.message;
    msgEl.className = 'error';
  }
}

document.addEventListener('DOMContentLoaded', init);
