/**
 * RTC资源计算器前端逻辑
 */

let currentUser = null;
let currentProjectId = null;
let lastCalculation = null;

// 初始化
async function init() {
  await loadCurrentUser();
  
  // 渲染侧边栏
  if (typeof renderSidebarNav === 'function') {
    renderSidebarNav('sidebar-nav', window.location.pathname, currentUser);
  }
  
  setupEventListeners();
  
  // 从URL参数获取项目ID
  const params = new URLSearchParams(window.location.search);
  currentProjectId = params.get('project_id');
}

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
    document.getElementById('user-menu-btn').textContent = currentUser.name || currentUser.email;
  } catch (err) {
    console.error('Failed to load user:', err);
  }
}

function setupEventListeners() {
  // 场景模板选择
  document.querySelectorAll('.template-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.template-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      
      const template = card.dataset.template;
      updateFormForTemplate(template);
    });
  });

  // 视频选项切换
  document.getElementById('has-video').addEventListener('change', (e) => {
    const videoOptions = document.getElementById('video-options');
    const fpsOption = document.getElementById('fps-option');
    
    if (e.target.value === 'false') {
      videoOptions.style.display = 'none';
      fpsOption.style.display = 'none';
    } else {
      videoOptions.style.display = 'block';
      fpsOption.style.display = 'block';
    }
  });

  // 用户菜单
  document.getElementById('user-menu-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('user-menu-dropdown').classList.toggle('show');
  });

  document.addEventListener('click', () => {
    document.getElementById('user-menu-dropdown')?.classList.remove('show');
  });

  // 登出
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  });
}

function updateFormForTemplate(template) {
  const templateDefaults = {
    '1v1+rec': {
      concurrent_users: 1000,
      channels: 500,
      has_video: true,
      video_resolution: '720p',
      fps: 15
    },
    '3v7+rec': {
      concurrent_users: 2000,
      channels: 200,
      has_video: true,
      video_resolution: '720p',
      fps: 15
    },
    'broadcast': {
      concurrent_users: 5000,
      channels: 10,
      has_video: true,
      video_resolution: '1080p',
      fps: 30
    },
    'custom': {}
  };

  const defaults = templateDefaults[template] || {};
  
  if (defaults.concurrent_users) document.getElementById('concurrent-users').value = defaults.concurrent_users;
  if (defaults.channels) document.getElementById('channels').value = defaults.channels;
  if (defaults.has_video !== undefined) document.getElementById('has-video').value = defaults.has_video.toString();
  if (defaults.video_resolution) document.getElementById('video-resolution').value = defaults.video_resolution;
  if (defaults.fps) document.getElementById('fps').value = defaults.fps;
}

async function calculate() {
  const messageEl = document.getElementById('calc-message');
  messageEl.textContent = '正在计算...';
  messageEl.className = 'muted';

  try {
    // 获取表单数据
    const activeTemplate = document.querySelector('.template-card.active');
    const channelModel = activeTemplate?.dataset.template || '1v1+rec';

    const data = {
      concurrent_users: parseInt(document.getElementById('concurrent-users').value),
      channels: parseInt(document.getElementById('channels').value),
      channel_model: channelModel,
      has_video: document.getElementById('has-video').value === 'true',
      video_resolution: document.getElementById('video-resolution').value,
      fps: parseInt(document.getElementById('fps').value),
      deployment_type: document.getElementById('deployment-type').value,
      redundancy: parseInt(document.getElementById('redundancy').value) / 100
    };

    // 如果有项目ID，使用项目API；否则使用临时计算API
    let response;
    if (currentProjectId) {
      response = await fetch(`/api/rtc-deployment/projects/${currentProjectId}/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    } else {
      // 临时计算（不保存）
      response = await fetch('/api/rtc-deployment/calculate-temp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    }

    if (!response.ok) {
      throw new Error('计算失败');
    }

    const result = await response.json();
    lastCalculation = result;

    displayResults(result);

    messageEl.textContent = '✅ 计算完成！';
    messageEl.className = 'success';
  } catch (err) {
    console.error('Calculation error:', err);
    messageEl.textContent = '❌ 计算失败: ' + err.message;
    messageEl.className = 'error';
  }
}

function displayResults(result) {
  const { summary, servers, instances, userBitrate, recommendations } = result;

  // 显示结果区域
  document.getElementById('results-section').style.display = 'block';

  // 渲染结果卡片
  const cardsHtml = `
    <div class="result-card">
      <div class="card-value">${summary.totalServers}</div>
      <div class="card-label">总服务器数</div>
      <div class="card-detail">${summary.mediaServers}台媒体 + ${summary.datahubServers}台数据</div>
    </div>
    
    <div class="result-card">
      <div class="card-value">${summary.totalCPU}</div>
      <div class="card-label">总CPU核心</div>
      <div class="card-detail">16核/台</div>
    </div>
    
    <div class="result-card">
      <div class="card-value">${summary.totalMemory}</div>
      <div class="card-label">总内存(GB)</div>
      <div class="card-detail">32GB/台</div>
    </div>
    
    <div class="result-card">
      <div class="card-value">${(summary.totalBandwidth/1000).toFixed(1)}</div>
      <div class="card-label">总带宽(Gbps)</div>
      <div class="card-detail">10Gbps/台</div>
    </div>

    <div class="result-card">
      <div class="card-value">${userBitrate.total.toFixed(2)}</div>
      <div class="card-label">单用户码率(Mbps)</div>
      <div class="card-detail">音频${userBitrate.audio} + 视频${userBitrate.video.toFixed(2)}</div>
    </div>

    <div class="result-card">
      <div class="card-value">${instances.aut_edge_cnt}</div>
      <div class="card-label">AUT Edge实例</div>
      <div class="card-detail">Native SDK主要承载</div>
    </div>
  `;

  document.getElementById('result-cards').innerHTML = cardsHtml;

  // 渲染建议
  if (recommendations && recommendations.length > 0) {
    const recommendationsHtml = `
      <div class="recommendations">
        <h4>💡 建议和提示</h4>
        ${recommendations.map(r => `
          <div class="recommendation-item">
            <span class="badge badge-${r.type}">${r.category}</span>
            ${r.message}
          </div>
        `).join('')}
      </div>
    `;
    document.getElementById('recommendations-section').innerHTML = recommendationsHtml;
  }

  // 滚动到结果区域
  document.getElementById('results-section').scrollIntoView({ behavior: 'smooth' });
}

function exportReport() {
  if (!lastCalculation) return;

  // 生成简单的文本报告
  const report = `
RTC私有化资源需求评估报告
生成时间: ${new Date().toLocaleString('zh-CN')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
资源需求汇总
━━━━━━━━━━━━━━━━━━━━━━━━━━━
• 服务器总数: ${lastCalculation.summary.totalServers}台
• 媒体服务器: ${lastCalculation.summary.mediaServers}台
• 数据平台: ${lastCalculation.summary.datahubServers}台
• CPU总计: ${lastCalculation.summary.totalCPU}核
• 内存总计: ${lastCalculation.summary.totalMemory}GB
• 带宽总计: ${(lastCalculation.summary.totalBandwidth/1000).toFixed(1)}Gbps

━━━━━━━━━━━━━━━━━━━━━━━━━━━
Edge实例配置
━━━━━━━━━━━━━━━━━━━━━━━━━━━
• udp_edge_cnt: ${lastCalculation.instances.udp_edge_cnt}
• aut_edge_cnt: ${lastCalculation.instances.aut_edge_cnt}
• web_edge_cnt: ${lastCalculation.instances.web_edge_cnt}
• 说明: ${lastCalculation.instances.reasoning}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
建议
━━━━━━━━━━━━━━━━━━━━━━━━━━━
${lastCalculation.recommendations.map((r, i) => `${i+1}. [${r.type}] ${r.category}: ${r.message}`).join('\n')}
`;

  // 下载为文本文件
  const blob = new Blob([report], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `RTC资源评估-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

async function generateArchitecture() {
  if (!currentProjectId) {
    alert('请先创建项目后再使用AI架构设计');
    return;
  }

  window.location.href = `/rtc-deployment/architect?project_id=${currentProjectId}`;
}

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', init);
