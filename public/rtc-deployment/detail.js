let currentUser = null;
let currentProjectId = null;
let currentArchitectureId = null;
let currentArchitectureData = null;
let layoutAutosaveTimer = null;
let lastLayoutPayload = '';
let autoSaveEnabled = true;
let topologyTools = null;
let selectedComponentId = null;
let canvasZoom = 1;
let isCanvasFullscreen = false;
const MAX_UNDO_STEPS = 10;
const undoStack = [];

const DEPLOYMENT_LABELS = { pure: '纯私有', hybrid: '混合云' };
const STATUS_LABELS = { draft: '草稿', calculating: '资源评估中', designing: 'AI设计中', configured: '已配置', deployed: '已部署' };

async function init() {
  autoSaveEnabled = loadAutoSavePreference();
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/login'; return; }
  currentUser = await res.json();
  document.getElementById('user-menu-btn').textContent = currentUser.name || currentUser.email;
  if (typeof renderSidebarNav === 'function') renderSidebarNav('sidebar-nav', window.location.pathname, currentUser);
  setupUserMenu();
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  document.addEventListener('keydown', handleUndoHotkey);
  window.addEventListener('resize', handleViewportResize);

  const projectId = new URLSearchParams(window.location.search).get('project_id');
  if (!projectId) {
    document.getElementById('loading-msg').innerHTML = '<p class="error">缺少项目ID，请从项目列表进入。</p>';
    return;
  }
  currentProjectId = projectId;
  await loadProject(projectId);
}

function setupUserMenu() {
  document.getElementById('user-menu-btn')?.addEventListener('click', (e) => { e.stopPropagation(); document.getElementById('user-menu-dropdown').classList.toggle('show'); });
  document.addEventListener('click', () => { document.getElementById('user-menu-dropdown')?.classList.remove('show'); });
  document.getElementById('logout-btn')?.addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.href = '/login'; });
}

async function loadProject(projectId) {
  try {
    const res = await fetch(`/api/rtc-deployment/projects/${projectId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '加载失败');

    document.getElementById('loading-msg').style.display = 'none';
    const { project, resource_estimate, architecture } = data;
    undoStack.length = 0;

    document.getElementById('page-title').textContent = project.project_name || '项目详情';
    document.getElementById('page-subtitle').textContent = `${project.customer_name || ''} - ${DEPLOYMENT_LABELS[project.deployment_type] || project.deployment_type}`;

    renderProjectInfo(project, projectId);
    renderResourceEstimate(resource_estimate);
    if (architecture) renderArchitecture(architecture.architecture_json, architecture);
  } catch (err) {
    document.getElementById('loading-msg').innerHTML = `<p class="error">加载失败: ${esc(err.message)}</p>`;
  }
}

function renderProjectInfo(p, projectId) {
  const section = document.getElementById('section-project');
  section.style.display = '';

  let netSecHtml = '';
  if (p.network_security) {
    try {
      const ns = JSON.parse(p.network_security);
      const parts = [];
      if (ns.has_air_gap) parts.push(`网闸隔离${ns.air_gap_description ? '（' + esc(ns.air_gap_description) + '）' : ''}`);
      if (ns.has_proxy) parts.push(`代理${ns.proxy_address ? '（' + esc(ns.proxy_address) + '）' : ''}`);
      if (ns.has_firewall) parts.push(`防火墙${ns.firewall_description ? '（' + esc(ns.firewall_description) + '）' : ''}`);
      if (parts.length) netSecHtml = `<div class="detail-item"><div class="label">网络安全</div><div class="value">${parts.join(' / ')}</div></div>`;
    } catch (_) {}
  }

  document.getElementById('project-info').innerHTML = `
    <div class="detail-grid">
      <div class="detail-item"><div class="label">项目名称</div><div class="value">${esc(p.project_name)}</div></div>
      <div class="detail-item"><div class="label">客户名称</div><div class="value">${esc(p.customer_name)}</div></div>
      <div class="detail-item"><div class="label">部署类型</div><div class="value">${DEPLOYMENT_LABELS[p.deployment_type] || p.deployment_type}</div></div>
      <div class="detail-item"><div class="label">并发用户</div><div class="value">${(p.concurrent_users || 0).toLocaleString()}</div></div>
      <div class="detail-item"><div class="label">频道数量</div><div class="value">${(p.channels || 0).toLocaleString()}</div></div>
      <div class="detail-item"><div class="label">频道模型</div><div class="value">${esc(p.channel_model || '-')}</div></div>
      <div class="detail-item"><div class="label">视频分辨率</div><div class="value">${p.has_video ? esc(p.video_resolution || '720p') : '纯音频'}</div></div>
      <div class="detail-item"><div class="label">网络环境</div><div class="value">${esc(p.network_type || '-')}</div></div>
      <div class="detail-item"><div class="label">SLA</div><div class="value">${esc(p.sla_requirement || '-')}</div></div>
      <div class="detail-item"><div class="label">AppID</div><div class="value">${esc(p.appid || p.app_id || '-')}</div></div>
      <div class="detail-item"><div class="label">AppCert</div><div class="value">${(p.app_cert || p.appCert) ? '已配置' : '-'}</div></div>
      <div class="detail-item"><div class="label">状态</div><div class="value">${STATUS_LABELS[p.status] || p.status}</div></div>
      <div class="detail-item"><div class="label">创建时间</div><div class="value">${p.created_at ? new Date(p.created_at).toLocaleString('zh-CN') : '-'}</div></div>
      <div class="detail-item"><div class="label">SA</div><div class="value">${esc(p.sa_name || p.sa_email || '-')}</div></div>
      ${netSecHtml}
    </div>
    ${p.special_requirements ? `<div style="margin-top:8px;"><strong>特殊需求：</strong>${esc(p.special_requirements)}</div>` : ''}
  `;

  document.getElementById('project-actions').innerHTML = `
    <a href="/rtc-deployment/calculator?project_id=${projectId}" class="btn-secondary">资源计算器</a>
    <a href="/rtc-deployment/architect?project_id=${projectId}" class="btn-primary">AI架构设计</a>
    <a href="/api/rtc-deployment/projects/${projectId}/export-mgmt-sh" class="btn-secondary">一键导出 mgmt.sh</a>
    <a href="/rtc-deployment/" class="btn-secondary">返回列表</a>
  `;
}

function renderResourceEstimate(est) {
  const section = document.getElementById('section-resource');
  if (!est) {
    section.style.display = '';
    document.getElementById('resource-info').innerHTML = '<div class="empty-state">尚未进行资源评估。请先使用资源计算器。</div>';
    return;
  }
  section.style.display = '';
  document.getElementById('resource-info').innerHTML = `
    <div class="resource-cards">
      <div class="resource-card"><div class="card-value">${est.total_servers || '-'}</div><div class="card-label">服务器总数</div></div>
      <div class="resource-card"><div class="card-value">${est.media_servers || '-'}</div><div class="card-label">媒体服务器</div></div>
      <div class="resource-card"><div class="card-value">${est.total_cpu || '-'}</div><div class="card-label">CPU (核)</div></div>
      <div class="resource-card"><div class="card-value">${est.total_memory || '-'}</div><div class="card-label">内存 (GB)</div></div>
      <div class="resource-card"><div class="card-value">${est.total_bandwidth ? (est.total_bandwidth / 1000).toFixed(1) : '-'}</div><div class="card-label">带宽 (Gbps)</div></div>
      <div class="resource-card"><div class="card-value">${est.total_storage || '-'}</div><div class="card-label">存储 (GB)</div></div>
    </div>
    <div class="detail-grid" style="margin-top:10px;">
      <div class="detail-item"><div class="label">UDP Edge</div><div class="value">${est.udp_edge_cnt || 0} 个/台</div></div>
      <div class="detail-item"><div class="label">AUT Edge</div><div class="value">${est.aut_edge_cnt || 0} 个/台</div></div>
      <div class="detail-item"><div class="label">Web Edge</div><div class="value">${est.web_edge_cnt || 0} 个/台</div></div>
      <div class="detail-item"><div class="label">单用户码率</div><div class="value">${est.user_total_bitrate ? est.user_total_bitrate.toFixed(2) + ' Mbps' : '-'}</div></div>
      <div class="detail-item"><div class="label">冗余系数</div><div class="value">${est.redundancy_factor ? (est.redundancy_factor * 100).toFixed(0) + '%' : '-'}</div></div>
      <div class="detail-item"><div class="label">评估时间</div><div class="value">${est.calculated_at ? new Date(est.calculated_at).toLocaleString('zh-CN') : '-'}</div></div>
    </div>
  `;
}

function renderArchitecture(arch, archRow) {
  if (!arch) return;
  currentArchitectureId = archRow?.id || null;
  currentArchitectureData = arch;
  document.getElementById('section-arch').style.display = '';

  // Summary
  document.getElementById('arch-summary').innerHTML = `
    <h2>架构方案 — ${esc(arch.architecture_name || '默认方案')}</h2>
    <div><strong>摘要：</strong>${esc(arch.summary || '-')}</div>
    <div style="margin-top:6px;"><strong>设计理由：</strong>${esc(arch.reasoning || '-')}</div>
    ${arch.deployment_order ? `<div style="margin-top:10px;"><strong>部署顺序：</strong><ol style="margin:4px 0 0 20px;">${arch.deployment_order.map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>` : ''}
    ${arch.risks?.length ? `<div style="margin-top:10px;"><strong>风险：</strong>${arch.risks.map(r => `<div style="margin:4px 0;padding:6px 10px;background:#fef2f2;border-left:3px solid #ef4444;border-radius:4px;"><strong>${esc(r.risk)}</strong> (${esc(r.severity||'-')})<br><span style="color:#64748b;">缓解：${esc(r.mitigation||'-')}</span></div>`).join('')}</div>` : ''}
    ${archRow ? `<div style="margin-top:8px;color:#94a3b8;font-size:0.85rem;">生成时间: ${archRow.generated_at ? new Date(archRow.generated_at).toLocaleString('zh-CN') : '-'} | 模型: ${esc(archRow.ai_model||'-')}</div>` : ''}
  `;

  // Topology (Canvas)
  const topoEl = document.getElementById('arch-topology');
  if (arch.topology?.nodes?.length || arch.topology?.zones?.length || arch.nodes?.length) {
    topoEl.innerHTML = `<h2>网络拓扑</h2>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px;">
        <div class="muted">支持拖拽节点/区域/SDK，支持 Cmd/Ctrl+Z 撤销（最多10步）。</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <select id="add-component-type">
            <option value="firewall">防火墙</option>
            <option value="alb">ALB</option>
            <option value="proxy">代理</option>
            <option value="gateway">网关</option>
          </select>
          <button type="button" class="btn-secondary" id="add-component-btn">新增组件</button>
          <button type="button" class="btn-secondary" id="remove-component-btn">删除选中组件</button>
          <button type="button" class="btn-secondary" id="zoom-canvas-btn">放大画布</button>
          <button type="button" class="btn-secondary" id="fullscreen-canvas-btn">全屏查看</button>
          <button type="button" class="btn-secondary" id="reset-visible-btn">重置到可见区域</button>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="auto-save-toggle" ${autoSaveEnabled ? 'checked' : ''}>
            <span>拖拽后自动保存</span>
          </label>
        </div>
      </div>
      <div id="topology-save-status" class="muted" style="margin-bottom:6px;"></div>
      <div class="topology-wrap" id="topology-wrap">
        <canvas id="topo-canvas"></canvas>
        <button class="download-btn" id="download-topo-btn">下载图片</button>
        <div id="topology-loading-mask" style="display:none;position:absolute;inset:0;background:rgba(255,255,255,0.8);backdrop-filter:blur(1px);z-index:3;align-items:center;justify-content:center;font-weight:600;color:#334155;">AI正在重绘拓扑，请稍候...</div>
      </div>`;
    const toggle = document.getElementById('auto-save-toggle');
    document.getElementById('reset-visible-btn')?.addEventListener('click', () => {
      topologyTools?.resetToVisibleBounds?.();
      const statusEl = document.getElementById('topology-save-status');
      if (statusEl) {
        statusEl.textContent = '已将拓扑元素回正到可见区域。';
        statusEl.className = 'success';
      }
    });
    document.getElementById('add-component-btn')?.addEventListener('click', () => addNetworkComponent());
    document.getElementById('remove-component-btn')?.addEventListener('click', () => removeSelectedComponent());
    document.getElementById('zoom-canvas-btn')?.addEventListener('click', () => toggleCanvasZoom());
    document.getElementById('fullscreen-canvas-btn')?.addEventListener('click', () => toggleCanvasFullscreen());
    toggle?.addEventListener('change', (e) => {
      autoSaveEnabled = !!e.target.checked;
      saveAutoSavePreference(autoSaveEnabled);
      const statusEl = document.getElementById('topology-save-status');
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
    setTimeout(() => {
      redrawTopologyCanvasOnly();
      const canvas = document.getElementById('topo-canvas');
      document.getElementById('download-topo-btn')?.addEventListener('click', () => canvas && downloadCanvas(canvas, 'topology.png'));
    }, 50);
  } else {
    topoEl.innerHTML = '<h2>网络拓扑</h2><div class="empty-state">无拓扑数据</div>';
  }

  // Firewall
  const fwEl = document.getElementById('arch-firewall');
  if (arch.firewall_rules?.length) {
    fwEl.innerHTML = `<h2>防火墙放通规则</h2><table class="fw-table"><thead><tr><th>源</th><th>目标</th><th>协议</th><th>端口</th><th>方向</th><th>用途</th></tr></thead><tbody>${arch.firewall_rules.map(r => `<tr><td>${esc(r.source||'-')}</td><td>${esc(r.destination||'-')}</td><td>${esc(r.protocol||'-')}</td><td>${esc(r.port||'-')}</td><td>${esc(r.direction||'-')}</td><td>${esc(r.purpose||'-')}</td></tr>`).join('')}</tbody></table>`;
  } else {
    fwEl.innerHTML = '<h2>防火墙放通规则</h2><div class="empty-state">无防火墙规则数据</div>';
  }

  // Mgmt configs
  const mgmtEl = document.getElementById('arch-mgmt');
  if (arch.mgmt_configs?.length) {
    mgmtEl.innerHTML = `<h2>mgmt.sh 节点配置</h2>${arch.mgmt_configs.map(c => {
      const lines = Object.entries(c.variables || {}).map(([k,v]) => `${k}=${v}`).join('\n');
      return `<div class="mgmt-node"><h4>${esc(c.hostname || c.node_id)}</h4><pre>${esc(lines)}</pre></div>`;
    }).join('')}`;
  } else {
    mgmtEl.innerHTML = '<h2>mgmt.sh 节点配置</h2><div class="empty-state">无节点配置数据</div>';
  }

  // Nodes
  const nodesEl = document.getElementById('arch-nodes');
  if (arch.nodes?.length) {
    nodesEl.innerHTML = `<h2>节点规划（可微调）</h2>
    <p class="muted">修改后点击“保存节点微调”，系统会自动同步更新拓扑图、防火墙规则与脚本配置，并生成新版本（页面仅展示最新版本）。</p>
    <div class="node-grid">${arch.nodes.map((n, idx) => `<div class="node-card" data-node-idx="${idx}">
      <h4>${esc(n.hostname || n.node_id)}</h4>
      <div style="margin:6px 0;"><label>节点ID</label><input data-f="node_id" value="${esc(n.node_id || '')}"></div>
      <div style="margin:6px 0;"><label>主机名</label><input data-f="hostname" value="${esc(n.hostname || '')}"></div>
      <div style="margin:6px 0;"><label>IP</label><input data-f="ip_address" value="${esc(n.ip_address || '')}"></div>
      <div style="margin:6px 0;"><label>角色</label><input data-f="role" value="${esc(n.role || '')}"></div>
      <div style="margin:6px 0;"><label>角色描述</label><input data-f="role_description" value="${esc(n.role_description || '')}"></div>
      <div style="margin:6px 0;"><label>服务（逗号分隔）</label><input data-f="services" value="${esc((n.services || []).join(','))}"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin:6px 0;">
        <div><label>UDP</label><input type="number" data-f="udp_edge_cnt" value="${Number(n.instance_counts?.udp_edge_cnt || 0)}"></div>
        <div><label>AUT</label><input type="number" data-f="aut_edge_cnt" value="${Number(n.instance_counts?.aut_edge_cnt || 0)}"></div>
        <div><label>WEB</label><input type="number" data-f="web_edge_cnt" value="${Number(n.instance_counts?.web_edge_cnt || 0)}"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;">
        <div><label>CPU</label><input type="number" data-f="cpu" value="${Number(n.resources?.cpu || 0)}"></div>
        <div><label>MEM</label><input type="number" data-f="memory" value="${Number(n.resources?.memory || 0)}"></div>
        <div><label>STO</label><input type="number" data-f="storage" value="${Number(n.resources?.storage || 0)}"></div>
        <div><label>BW</label><input type="number" data-f="bandwidth" value="${Number(n.resources?.bandwidth || 0)}"></div>
      </div>
    </div>`).join('')}</div>
    <div style="margin-top:10px;display:flex;gap:10px;align-items:center;">
      <button id="save-node-tune-btn" class="btn-primary">保存节点微调</button>
      <span id="node-tune-msg" class="muted"></span>
    </div>`;
    document.getElementById('save-node-tune-btn')?.addEventListener('click', saveNodeTuning);
  } else {
    nodesEl.innerHTML = '<h2>节点规划</h2><div class="empty-state">无节点数据</div>';
  }

  // Raw JSON
  document.getElementById('arch-raw').innerHTML = `<details class="raw-json"><summary>查看原始JSON数据</summary><pre>${esc(JSON.stringify(arch, null, 2))}</pre></details>`;
}

function downloadCanvas(canvas, filename) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

async function saveNodeTuning() {
  const msgEl = document.getElementById('node-tune-msg');
  if (!currentProjectId) return;

  const cards = Array.from(document.querySelectorAll('#arch-nodes .node-card[data-node-idx]'));
  const nodes = cards.map((card) => {
    const v = (name) => card.querySelector(`[data-f="${name}"]`)?.value || '';
    const n = (name) => Number(v(name) || 0);
    return {
      node_id: v('node_id').trim(),
      hostname: v('hostname').trim(),
      ip_address: v('ip_address').trim(),
      role: v('role').trim(),
      role_description: v('role_description').trim(),
      services: v('services').split(',').map((s) => s.trim()).filter(Boolean),
      instance_counts: {
        udp_edge_cnt: n('udp_edge_cnt'),
        aut_edge_cnt: n('aut_edge_cnt'),
        web_edge_cnt: n('web_edge_cnt')
      },
      resources: {
        cpu: n('cpu'),
        memory: n('memory'),
        storage: n('storage'),
        bandwidth: n('bandwidth')
      }
    };
  });

  msgEl.textContent = '保存中（含AI重绘拓扑）...';
  msgEl.className = 'muted';
  setTopologyLoading(true, 'AI正在重绘拓扑，请稍候...');
  try {
    const res = await fetch(`/api/rtc-deployment/projects/${currentProjectId}/tune-nodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes, layout_json: currentArchitectureData?.layout || null, redraw_topology: true })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '保存失败');
    if (data.topology_redraw && data.topology_redraw.ok === false) {
      msgEl.textContent = `保存成功；AI重绘失败，已保留本地重建拓扑。原因：${data.topology_redraw.error || '未知错误'}`;
      msgEl.className = 'warning';
    } else {
      msgEl.textContent = '保存成功，已生成最新版本并同步更新拓扑/规则/脚本（含AI重绘）。';
      msgEl.className = 'success';
    }
    if (data.architecture) {
      currentArchitectureData = data.architecture;
      lastLayoutPayload = JSON.stringify(currentArchitectureData.layout || {});
    }
    await loadProject(currentProjectId);
  } catch (err) {
    msgEl.textContent = '保存失败: ' + err.message;
    msgEl.className = 'error';
  } finally {
    setTopologyLoading(false);
  }
}

function scheduleLayoutAutosave(layout) {
  if (!currentProjectId || !layout) return;
  const statusEl = document.getElementById('topology-save-status');
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
          architecture_patch: { network_components: currentArchitectureData?.network_components || [] }
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
  if (!currentArchitectureData) return;
  pushUndoSnapshot();
  const type = document.getElementById('add-component-type')?.value || 'firewall';
  const id = `comp-${Date.now()}`;
  const zoneId = currentArchitectureData?.topology?.zones?.[0]?.zone_id || null;
  const list = Array.isArray(currentArchitectureData.network_components) ? currentArchitectureData.network_components : [];
  const item = { id, type, name: type.toUpperCase(), zone_id: zoneId, meta: {} };
  currentArchitectureData.network_components = [...list, item];
  selectedComponentId = id;
  renderArchitecture(currentArchitectureData, { id: currentArchitectureId });
  scheduleLayoutAutosave(currentArchitectureData.layout || {});
}

function removeSelectedComponent() {
  if (!currentArchitectureData || !selectedComponentId) return;
  pushUndoSnapshot();
  const list = Array.isArray(currentArchitectureData.network_components) ? currentArchitectureData.network_components : [];
  currentArchitectureData.network_components = list.filter((c) => c.id !== selectedComponentId);
  if (currentArchitectureData.layout?.component_positions) {
    delete currentArchitectureData.layout.component_positions[selectedComponentId];
  }
  selectedComponentId = null;
  renderArchitecture(currentArchitectureData, { id: currentArchitectureId });
  scheduleLayoutAutosave(currentArchitectureData.layout || {});
}

function toggleCanvasZoom() {
  canvasZoom = canvasZoom >= 1.5 ? 1 : Number((canvasZoom + 0.25).toFixed(2));
  const btn = document.getElementById('zoom-canvas-btn');
  if (btn) btn.textContent = canvasZoom > 1 ? `还原画布(${canvasZoom}x)` : '放大画布';
  if (currentArchitectureData) renderArchitecture(currentArchitectureData, { id: currentArchitectureId });
}

async function toggleCanvasFullscreen() {
  const wrap = document.getElementById('topology-wrap');
  if (!wrap) return;
  try {
    if (getFullscreenElement() === wrap) {
      await exitFullscreenCompat();
    } else {
      await requestFullscreenCompat(wrap);
    }
  } catch (err) {
    const statusEl = document.getElementById('topology-save-status');
    if (statusEl) {
      statusEl.textContent = `进入全屏失败：${err.message || err}`;
      statusEl.className = 'error';
    }
  }
}

function handleFullscreenChange() {
  const wrap = document.getElementById('topology-wrap');
  isCanvasFullscreen = !!(wrap && getFullscreenElement() === wrap);
  redrawTopologyCanvasOnly();
}

function handleViewportResize() {
  if (!isCanvasFullscreen) return;
  redrawTopologyCanvasOnly();
}

function redrawTopologyCanvasOnly() {
  const canvas = document.getElementById('topo-canvas');
  const wrap = document.getElementById('topology-wrap');
  if (!canvas || !currentArchitectureData || typeof renderTopologyCanvas !== 'function') return;
  renderTopologyCanvas(canvas, currentArchitectureData, {
    enableDrag: true,
    zoom: canvasZoom,
    fitToViewport: isCanvasFullscreen,
    viewportWidth: wrap ? wrap.clientWidth - 16 : 0,
    viewportHeight: wrap ? wrap.clientHeight - 16 : 0,
    selectedComponentId,
    onLayoutToolsReady: (tools) => { topologyTools = tools || null; },
    onComponentSelect: (componentId) => {
      selectedComponentId = componentId;
      renderArchitecture(currentArchitectureData, { id: currentArchitectureId });
    },
    onLayoutChange: (layout) => {
      currentArchitectureData = currentArchitectureData || {};
      const prevLayout = JSON.stringify(currentArchitectureData.layout || {});
      const nextLayout = JSON.stringify(layout || {});
      if (prevLayout !== nextLayout) {
        pushUndoSnapshot();
      }
      currentArchitectureData.layout = layout;
      scheduleLayoutAutosave(layout);
    }
  });
}

function pushUndoSnapshot() {
  if (!currentArchitectureData) return;
  const snapshot = JSON.stringify({
    layout: currentArchitectureData.layout || {},
    network_components: currentArchitectureData.network_components || [],
    topology: currentArchitectureData.topology || {},
    selectedComponentId: selectedComponentId || null
  });
  if (undoStack.length && undoStack[undoStack.length - 1] === snapshot) return;
  undoStack.push(snapshot);
  if (undoStack.length > MAX_UNDO_STEPS) {
    undoStack.shift();
  }
}

function restoreUndoSnapshot(snapshot) {
  if (!snapshot || !currentArchitectureData) return;
  try {
    const data = JSON.parse(snapshot);
    currentArchitectureData.layout = data.layout || {};
    currentArchitectureData.network_components = Array.isArray(data.network_components) ? data.network_components : [];
    currentArchitectureData.topology = data.topology || currentArchitectureData.topology || {};
    selectedComponentId = data.selectedComponentId || null;
    redrawTopologyCanvasOnly();
    scheduleLayoutAutosave(currentArchitectureData.layout || {});
    const statusEl = document.getElementById('topology-save-status');
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
  if (!undoStack.length || !currentArchitectureData) return;
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

function setTopologyLoading(isLoading, text = 'AI正在重绘拓扑，请稍候...') {
  const mask = document.getElementById('topology-loading-mask');
  const wrap = document.getElementById('topology-wrap');
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

function esc(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', init);
