/**
 * RTC部署管理服务路由
 */

const { RTCResourceCalculator } = require('../rtc-resource-calculator');
const { QwenAIClient } = require('../qwen-ai-client');
const { RTCConfigGenerator } = require('../rtc-config-generator');

function parseNetworkSecurity(project) {
  if (!project || !project.network_security) return null;
  try {
    return JSON.parse(project.network_security);
  } catch (_) {
    return null;
  }
}

function rebuildArchitectureDerivedFields(architecture, project, forceRebuild = false) {
  const arch = architecture && typeof architecture === 'object' ? architecture : {};
  const nodes = Array.isArray(arch.nodes) ? arch.nodes : [];
  const netSec = parseNetworkSecurity(project);

  const normalizedNodes = nodes.map((n, idx) => ({
    node_id: n.node_id || `node-${idx + 1}`,
    hostname: n.hostname || n.node_id || `node-${idx + 1}`,
    ip_address: n.ip_address || '',
    role: n.role || 'media-services',
    role_description: n.role_description || n.role || '',
    services: Array.isArray(n.services) ? n.services : [],
    instance_counts: {
      udp_edge_cnt: Number(n.instance_counts?.udp_edge_cnt || 0),
      aut_edge_cnt: Number(n.instance_counts?.aut_edge_cnt || 0),
      web_edge_cnt: Number(n.instance_counts?.web_edge_cnt || 0)
    },
    resources: n.resources || {}
  }));

  arch.nodes = normalizedNodes;

  // 拓扑图默认结构（扁平化：不再使用 zones 层级）
  if (forceRebuild || !arch.topology || !Array.isArray(arch.topology.nodes) || arch.topology.nodes.length === 0) {
    arch.topology = {
      nodes: normalizedNodes.map((n) => ({
        node_id: n.node_id,
        hostname: n.hostname,
        services: n.services,
        role: n.role
      })),
      connections: []
    };
  }

  if (forceRebuild || !Array.isArray(arch.topology.connections) || arch.topology.connections.length === 0) {
    arch.topology.connections = [
      { from_service: 'web_edge', to_service: 'local_balancer', protocol: 'tcp', port: '2700', description: 'tcp:2700', flow_type: 'control' },
      { from_service: 'web_edge', to_service: 'local_ap', protocol: 'tcp', port: '8101', description: 'tcp:8101', flow_type: 'control' },
      { from_service: 'web_edge', to_service: 'vosync', protocol: 'tcp', port: '3500', description: 'tcp:3500', flow_type: 'control' },
      { from_service: 'web_edge', to_service: 'cap_sync', protocol: 'tcp', port: '3501', description: 'tcp:3501', flow_type: 'control' },
      { from_service: 'web_edge', to_service: 'arb', protocol: 'tcp', port: '9900', description: 'tcp:9900', flow_type: 'control' },
      { from_service: 'web_edge', to_service: 'event_collector', protocol: 'tcp', port: '4301', description: 'tcp:4301', flow_type: 'mgmt' },

      { from_service: 'udp_edge', to_service: 'vosync', protocol: 'tcp', port: '3500', description: 'tcp:3500', flow_type: 'control' },
      { from_service: 'aut_edge', to_service: 'vosync', protocol: 'tcp', port: '3500', description: 'tcp:3500', flow_type: 'control' },
      { from_service: 'udp_edge', to_service: 'local_ap', protocol: 'tcp', port: '8101', description: 'tcp:8101', flow_type: 'control' },
      { from_service: 'aut_edge', to_service: 'local_ap', protocol: 'tcp', port: '8101', description: 'tcp:8101', flow_type: 'control' },
      { from_service: 'udp_edge', to_service: 'cap_sync', protocol: 'tcp', port: '3501', description: 'tcp:3501', flow_type: 'control' },
      { from_service: 'aut_edge', to_service: 'cap_sync', protocol: 'tcp', port: '3501', description: 'tcp:3501', flow_type: 'control' },
      { from_service: 'udp_edge', to_service: 'arb', protocol: 'tcp', port: '2700', description: 'tcp:2700', flow_type: 'control' },
      { from_service: 'aut_edge', to_service: 'arb', protocol: 'tcp', port: '2700', description: 'tcp:2700', flow_type: 'control' },
      { from_service: 'udp_edge', to_service: 'arb', protocol: 'tcp', port: '9900', description: 'tcp:9900', flow_type: 'control' },
      { from_service: 'aut_edge', to_service: 'arb', protocol: 'tcp', port: '9900', description: 'tcp:9900', flow_type: 'control' },
      { from_service: 'udp_edge', to_service: 'event_collector', protocol: 'tcp', port: '4301', description: 'tcp:4301', flow_type: 'mgmt' },
      { from_service: 'aut_edge', to_service: 'event_collector', protocol: 'tcp', port: '4301', description: 'tcp:4301', flow_type: 'mgmt' },

      { from_service: 'udp_edge', to_service: 'web_edge', protocol: 'udp', port: '4601', description: 'udp:4601', flow_type: 'media' },
      { from_service: 'aut_edge', to_service: 'web_edge', protocol: 'udp', port: '4101', description: 'udp:4101', flow_type: 'media' }
    ];
  }

  // 防火墙规则默认结构（若缺失则自动补齐）
  if (forceRebuild || !Array.isArray(arch.firewall_rules) || arch.firewall_rules.length === 0) {
    const rules = [
      { source: 'Native SDK', destination: 'Local AP', protocol: 'TCP', port: '8003', direction: 'inbound', purpose: 'SDK接入分配' },
      { source: 'Web SDK', destination: 'Local AP', protocol: 'TCP', port: '443', direction: 'inbound', purpose: 'Web SDK接入' },
      { source: 'Native SDK', destination: 'AUT Edge', protocol: 'UDP', port: '4700-4714', direction: 'inbound', purpose: '媒体传输' },
      { source: 'Web SDK', destination: 'Web Edge', protocol: 'TCP/UDP', port: '4500-4514', direction: 'inbound', purpose: 'WebRTC传输' },
      { source: 'SDK', destination: 'Event Collector', protocol: 'TCP/UDP', port: '6443/4301', direction: 'inbound', purpose: '事件收集' }
    ];
    if (project?.deployment_type === 'hybrid') {
      rules.push({ source: 'Edge', destination: 'Proxy VOS', protocol: 'TCP/UDP', port: '5201/5001', direction: 'outbound', purpose: '混合云通信' });
    }
    arch.firewall_rules = rules;
  }

  // mgmt.sh 节点变量（若缺失则自动补齐）
  const coreNode = normalizedNodes.find((n) => n.services.includes('local_ap') || n.role.includes('core')) || normalizedNodes[0];
  const datahubNode = normalizedNodes.find((n) => n.services.includes('datahub')) || normalizedNodes[0];
  if (forceRebuild || !Array.isArray(arch.mgmt_configs) || arch.mgmt_configs.length === 0) {
    arch.mgmt_configs = normalizedNodes.map((n) => ({
      node_id: n.node_id,
      hostname: n.hostname,
      variables: {
        local_ip: n.ip_address || '',
        ap: coreNode?.ip_address || '',
        balancer: coreNode?.ip_address || '',
        sync: coreNode?.ip_address || '',
        event_collector: coreNode?.ip_address || '',
        datahub_ip: datahubNode?.ip_address || '',
        udp_edge_cnt: Number(n.instance_counts?.udp_edge_cnt || 0),
        aut_edge_cnt: Number(n.instance_counts?.aut_edge_cnt || 0),
        web_edge_cnt: Number(n.instance_counts?.web_edge_cnt || 0),
        ...(project?.deployment_type === 'hybrid' ? { vos_ip: '120.92.138.184,120.92.117.169' } : {})
      }
    }));
  }

  return arch;
}

function buildTopologyRedrawRequirements(project) {
  let networkSecurity = null;
  try {
    if (project?.network_security) networkSecurity = JSON.parse(project.network_security);
  } catch (_) {
    networkSecurity = null;
  }
  return {
    customerName: project?.customer_name || '',
    deploymentType: project?.deployment_type || 'pure',
    networkType: project?.network_type || 'intranet',
    networkSecurity
  };
}

function normalizeVisualLayout(architecture) {
  const arch = architecture && typeof architecture === 'object' ? architecture : {};
  const topoNodes = Array.isArray(arch.topology?.nodes) ? arch.topology.nodes : [];
  const nodes = Array.isArray(arch.nodes) ? arch.nodes : [];
  const comps = Array.isArray(arch.network_components) ? arch.network_components : [];
  if (!arch.layout || typeof arch.layout !== 'object') arch.layout = {};
  if (!arch.layout.node_positions) arch.layout.node_positions = {};
  if (!arch.layout.client_positions) arch.layout.client_positions = {};
  if (!arch.layout.component_positions) arch.layout.component_positions = {};

  const nodeW = 190;
  const nodeH = 120;
  const nodeGapX = 30;
  const nodeGapY = 30;
  const baseX = 90;
  const baseY = 130;
  const allNodes = topoNodes.length
    ? topoNodes.map((n) => nodes.find((x) => x.node_id === n.node_id) || n).filter(Boolean)
    : nodes;
  const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(allNodes.length || 1))));
  allNodes.forEach((n, idx) => {
    if (!n?.node_id) return;
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    arch.layout.node_positions[n.node_id] = {
      x: baseX + col * (nodeW + nodeGapX),
      y: baseY + row * (nodeH + nodeGapY)
    };
  });

  comps.forEach((c, i) => {
    const compCol = i % 3;
    const compRow = Math.floor(i / 3);
    const cx = baseX + cols * (nodeW + nodeGapX) + 40 + compCol * 110;
    const cy = baseY + compRow * 46;
    arch.layout.component_positions[c.id] = { x: cx, y: cy };
  });

  const spanX = baseX + cols * (nodeW + nodeGapX);
  arch.layout.client_positions.native_sdk = arch.layout.client_positions.native_sdk || { x: spanX + 80, y: 40 };
  arch.layout.client_positions.web_sdk = arch.layout.client_positions.web_sdk || { x: spanX + 80, y: 96 };
  return arch;
}

function createRTCDeploymentRoutes(app, db, rbacManager, requirePermission, requireAuth) {
  const resourceCalc = new RTCResourceCalculator();
  const aiClient = new QwenAIClient();
  const configGen = new RTCConfigGenerator();

  // ============================================
  // 临时计算接口（无需创建项目）
  // ============================================

  /**
   * 临时资源计算（不保存，用于计算器独立使用）
   */
  app.post('/api/rtc-deployment/calculate-temp',
    requireAuth,
    async (req, res) => {
      try {
        const {
          concurrent_users,
          channels,
          channel_model,
          has_video = true,
          video_resolution = '720p',
          fps = 15,
          deployment_type = 'pure',
          redundancy = 0.3
        } = req.body;

        if (!concurrent_users || !channels || !channel_model) {
          return res.status(400).json({ error: '缺少必填参数: concurrent_users, channels, channel_model' });
        }

        const scenario = {
          concurrentUsers: parseInt(concurrent_users),
          channels: parseInt(channels),
          channelModel: channel_model,
          hasVideo: has_video === true || has_video === 'true',
          videoResolution: video_resolution,
          fps: parseInt(fps),
          deploymentType: deployment_type,
          redundancy: parseFloat(redundancy)
        };

        const result = resourceCalc.calculate(scenario);
        return res.json(result);
      } catch (err) {
        console.error('[RTC] Temp calculation error:', err);
        return res.status(500).json({ error: '计算失败: ' + err.message });
      }
    }
  );

  // ============================================
  // 项目管理
  // ============================================

  /**
   * 创建RTC部署项目
   */
  app.post('/api/rtc-deployment/projects',
    requirePermission('rtc:project:create'),
    async (req, res) => {
      try {
        const {
          project_name,
          customer_name,
          concurrent_users,
          channels,
          channel_model,
          has_video = true,
          video_resolution = '720p',
          fps = 15,
          deployment_type,
          network_type,
          sla_requirement,
          special_requirements,
          network_security,
          appid,
          app_id,
          appCert,
          app_cert
        } = req.body;

        if (!project_name || !customer_name || !concurrent_users || !channels || !channel_model || !deployment_type) {
          return res.status(400).json({ error: 'Missing required fields' });
        }

        const now = new Date().toISOString();
        const result = await db.run(
          `INSERT INTO rtc_deployment_projects 
           (project_name, customer_name, concurrent_users, channels, channel_model,
            has_video, video_resolution, fps, deployment_type, network_type,
            sla_requirement, special_requirements, network_security, appid, app_cert,
            status, created_by, sa_email, sa_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          project_name, customer_name, concurrent_users, channels, channel_model,
          has_video ? 1 : 0, video_resolution, fps, deployment_type, network_type,
          sla_requirement, special_requirements, network_security || null,
          appid || app_id || null,
          app_cert || appCert || null,
          'draft', req.session.user.id,
          req.session.user.email, req.session.user.name, now
        );

        return res.json({ id: result.lastID, project_name });
      } catch (err) {
        console.error('[RTC] Failed to create project:', err);
        return res.status(500).json({ error: 'Failed to create project' });
      }
    }
  );

  /**
   * 获取项目列表
   */
  app.get('/api/rtc-deployment/projects',
    requirePermission('rtc:project:read'),
    async (req, res) => {
      try {
        const { status } = req.query;
        let query = 'SELECT * FROM rtc_deployment_projects WHERE 1=1';
        const params = [];

        if (status) {
          query += ' AND status = ?';
          params.push(status);
        }

        query += ' ORDER BY created_at DESC';

        const projects = await db.all(query, params);
        return res.json(projects);
      } catch (err) {
        console.error('[RTC] Failed to get projects:', err);
        return res.status(500).json({ error: 'Failed to get projects' });
      }
    }
  );

  /**
   * 获取项目详情
   */
  app.get('/api/rtc-deployment/projects/:id',
    requirePermission('rtc:project:read'),
    async (req, res) => {
      try {
        const project = await db.get(
          'SELECT * FROM rtc_deployment_projects WHERE id = ?',
          req.params.id
        );

        if (!project) {
          return res.status(404).json({ error: 'Project not found' });
        }

        // 获取资源评估
        const estimate = await db.get(
          'SELECT * FROM rtc_resource_estimates WHERE project_id = ? ORDER BY calculated_at DESC LIMIT 1',
          project.id
        );

        // 获取当前架构
        const architecture = await db.get(
          'SELECT * FROM rtc_ai_architectures WHERE project_id = ? AND is_current = 1 LIMIT 1',
          project.id
        );

        return res.json({
          project,
          resource_estimate: estimate,
          architecture: architecture ? {
            ...architecture,
            architecture_json: JSON.parse(architecture.architecture_json)
          } : null
        });
      } catch (err) {
        console.error('[RTC] Failed to get project:', err);
        return res.status(500).json({ error: 'Failed to get project' });
      }
    }
  );

  // ============================================
  // 资源计算
  // ============================================

  /**
   * 计算资源需求
   */
  app.post('/api/rtc-deployment/projects/:id/calculate',
    requirePermission('rtc:calculator:use'),
    async (req, res) => {
      try {
        const project = await db.get(
          'SELECT * FROM rtc_deployment_projects WHERE id = ?',
          req.params.id
        );

        if (!project) {
          return res.status(404).json({ error: 'Project not found' });
        }

        // 构建计算场景
        const scenario = {
          concurrentUsers: project.concurrent_users,
          channels: project.channels,
          channelModel: project.channel_model,
          hasVideo: project.has_video === 1,
          videoResolution: project.video_resolution,
          fps: project.fps,
          deploymentType: project.deployment_type,
          redundancy: req.body.redundancy || 0.3
        };

        // 计算资源
        const result = resourceCalc.calculate(scenario);

        // 保存到数据库
        const now = new Date().toISOString();
        await db.run(
          `INSERT INTO rtc_resource_estimates 
           (project_id, total_servers, media_servers, aut_edge_servers, udp_edge_servers,
            total_cpu, total_memory, total_bandwidth, total_storage,
            udp_edge_cnt, aut_edge_cnt, web_edge_cnt, instance_reasoning,
            user_audio_bitrate, user_video_bitrate, user_total_bitrate,
            redundancy_factor, scenario_type, calculation_detail,
            recommendations_json, calculated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          project.id,
          result.summary.totalServers,
          result.summary.mediaServers,
          result.servers.autEdgeServers || 0,
          result.servers.udpEdgeServers || 0,
          result.summary.totalCPU,
          result.summary.totalMemory,
          result.summary.totalBandwidth,
          result.summary.totalStorage,
          result.instances.udp_edge_cnt,
          result.instances.aut_edge_cnt,
          result.instances.web_edge_cnt,
          result.instances.reasoning,
          result.userBitrate.audio,
          result.userBitrate.video,
          result.userBitrate.total,
          scenario.redundancy,
          result.servers.scenario,
          result.servers.calculation,
          JSON.stringify(result.recommendations),
          now
        );

        // 更新项目状态
        await db.run(
          'UPDATE rtc_deployment_projects SET status = ?, updated_at = ? WHERE id = ?',
          'calculating', now, project.id
        );

        return res.json(result);
      } catch (err) {
        console.error('[RTC] Failed to calculate resources:', err);
        return res.status(500).json({ error: 'Failed to calculate resources' });
      }
    }
  );

  // ============================================
  // AI架构生成
  // ============================================

  /**
   * AI生成架构方案
   */
  app.post('/api/rtc-deployment/projects/:id/ai-generate',
    requirePermission('rtc:ai:generate'),
    async (req, res) => {
      try {
        if (!aiClient.isAvailable()) {
          return res.status(503).json({ error: 'AI service not configured' });
        }

        const project = await db.get(
          'SELECT * FROM rtc_deployment_projects WHERE id = ?',
          req.params.id
        );

        if (!project) {
          return res.status(404).json({ error: 'Project not found' });
        }

        // 获取资源评估
        const estimate = await db.get(
          'SELECT * FROM rtc_resource_estimates WHERE project_id = ? ORDER BY calculated_at DESC LIMIT 1',
          project.id
        );

        if (!estimate) {
          return res.status(400).json({ error: 'Please calculate resources first' });
        }

        // 构建需求对象
        let networkSecurity = null;
        try {
          if (project.network_security) networkSecurity = JSON.parse(project.network_security);
        } catch (_) { /* ignore parse error */ }

        const requirements = {
          customerName: project.customer_name,
          concurrentUsers: project.concurrent_users,
          channels: project.channels,
          channelModel: project.channel_model,
          hasVideo: project.has_video === 1,
          videoResolution: project.video_resolution,
          deploymentType: project.deployment_type,
          networkType: project.network_type,
          sla: project.sla_requirement,
          specialRequirements: project.special_requirements,
          networkSecurity
        };

        const resourceEstimateObj = {
          servers: {
            mediaServers: estimate.media_servers,
            autEdgeServers: estimate.aut_edge_servers,
            udpEdgeServers: estimate.udp_edge_servers
          },
          summary: {
            totalCPU: estimate.total_cpu,
            totalMemory: estimate.total_memory,
            totalBandwidth: estimate.total_bandwidth
          }
        };

        // 调用AI生成架构
        const startTime = Date.now();
        const aiResponse = await aiClient.generateArchitecture(requirements, resourceEstimateObj, []);
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);

        if (!aiResponse.success) {
          return res.status(500).json({ 
            error: aiResponse.error || 'AI generation failed',
            details: aiResponse.error,
            rawContent: aiResponse.rawContent
          });
        }

        let architecture = rebuildArchitectureDerivedFields(aiResponse.architecture, project);
        architecture = normalizeVisualLayout(architecture);

        // 保存到数据库
        const now = new Date().toISOString();
        
        // 将旧版本标记为非当前
        await db.run(
          'UPDATE rtc_ai_architectures SET is_current = 0 WHERE project_id = ?',
          project.id
        );

        const result = await db.run(
          `INSERT INTO rtc_ai_architectures 
           (project_id, ai_model, ai_prompt, ai_response_raw, architecture_name,
            architecture_json, reasoning, risks_json, recommendations_json,
            source_type, parent_architecture_id, layout_json,
            is_current, generated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          project.id,
          aiClient.model || 'qwen-max',
          'Architecture Generation',  // 简化，实际prompt很长
          aiResponse.rawContent,
          architecture.architecture_name || '默认方案',
          JSON.stringify(architecture),
          architecture.reasoning || '',
          JSON.stringify(architecture.risks || []),
          JSON.stringify(architecture.recommendations || []),
          'ai_generated',
          null,
          JSON.stringify(architecture.layout || null),
          1,
          now
        );

        // 更新项目状态
        await db.run(
          'UPDATE rtc_deployment_projects SET status = ?, updated_at = ? WHERE id = ?',
          'designing', now, project.id
        );

        return res.json({
          architecture_id: result.lastID,
          architecture,
          duration,
          message: 'Architecture generated successfully'
        });
      } catch (err) {
        console.error('[RTC] Failed to generate architecture:', err);
        const causeCode = err?.cause?.code;
        if (causeCode === 'ENOTFOUND') {
          return res.status(503).json({
            error: 'AI服务不可达，请检查DNS/网络/代理配置',
            details: `Host resolve failed: ${err.cause.hostname}`
          });
        }
        return res.status(500).json({
          error: 'Failed to generate architecture',
          details: err.message
        });
      }
    }
  );

  /**
   * SA审核架构
   */
  app.post('/api/rtc-deployment/architectures/:id/review',
    requirePermission('rtc:ai:review'),
    async (req, res) => {
      try {
        const { approved, comments } = req.body;
        const now = new Date().toISOString();

        await db.run(
          `UPDATE rtc_ai_architectures 
           SET sa_reviewed = 1, sa_approved = ?, sa_comments = ?,
               sa_reviewed_at = ?, sa_reviewed_by = ?
           WHERE id = ?`,
          approved ? 1 : 0,
          comments,
          now,
          req.session.user.id,
          req.params.id
        );

        // 如果审核通过，更新项目状态
        if (approved) {
          const arch = await db.get('SELECT project_id FROM rtc_ai_architectures WHERE id = ?', req.params.id);
          if (arch) {
            await db.run(
              'UPDATE rtc_deployment_projects SET status = ?, updated_at = ? WHERE id = ?',
              'configured', now, arch.project_id
            );
          }
        }

        return res.json({ ok: true });
      } catch (err) {
        console.error('[RTC] Failed to review architecture:', err);
        return res.status(500).json({ error: 'Failed to review architecture' });
      }
    }
  );

  // ============================================
  // 手工微调（节点规划）
  // ============================================

  /**
   * 手工微调节点规划并生成新版本（仅展示最新版本）
   */
  app.post('/api/rtc-deployment/projects/:id/tune-nodes',
    requirePermission('rtc:project:update'),
    async (req, res) => {
      const { nodes, layout_json = null, redraw_topology = true } = req.body || {};
      if (!Array.isArray(nodes) || nodes.length === 0) {
        return res.status(400).json({ error: 'nodes is required' });
      }

      try {
        const project = await db.get('SELECT * FROM rtc_deployment_projects WHERE id = ?', req.params.id);
        if (!project) return res.status(404).json({ error: 'Project not found' });

        const currentArch = await db.get(
          'SELECT * FROM rtc_ai_architectures WHERE project_id = ? AND is_current = 1 LIMIT 1',
          project.id
        );
        if (!currentArch) {
          return res.status(400).json({ error: 'No current architecture found. Please generate AI architecture first.' });
        }

        let baseArch;
        try {
          baseArch = JSON.parse(currentArch.architecture_json);
        } catch (err) {
          return res.status(500).json({ error: 'Current architecture data is invalid' });
        }

        const tuned = { ...baseArch, nodes };
        if (layout_json) tuned.layout = layout_json;
        let nextArch = rebuildArchitectureDerivedFields(tuned, project, true);

        // 节点微调后，提交给AI进行拓扑重绘（可关闭）
        let topologyRedrawInfo = null;
        if (redraw_topology !== false && aiClient.isAvailable()) {
          try {
            const redrawReq = buildTopologyRedrawRequirements(project);
            const redrawResp = await aiClient.redrawTopology(redrawReq, nextArch);
            if (redrawResp?.success && redrawResp.topology) {
              nextArch.topology = redrawResp.topology;
              if (redrawResp.layout) nextArch.layout = redrawResp.layout;
              nextArch = rebuildArchitectureDerivedFields(nextArch, project, false);
              nextArch = normalizeVisualLayout(nextArch);
              topologyRedrawInfo = { ok: true };
            } else {
              topologyRedrawInfo = { ok: false, error: redrawResp?.error || 'topology redraw failed' };
            }
          } catch (redrawErr) {
            topologyRedrawInfo = { ok: false, error: redrawErr.message };
          }
        }

        const now = new Date().toISOString();
        await db.run('BEGIN');
        try {
          await db.run(
            'UPDATE rtc_ai_architectures SET is_current = 0 WHERE project_id = ?',
            project.id
          );

          const ins = await db.run(
            `INSERT INTO rtc_ai_architectures
             (project_id, ai_model, ai_prompt, ai_response_raw, architecture_name,
              architecture_json, reasoning, risks_json, recommendations_json,
              source_type, parent_architecture_id, layout_json,
              is_current, generated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            project.id,
            currentArch.ai_model || 'manual',
            'Manual Node Tuning',
            currentArch.ai_response_raw || '',
            nextArch.architecture_name || '手工微调方案',
            JSON.stringify(nextArch),
            nextArch.reasoning || '',
            JSON.stringify(nextArch.risks || []),
            JSON.stringify(nextArch.recommendations || []),
            'manual_tuned',
            currentArch.id,
            JSON.stringify(nextArch.layout || layout_json || null),
            1,
            now
          );

          await db.run(
            'UPDATE rtc_deployment_projects SET updated_at = ? WHERE id = ?',
            now, project.id
          );

          await db.run('COMMIT');
          return res.json({
            architecture_id: ins.lastID,
            architecture: nextArch,
            topology_redraw: topologyRedrawInfo,
            message: 'Nodes tuned and new version created'
          });
        } catch (txErr) {
          await db.run('ROLLBACK');
          throw txErr;
        }
      } catch (err) {
        console.error('[RTC] Failed to tune nodes:', err);
        return res.status(500).json({ error: 'Failed to tune nodes', details: err.message });
      }
    }
  );

  /**
   * 拖拽拓扑布局自动保存（不创建新版本）
   */
  app.post('/api/rtc-deployment/projects/:id/layout-autosave',
    requirePermission('rtc:project:update'),
    async (req, res) => {
      const { layout_json = null, architecture_patch = null } = req.body || {};
      if (!layout_json || typeof layout_json !== 'object') {
        return res.status(400).json({ error: 'layout_json is required' });
      }

      try {
        const project = await db.get('SELECT * FROM rtc_deployment_projects WHERE id = ?', req.params.id);
        if (!project) return res.status(404).json({ error: 'Project not found' });

        const currentArch = await db.get(
          'SELECT * FROM rtc_ai_architectures WHERE project_id = ? AND is_current = 1 LIMIT 1',
          project.id
        );
        if (!currentArch) {
          return res.status(400).json({ error: 'No current architecture found' });
        }

        let arch;
        try {
          arch = JSON.parse(currentArch.architecture_json);
        } catch (_) {
          return res.status(500).json({ error: 'Current architecture data is invalid' });
        }
        arch.layout = layout_json;
        if (architecture_patch && typeof architecture_patch === 'object') {
          if (Array.isArray(architecture_patch.network_components)) {
            arch.network_components = architecture_patch.network_components;
          }
          if (architecture_patch.topology && typeof architecture_patch.topology === 'object') {
            arch.topology = architecture_patch.topology;
          }
        }
        const now = new Date().toISOString();

        await db.run(
          `UPDATE rtc_ai_architectures
           SET architecture_json = ?, layout_json = ?, generated_at = ?
           WHERE id = ?`,
          JSON.stringify(arch),
          JSON.stringify(layout_json),
          now,
          currentArch.id
        );
        await db.run(
          'UPDATE rtc_deployment_projects SET updated_at = ? WHERE id = ?',
          now,
          project.id
        );

        return res.json({ ok: true, architecture_id: currentArch.id, saved_at: now });
      } catch (err) {
        console.error('[RTC] Failed to autosave layout:', err);
        return res.status(500).json({ error: 'Failed to autosave layout', details: err.message });
      }
    }
  );

  // ============================================
  // 配置生成
  // ============================================

  /**
   * 生成配置文件
   */
  app.post('/api/rtc-deployment/projects/:id/generate-configs',
    requirePermission('rtc:config:generate'),
    async (req, res) => {
      try {
        const project = await db.get(
          'SELECT * FROM rtc_deployment_projects WHERE id = ?',
          req.params.id
        );

        if (!project) {
          return res.status(404).json({ error: 'Project not found' });
        }

        // 获取当前架构
        const archRow = await db.get(
          'SELECT * FROM rtc_ai_architectures WHERE project_id = ? AND is_current = 1 LIMIT 1',
          project.id
        );

        if (!archRow) {
          return res.status(400).json({ error: 'No approved architecture found' });
        }

        const architecture = JSON.parse(archRow.architecture_json);

        // 获取资源评估
        const estimate = await db.get(
          'SELECT * FROM rtc_resource_estimates WHERE project_id = ? ORDER BY calculated_at DESC LIMIT 1',
          project.id
        );

        const resourceEstimate = estimate ? {
          summary: {
            totalServers: estimate.total_servers,
            mediaServers: estimate.media_servers,
            datahubServers: estimate.datahub_servers,
            totalCPU: estimate.total_cpu,
            totalMemory: estimate.total_memory,
            totalBandwidth: estimate.total_bandwidth,
            totalStorage: estimate.total_storage
          },
          instances: {
            udp_edge_cnt: estimate.udp_edge_cnt,
            aut_edge_cnt: estimate.aut_edge_cnt,
            web_edge_cnt: estimate.web_edge_cnt,
            reasoning: estimate.instance_reasoning
          },
          userBitrate: {
            audio: estimate.user_audio_bitrate,
            video: estimate.user_video_bitrate,
            total: estimate.user_total_bitrate
          }
        } : null;

        // 生成所有配置文件
        const configs = configGen.generateAll(architecture, project, resourceEstimate);

        // 保存到数据库
        const now = new Date().toISOString();
        const generatedFiles = [];

        for (const [fileName, content] of Object.entries(configs)) {
          const result = await db.run(
            `INSERT INTO rtc_generated_configs 
             (project_id, config_type, file_name, file_content, file_size, generated_at, generated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            project.id,
            this.getConfigType(fileName),
            fileName,
            content,
            Buffer.byteLength(content, 'utf8'),
            now,
            req.session.user.id
          );

          generatedFiles.push({
            id: result.lastID,
            file_name: fileName,
            file_size: Buffer.byteLength(content, 'utf8'),
            config_type: this.getConfigType(fileName)
          });
        }

        return res.json({
          files: generatedFiles,
          message: 'Configurations generated successfully'
        });
      } catch (err) {
        console.error('[RTC] Failed to generate configs:', err);
        return res.status(500).json({ error: 'Failed to generate configs' });
      }
    }
  );

  /**
   * 下载配置文件
   */
  app.get('/api/rtc-deployment/configs/:id/download',
    requirePermission('rtc:config:download'),
    async (req, res) => {
      try {
        const config = await db.get(
          'SELECT * FROM rtc_generated_configs WHERE id = ?',
          req.params.id
        );

        if (!config) {
          return res.status(404).json({ error: 'Config file not found' });
        }

        // 增加下载计数
        await db.run(
          'UPDATE rtc_generated_configs SET download_count = download_count + 1 WHERE id = ?',
          config.id
        );

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${config.file_name}"`);
        return res.send(config.file_content);
      } catch (err) {
        console.error('[RTC] Failed to download config:', err);
        return res.status(500).json({ error: 'Failed to download config' });
      }
    }
  );

  /**
   * 下载所有配置（打包）
   */
  app.get('/api/rtc-deployment/projects/:id/download-all',
    requirePermission('rtc:config:download'),
    async (req, res) => {
      try {
        const configs = await db.all(
          'SELECT * FROM rtc_generated_configs WHERE project_id = ? ORDER BY generated_at DESC',
          req.params.id
        );

        if (!configs.length) {
          return res.status(404).json({ error: 'No configs found' });
        }

        // 返回所有文件的JSON
        const files = configs.map(c => ({
          file_name: c.file_name,
          content: c.file_content
        }));

        return res.json({ files });
      } catch (err) {
        console.error('[RTC] Failed to download all configs:', err);
        return res.status(500).json({ error: 'Failed to download configs' });
      }
    }
  );

  /**
   * 一键导出完整 mgmt.sh（基于当前版本方案）
   */
  app.get('/api/rtc-deployment/projects/:id/export-mgmt-sh',
    requirePermission('rtc:config:download'),
    async (req, res) => {
      try {
        const project = await db.get('SELECT * FROM rtc_deployment_projects WHERE id = ?', req.params.id);
        if (!project) return res.status(404).json({ error: 'Project not found' });

        const archRow = await db.get(
          'SELECT * FROM rtc_ai_architectures WHERE project_id = ? AND is_current = 1 LIMIT 1',
          project.id
        );
        if (!archRow) {
          return res.status(400).json({ error: 'No current architecture found' });
        }

        let architecture = JSON.parse(archRow.architecture_json);
        architecture = rebuildArchitectureDerivedFields(architecture, project);
        const mgmt = configGen.generateMgmtSh(architecture, project);

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=\"mgmt.sh\"`);
        return res.send(mgmt);
      } catch (err) {
        console.error('[RTC] Failed to export mgmt.sh:', err);
        return res.status(500).json({ error: 'Failed to export mgmt.sh', details: err.message });
      }
    }
  );

  // ============================================
  // AI配置验证
  // ============================================

  /**
   * AI验证配置
   */
  app.post('/api/rtc-deployment/projects/:id/ai-validate',
    requirePermission('rtc:ai:validate'),
    async (req, res) => {
      try {
        if (!aiClient.isAvailable()) {
          return res.status(503).json({ error: 'AI service not configured' });
        }

        const { config_content, config_type = 'mgmt_sh' } = req.body;

        if (!config_content) {
          return res.status(400).json({ error: 'Missing config_content' });
        }

        // 调用AI验证
        const validation = await aiClient.validateConfiguration(config_content, config_type);

        if (!validation.success) {
          return res.status(500).json({
            error: 'AI validation failed',
            details: validation.error
          });
        }

        // 保存验证结果
        const now = new Date().toISOString();
        await db.run(
          `INSERT INTO rtc_ai_validations 
           (project_id, validation_type, ai_model, validation_result, validation_score,
            errors_json, warnings_json, suggestions_json, validated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          req.params.id,
          config_type,
          aiClient.model || 'qwen-max',
          validation.validation.validation_result,
          validation.validation.score || 0,
          JSON.stringify(validation.validation.errors || []),
          JSON.stringify(validation.validation.warnings || []),
          JSON.stringify(validation.validation.suggestions || []),
          now
        );

        return res.json(validation.validation);
      } catch (err) {
        console.error('[RTC] Failed to validate config:', err);
        return res.status(500).json({ error: 'Failed to validate config' });
      }
    }
  );

  // ============================================
  // 辅助方法
  // ============================================

  this.getConfigType = function(fileName) {
    if (fileName.endsWith('.sh')) return 'mgmt_sh';
    if (fileName.endsWith('.json')) return 'json_config';
    if (fileName.endsWith('.md')) return 'deployment_doc';
    if (fileName.endsWith('.txt')) return 'resource_list';
    return 'other';
  };
}

module.exports = { createRTCDeploymentRoutes };
