let currentUser = null;
let currentProjectId = null;
let layoutAutosaveTimer = null;
let lastLayoutPayload = '';
let autoSaveEnabled = true;
let topologyTools = null;
let selectedComponentId = null;
let canvasZoom = 1;
let isCanvasFullscreen = false;
const MAX_UNDO_STEPS = 10;
const undoStack = [];
let autoPipelineStarted = false;

async function init() {
  autoSaveEnabled = loadAutoSavePreference();
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/login'; return; }
  currentUser = await res.json();
  document.getElementById('user-menu-btn').textContent = currentUser.name || currentUser.email;

  if (typeof renderSidebarNav === 'function') {
    renderSidebarNav('sidebar-nav', window.location.pathname, currentUser);
  }

  setupUserMenu();
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  document.addEventListener('keydown', handleUndoHotkey);
  window.addEventListener('resize', handleViewportResize);
  currentProjectId = getProjectId();
  await loadProjectInfo();
  document.getElementById('generate-btn')?.addEventListener('click', generateArchitecture);
  if (shouldAutoBootstrap()) {
    await autoBootstrapFromProject();
  }
}

function setupUserMenu() {
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

function getProjectId() {
  return new URLSearchParams(window.location.search).get('project_id');
}

function shouldAutoBootstrap() {
  const auto = new URLSearchParams(window.location.search).get('auto');
  return auto === '1' || auto === 'true';
}

async function loadProjectInfo() {
  const el = document.getElementById('project-info');
  if (!currentProjectId) {
    el.textContent = '缺少项目ID，请从项目列表进入本页面。';
    el.className = 'error';
    return;
  }
  try {
    const res = await fetch(`/api/rtc-deployment/projects/${currentProjectId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '加载失败');
    const p = data.project || {};
    let netSecHtml = '';
    if (p.network_security) {
      try {
        const ns = JSON.parse(p.network_security);
        const parts = [];
        if (ns.has_air_gap) parts.push(`网闸隔离${ns.air_gap_description ? '（' + esc(ns.air_gap_description) + '）' : ''}`);
        if (ns.has_proxy) parts.push(`代理${ns.proxy_address ? '（' + esc(ns.proxy_address) + '）' : ''}`);
        if (ns.has_firewall) parts.push(`防火墙${ns.firewall_description ? '（' + esc(ns.firewall_description) + '）' : ''}`);
        if (parts.length) netSecHtml = `<div><strong>网络安全：</strong>${parts.join(' / ')}</div>`;
      } catch (_) {}
    }
    el.className = '';
    el.innerHTML = `
      <div><strong>项目名称：</strong>${esc(p.project_name || '-')}</div>
      <div><strong>客户名称：</strong>${esc(p.customer_name || '-')}</div>
      <div><strong>并发用户：</strong>${p.concurrent_users || '-'} / 频道数：${p.channels || '-'}</div>
      <div><strong>AppID：</strong>${esc(p.appid || p.app_id || '-')} / <strong>AppCert：</strong>${(p.app_cert || p.appCert) ? '已配置' : '-'}</div>
      ${netSecHtml}
    `;
  } catch (err) {
    el.textContent = '加载失败: ' + err.message;
    el.className = 'error';
  }
}

async function generateArchitecture() {
  const msgEl = document.getElementById('generate-message');
  const resultEl = document.getElementById('architecture-result');
  const topoSection = document.getElementById('section-topology');
  if (!currentProjectId) { msgEl.textContent = '缺少项目ID'; msgEl.className = 'error'; return; }

  msgEl.textContent = 'AI正在生成架构方案，请稍候（约15-30秒）...';
  msgEl.className = 'muted';
  resultEl.style.display = 'none';
  if (topoSection) {
    topoSection.innerHTML = '<h2>网络拓扑</h2><div class="empty-state">AI正在生成/绘制拓扑，请稍候...</div>';
  }
  setTopologyLoading(true, 'AI正在生成/绘制拓扑，请稍候...');

  try {
    const res = await fetch(`/api/rtc-deployment/projects/${currentProjectId}/ai-generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '生成失败');

    msgEl.textContent = `生成成功，耗时 ${data.duration || '-'} 秒`;
    msgEl.className = 'success';
    undoStack.length = 0;
    renderArchitecture(data.architecture);
    resultEl.style.display = '';
  } catch (err) {
    msgEl.textContent = '生成失败: ' + err.message;
    msgEl.className = 'error';
  } finally {
    setTopologyLoading(false);
  }
}

async function autoBootstrapFromProject() {
  if (autoPipelineStarted || !currentProjectId) return;
  autoPipelineStarted = true;
  const msgEl = document.getElementById('generate-message');
  try {
    msgEl.textContent = '正在自动计算资源，请稍候...';
    msgEl.className = 'muted';
    const calcRes = await fetch(`/api/rtc-deployment/projects/${currentProjectId}/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const calcData = await calcRes.json().catch(() => ({}));
    if (!calcRes.ok) {
      throw new Error(calcData.error || '资源计算失败');
    }

    msgEl.textContent = '资源计算完成，正在自动生成AI架构...';
    msgEl.className = 'muted';
    await generateArchitecture();
  } catch (err) {
    msgEl.textContent = `自动流程失败：${err.message}。你仍可手动点击“生成AI架构”重试。`;
    msgEl.className = 'error';
  }
}

// Store full arch data for canvas rendering
let currentArch = null;

function renderArchitecture(arch) {
  currentArch = arch;
  renderSummary(arch);
  renderTopologyCanvas_section(arch);
  renderFirewallRules(arch.firewall_rules);
  renderMgmtConfigs(arch.mgmt_configs);
  renderNodes(arch.nodes);
  renderRawJson(arch);
}

function renderSummary(arch) {
  document.getElementById('section-summary').innerHTML = `
    <h2>方案概要</h2>
    <div><strong>方案名称：</strong>${esc(arch.architecture_name || '默认方案')}</div>
    <div><strong>摘要：</strong>${esc(arch.summary || '-')}</div>
    <div style="margin-top:8px;"><strong>设计理由：</strong>${esc(arch.reasoning || '-')}</div>
    ${arch.deployment_order ? `
      <div style="margin-top:12px;"><strong>部署顺序：</strong></div>
      <ol style="margin:4px 0 0 20px;">${arch.deployment_order.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
    ` : ''}
    ${arch.risks?.length ? `
      <div style="margin-top:12px;"><strong>风险评估：</strong></div>
      ${arch.risks.map(r => `<div style="margin:4px 0; padding:6px 10px; background:#fef2f2; border-left:3px solid #ef4444; border-radius:4px;">
        <strong>${esc(r.risk)}</strong> <span style="color:#64748b;">(${esc(r.severity || '-')})</span><br>
        <span style="color:#64748b;">缓解：${esc(r.mitigation || '-')}</span>
      </div>`).join('')}
    ` : ''}
  `;
}

function renderTopologyCanvas_section(arch) {
  const el = document.getElementById('section-topology');
  const hasData = arch.topology?.nodes?.length || arch.topology?.zones?.length || arch.nodes?.length;
  if (!hasData) {
    el.innerHTML = '<h2>网络拓扑</h2><p class="muted">AI未生成拓扑信息</p>';
    return;
  }
  el.innerHTML = `<h2>网络拓扑</h2>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px;">
      <p class="muted" style="margin:0;">支持拖拽节点/区域/SDK，支持 Cmd/Ctrl+Z 撤销（最多10步）。</p>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <select id="arch-add-component-type">
          <option value="firewall">防火墙</option>
          <option value="alb">ALB</option>
          <option value="proxy">代理</option>
          <option value="gateway">网关</option>
        </select>
        <button type="button" class="btn-secondary" id="arch-add-component-btn">新增组件</button>
        <button type="button" class="btn-secondary" id="arch-remove-component-btn">删除选中组件</button>
        <button type="button" class="btn-secondary" id="arch-zoom-canvas-btn">放大画布</button>
        <button type="button" class="btn-secondary" id="arch-fullscreen-canvas-btn">全屏查看</button>
        <button type="button" class="btn-secondary" id="arch-reset-visible-btn">重置到可见区域</button>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="arch-auto-save-toggle" ${autoSaveEnabled ? 'checked' : ''}>
          <span>拖拽后自动保存</span>
        </label>
      </div>
    </div>
    <div id="arch-layout-save-status" class="muted" style="margin-bottom:6px;"></div>
    <div class="topology-wrap" id="arch-topology-wrap">
      <canvas id="arch-topo-canvas"></canvas>
      <button class="download-btn" id="dl-topo-btn">下载图片</button>
      <div id="arch-topology-loading-mask" style="display:none;position:absolute;inset:0;background:rgba(255,255,255,0.8);backdrop-filter:blur(1px);z-index:3;align-items:center;justify-content:center;font-weight:600;color:#334155;">AI正在绘制拓扑，请稍候...</div>
    </div>`;
  document.getElementById('arch-auto-save-toggle')?.addEventListener('change', (e) => {
    autoSaveEnabled = !!e.target.checked;
    saveAutoSavePreference(autoSaveEnabled);
    const statusEl = document.getElementById('arch-layout-save-status');
    if (!autoSaveEnabled) {
      if (statusEl) {
        statusEl.textContent = '自动保存已关闭：拖拽仅本地预览，不会自动落库。';
        statusEl.className = 'warning';
      }
    } else if (statusEl) {
      statusEl.textContent = '自动保存已开启：每次拖拽结束后自动保存布局。';
      statusEl.className = 'success';
    }
  });
  document.getElementById('arch-reset-visible-btn')?.addEventListener('click', () => {
    topologyTools?.resetToVisibleBounds?.();
    const statusEl = document.getElementById('arch-layout-save-status');
    if (statusEl) {
      statusEl.textContent = '已将拓扑元素回正到可见区域。';
      statusEl.className = 'success';
    }
  });
  document.getElementById('arch-add-component-btn')?.addEventListener('click', () => addNetworkComponent());
  document.getElementById('arch-remove-component-btn')?.addEventListener('click', () => removeSelectedComponent());
  document.getElementById('arch-zoom-canvas-btn')?.addEventListener('click', () => toggleCanvasZoom());
  document.getElementById('arch-fullscreen-canvas-btn')?.addEventListener('click', () => toggleCanvasFullscreen());
  setTimeout(() => {
    redrawTopologyCanvasOnly();
    const canvas = document.getElementById('arch-topo-canvas');
    document.getElementById('dl-topo-btn')?.addEventListener('click', () => {
      if (!canvas) return;
      const link = document.createElement('a');
      link.download = 'topology.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    });
  }, 50);
}

function scheduleLayoutAutosave(layout) {
  if (!currentProjectId || !layout) return;
  const statusEl = document.getElementById('arch-layout-save-status');
  if (!autoSaveEnabled) {
    if (statusEl) {
      statusEl.textContent = '自动保存已关闭：拖拽仅本地预览，不会自动落库。';
      statusEl.className = 'warning';
    }
    return;
  }
  const payload = JSON.stringify(layout);
  if (payload === lastLayoutPayload) return;
  if (layoutAutosaveTimer) clearTimeout(layoutAutosaveTimer);
  if (statusEl) {
    statusEl.textContent = '布局变更已检测，正在自动保存...';
    statusEl.className = 'muted';
  }
  layoutAutosaveTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/rtc-deployment/projects/${currentProjectId}/layout-autosave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layout_json: layout,
          architecture_patch: { network_components: currentArch?.network_components || [] }
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '自动保存失败');
      lastLayoutPayload = payload;
      if (statusEl) {
        statusEl.textContent = `布局已自动保存（${new Date().toLocaleTimeString('zh-CN')}）`;
        statusEl.className = 'success';
      }
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = `布局自动保存失败：${err.message}`;
        statusEl.className = 'error';
      }
    }
  }, 350);
}

function addNetworkComponent() {
  currentArch = currentArch || {};
  pushUndoSnapshot();
  const type = document.getElementById('arch-add-component-type')?.value || 'firewall';
  const id = `comp-${Date.now()}`;
  const zoneId = currentArch?.topology?.zones?.[0]?.zone_id || null;
  const list = Array.isArray(currentArch.network_components) ? currentArch.network_components : [];
  currentArch.network_components = [...list, { id, type, name: type.toUpperCase(), zone_id: zoneId, meta: {} }];
  selectedComponentId = id;
  renderTopologyCanvas_section(currentArch);
  scheduleLayoutAutosave(currentArch.layout || {});
}

function removeSelectedComponent() {
  if (!currentArch || !selectedComponentId) return;
  pushUndoSnapshot();
  const list = Array.isArray(currentArch.network_components) ? currentArch.network_components : [];
  currentArch.network_components = list.filter((c) => c.id !== selectedComponentId);
  if (currentArch.layout?.component_positions) {
    delete currentArch.layout.component_positions[selectedComponentId];
  }
  selectedComponentId = null;
  renderTopologyCanvas_section(currentArch);
  scheduleLayoutAutosave(currentArch.layout || {});
}

function toggleCanvasZoom() {
  canvasZoom = canvasZoom >= 1.5 ? 1 : Number((canvasZoom + 0.25).toFixed(2));
  const btn = document.getElementById('arch-zoom-canvas-btn');
  if (btn) btn.textContent = canvasZoom > 1 ? `还原画布(${canvasZoom}x)` : '放大画布';
  if (currentArch) renderTopologyCanvas_section(currentArch);
}

async function toggleCanvasFullscreen() {
  const wrap = document.getElementById('arch-topology-wrap');
  if (!wrap) return;
  try {
    if (getFullscreenElement() === wrap) {
      await exitFullscreenCompat();
    } else {
      await requestFullscreenCompat(wrap);
    }
  } catch (err) {
    const statusEl = document.getElementById('arch-layout-save-status');
    if (statusEl) {
      statusEl.textContent = `进入全屏失败：${err.message || err}`;
      statusEl.className = 'error';
    }
  }
}

function handleFullscreenChange() {
  const wrap = document.getElementById('arch-topology-wrap');
  isCanvasFullscreen = !!(wrap && getFullscreenElement() === wrap);
  redrawTopologyCanvasOnly();
}

function handleViewportResize() {
  if (!isCanvasFullscreen) return;
  redrawTopologyCanvasOnly();
}

function redrawTopologyCanvasOnly() {
  const canvas = document.getElementById('arch-topo-canvas');
  const wrap = document.getElementById('arch-topology-wrap');
  if (!canvas || !currentArch || typeof renderTopologyCanvas !== 'function') return;
  renderTopologyCanvas(canvas, currentArch, {
    enableDrag: true,
    zoom: canvasZoom,
    fitToViewport: isCanvasFullscreen,
    viewportWidth: wrap ? wrap.clientWidth - 16 : 0,
    viewportHeight: wrap ? wrap.clientHeight - 16 : 0,
    selectedComponentId,
    onLayoutToolsReady: (tools) => { topologyTools = tools || null; },
    onComponentSelect: (componentId) => {
      selectedComponentId = componentId;
      renderTopologyCanvas_section(currentArch);
    },
    onLayoutChange: (layout) => {
      currentArch = currentArch || {};
      const prevLayout = JSON.stringify(currentArch.layout || {});
      const nextLayout = JSON.stringify(layout || {});
      if (prevLayout !== nextLayout) {
        pushUndoSnapshot();
      }
      currentArch.layout = layout;
      scheduleLayoutAutosave(layout);
    }
  });
}

function pushUndoSnapshot() {
  if (!currentArch) return;
  const snapshot = JSON.stringify({
    layout: currentArch.layout || {},
    network_components: currentArch.network_components || [],
    topology: currentArch.topology || {},
    selectedComponentId: selectedComponentId || null
  });
  if (undoStack.length && undoStack[undoStack.length - 1] === snapshot) return;
  undoStack.push(snapshot);
  if (undoStack.length > MAX_UNDO_STEPS) {
    undoStack.shift();
  }
}

function restoreUndoSnapshot(snapshot) {
  if (!snapshot || !currentArch) return;
  try {
    const data = JSON.parse(snapshot);
    currentArch.layout = data.layout || {};
    currentArch.network_components = Array.isArray(data.network_components) ? data.network_components : [];
    currentArch.topology = data.topology || currentArch.topology || {};
    selectedComponentId = data.selectedComponentId || null;
    redrawTopologyCanvasOnly();
    scheduleLayoutAutosave(currentArch.layout || {});
    const statusEl = document.getElementById('arch-layout-save-status');
    if (statusEl) {
      statusEl.textContent = `已撤销（最多${MAX_UNDO_STEPS}步）`;
      statusEl.className = 'success';
    }
  } catch (_) {}
}

function handleUndoHotkey(e) {
  const key = String(e.key || '').toLowerCase();
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || key !== 'z') return;
  const target = e.target;
  const tag = (target?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return;
  if (!undoStack.length || !currentArch) return;
  e.preventDefault();
  const snapshot = undoStack.pop();
  restoreUndoSnapshot(snapshot);
}

function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function requestFullscreenCompat(el) {
  if (el.requestFullscreen) return el.requestFullscreen();
  if (el.webkitRequestFullscreen) return Promise.resolve(el.webkitRequestFullscreen());
  return Promise.reject(new Error('当前浏览器不支持全屏API'));
}

function exitFullscreenCompat() {
  if (document.exitFullscreen) return document.exitFullscreen();
  if (document.webkitExitFullscreen) return Promise.resolve(document.webkitExitFullscreen());
  return Promise.resolve();
}

function setTopologyLoading(isLoading, text = 'AI正在绘制拓扑，请稍候...') {
  const mask = document.getElementById('arch-topology-loading-mask');
  const wrap = document.getElementById('arch-topology-wrap');
  if (!mask || !wrap) return;
  if (isLoading) {
    mask.textContent = text;
    mask.style.display = 'flex';
    wrap.style.pointerEvents = 'none';
  } else {
    mask.style.display = 'none';
    wrap.style.pointerEvents = '';
  }
}

function loadAutoSavePreference() {
  try {
    const raw = localStorage.getItem('rtc_topology_autosave_enabled');
    if (raw == null) return true;
    return raw === '1';
  } catch (_) {
    return true;
  }
}

function saveAutoSavePreference(enabled) {
  try {
    localStorage.setItem('rtc_topology_autosave_enabled', enabled ? '1' : '0');
  } catch (_) {}
}

function renderFirewallRules(rules) {
  const el = document.getElementById('section-firewall');
  if (!rules?.length) {
    el.innerHTML = '<h2>防火墙放通规则</h2><p class="muted">AI未生成防火墙规则</p>';
    return;
  }
  el.innerHTML = `
    <h2>防火墙放通规则</h2>
    <table class="fw-table">
      <thead><tr><th>源</th><th>目标</th><th>协议</th><th>端口</th><th>方向</th><th>用途</th></tr></thead>
      <tbody>
        ${rules.map(r => `<tr>
          <td>${esc(r.source || '-')}</td>
          <td>${esc(r.destination || '-')}</td>
          <td>${esc(r.protocol || '-')}</td>
          <td>${esc(r.port || '-')}</td>
          <td>${esc(r.direction || '-')}</td>
          <td>${esc(r.purpose || '-')}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  `;
}

function renderMgmtConfigs(configs) {
  const el = document.getElementById('section-mgmt');
  if (!configs?.length) {
    el.innerHTML = '<h2>mgmt.sh 节点配置</h2><p class="muted">AI未生成mgmt配置</p>';
    return;
  }
  el.innerHTML = `
    <h2>mgmt.sh 节点配置</h2>
    ${configs.map(c => {
      const vars = c.variables || {};
      const lines = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n');
      return `
        <div class="mgmt-node">
          <h4>${esc(c.hostname || c.node_id)} (${esc(c.node_id)})</h4>
          <pre>${esc(lines)}</pre>
        </div>
      `;
    }).join('')}
  `;
}

function renderNodes(nodes) {
  const el = document.getElementById('section-nodes');
  if (!nodes?.length) {
    el.innerHTML = '<h2>节点规划</h2><p class="muted">无节点数据</p>';
    return;
  }
  el.innerHTML = `
    <h2>节点规划</h2>
    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:16px;">
      ${nodes.map(n => `
        <div style="border:1px solid #e5e7eb; border-radius:8px; padding:16px;">
          <h4 style="margin:0 0 8px;">${esc(n.hostname || n.node_id)}</h4>
          <div><strong>IP:</strong> ${esc(n.ip_address || '-')}</div>
          <div><strong>角色:</strong> ${esc(n.role_description || n.role || '-')}</div>
          <div><strong>服务:</strong> ${(n.services || []).map(s => esc(s)).join(', ')}</div>
          ${n.instance_counts ? `<div><strong>Edge:</strong> UDP=${n.instance_counts.udp_edge_cnt || 0} AUT=${n.instance_counts.aut_edge_cnt || 0} Web=${n.instance_counts.web_edge_cnt || 0}</div>` : ''}
          ${n.resources ? `<div><strong>配置:</strong> ${n.resources.cpu || '-'}C ${n.resources.memory || '-'}G ${n.resources.storage || '-'}GB ${n.resources.bandwidth || '-'}Mbps</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function renderRawJson(arch) {
  document.getElementById('section-raw').innerHTML = `
    <details class="raw-json">
      <summary>查看原始JSON数据</summary>
      <pre>${esc(JSON.stringify(arch, null, 2))}</pre>
    </details>
  `;
}

function esc(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', init);
