/**
 * RTC部署管理服务路由
 */

const { RTCResourceCalculator } = require('../rtc-resource-calculator');
const { QwenAIClient } = require('../qwen-ai-client');
const { RTCConfigGenerator } = require('../rtc-config-generator');

function createRTCDeploymentRoutes(app, db, rbacManager, requirePermission, requireAuth) {
  const resourceCalc = new RTCResourceCalculator();
  const aiClient = new QwenAIClient();
  const configGen = new RTCConfigGenerator();

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
          special_requirements
        } = req.body;

        if (!project_name || !customer_name || !concurrent_users || !channels || !channel_model || !deployment_type) {
          return res.status(400).json({ error: 'Missing required fields' });
        }

        const now = new Date().toISOString();
        const result = await db.run(
          `INSERT INTO rtc_deployment_projects 
           (project_name, customer_name, concurrent_users, channels, channel_model,
            has_video, video_resolution, fps, deployment_type, network_type,
            sla_requirement, special_requirements, status, created_by, sa_email, sa_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          project_name, customer_name, concurrent_users, channels, channel_model,
          has_video ? 1 : 0, video_resolution, fps, deployment_type, network_type,
          sla_requirement, special_requirements, 'draft', req.session.user.id,
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
        const requirements = {
          customerName: project.customer_name,
          concurrentUsers: project.concurrent_users,
          channels: project.channels,
          channelModel: project.channel_model,
          hasVideo: project.has_video === 1,
          videoResolution: project.video_resolution,
          deploymentType: project.deployment_type,
          networkType: project.network_type,
          sla: project.sla_requirement
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
            error: 'AI generation failed',
            details: aiResponse.error,
            rawContent: aiResponse.rawContent
          });
        }

        const architecture = aiResponse.architecture;

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
            is_current, generated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          project.id,
          'qwen-plus',
          'Architecture Generation',  // 简化，实际prompt很长
          aiResponse.rawContent,
          architecture.architecture_name || '默认方案',
          JSON.stringify(architecture),
          architecture.reasoning || '',
          JSON.stringify(architecture.risks || []),
          JSON.stringify(architecture.recommendations || []),
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
          'qwen-plus',
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
