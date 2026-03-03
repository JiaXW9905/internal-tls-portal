/**
 * 千问AI客户端（通义千问）
 * 用于RTC私有化部署的AI辅助决策
 */

const fs = require('fs');
const path = require('path');

class QwenAIClient {
  constructor(apiKey = null, model = 'qwen-plus') {
    // 如果没有传入apiKey，尝试从配置文件读取
    if (!apiKey) {
      try {
        const configPath = path.join(__dirname, '..', '.ai_config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        this.apiKey = config.qwen.api_key;
        this.endpoint = config.qwen.endpoint;
        this.model = config.qwen.model || model;
      } catch (err) {
        console.warn('[QwenAI] No API config found, AI features will be disabled');
        this.apiKey = null;
      }
    } else {
      this.apiKey = apiKey;
      this.endpoint = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
      this.model = model;
    }
  }

  /**
   * 检查AI是否可用
   */
  isAvailable() {
    return !!this.apiKey;
  }

  /**
   * 调用千问API（通用方法）
   */
  async callQwen(prompt, systemPrompt = null, options = {}) {
    if (!this.apiKey) {
      throw new Error('Qwen API key not configured');
    }

    const messages = [];
    
    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt
      });
    }
    
    messages.push({
      role: 'user',
      content: prompt
    });

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: options.model || this.model,
          input: { messages },
          parameters: {
            temperature: options.temperature || 0.7,
            max_tokens: options.max_tokens || 2000,
            result_format: 'message'
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Qwen API error: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      
      if (result.code) {
        throw new Error(`Qwen API error code: ${result.code}, message: ${result.message}`);
      }

      return {
        content: result.output.choices[0].message.content,
        usage: result.usage,
        requestId: result.request_id
      };
    } catch (err) {
      console.error('[QwenAI] API call failed:', err);
      throw err;
    }
  }

  /**
   * 生成RTC部署架构方案
   */
  async generateArchitecture(requirements, resourceEstimate, similarCases = []) {
    const systemPrompt = '你是一位在Agora工作10年的资深RTC私有化部署架构师，精通SD-RTN技术架构和私有化部署方案设计。你需要基于客户需求和资源评估，设计出最优的部署架构方案。';

    const prompt = this.buildArchitecturePrompt(requirements, resourceEstimate, similarCases);

    const response = await this.callQwen(prompt, systemPrompt, {
      temperature: 0.7,
      max_tokens: 3000
    });

    return this.parseArchitectureResponse(response.content);
  }

  /**
   * 构建架构设计Prompt
   */
  buildArchitecturePrompt(requirements, resourceEstimate, similarCases) {
    const {
      customerName,
      concurrentUsers,
      channels,
      channelModel,
      hasVideo,
      videoResolution,
      deploymentType,
      networkType,
      sla
    } = requirements;

    const similarCasesText = similarCases.length > 0
      ? `\n【历史相似案例】（供参考）\n${similarCases.map((c, i) => 
          `案例${i+1}: ${c.summary}\n- 规模: ${c.users}用户, ${c.channels}频道\n- 方案: ${c.architecture_summary}`
        ).join('\n\n')}`
      : '';

    return `
请为以下RTC私有化部署需求设计详细的架构方案：

【客户需求】
- 客户名称: ${customerName}
- 并发用户数: ${concurrentUsers}
- 频道数量: ${channels}
- 频道模型: ${channelModel}（如：1v1+录制、3v7+录制）
- 媒体类型: ${hasVideo ? `视频(${videoResolution})` : '纯音频'}
- 部署类型: ${deploymentType === 'pure' ? '纯私有部署' : '混合云部署'}
- 网络环境: ${networkType}
- SLA要求: ${sla || '99%可用性'}

【资源评估结果】
- 需要媒体服务器: ${resourceEstimate.servers.mediaServers}台
- 需要数据平台: 1台
- 总CPU: ${resourceEstimate.summary.totalCPU}核
- 总内存: ${resourceEstimate.summary.totalMemory}GB
- 总带宽: ${resourceEstimate.summary.totalBandwidth}Mbps
${similarCasesText}

【可用服务组件】(Agora RTC私有化标准组件)

核心管理服务（必须部署）:
1. agora_local_ap - SDK接入第一站，负责分配edge节点地址
2. agora_local_balancer - 媒体服务注册和发现中心
3. agora_vosync - 频道事件同步服务（创建/销毁事件）
4. agora_cap_sync - 频道能力同步服务

媒体处理服务（按需部署）:
5. agora_udp_media_edge - Native SDK UDP协议媒体接入（旧版兼容）
6. agora_aut_media_edge - Native SDK AUT协议媒体接入（新版，抗丢包能力强）
7. agora_web_media_edge - Web SDK WebRTC协议媒体接入

数据和调度服务:
8. agora_event_collector - SDK和服务事件收集
9. agora_arb - 负载均衡（CPU/带宽超限时迁移）
10. agora_infra_helper - 日志清理等辅助工作

监控服务（推荐部署）:
11. agora_influxdb - 监控数据存储
12. agora_netdata - 服务器资源监控
13. agora_cadvisor - Docker容器监控
14. agora_grafana - 监控可视化

【部署约束和最佳实践】
1. 核心服务(local_ap/balancer/vosync/cap_sync)建议部署在同一台或2台专用服务器（高可用）
2. 媒体服务(udp/aut/web edge)根据带宽需求分布部署，单台最多14个edge进程
3. 单edge进程最大200并发连接，单台服务器最大视频带宽2.5Gbps
4. 监控服务可与核心服务共用服务器，或独立1台
5. 数据平台独立1台服务器（需要500GB存储）
6. 混合云部署需配置vos_ip连接公网SD-RTN
7. IP地址分配建议使用192.168.x.x网段，避免与客户现有网络冲突

【请设计并以JSON格式输出】

架构方案必须包含：

1. **节点规划**: 每台服务器的角色、IP、部署的服务组件
2. **实例配置**: 每个edge服务的实例数量（udp/aut/web_edge_cnt）
3. **网络方案**: IP分配、防火墙端口、服务间连接关系
4. **高可用**: 关键服务的主备配置
5. **部署顺序**: 推荐的部署步骤
6. **风险评估**: 潜在瓶颈和缓解措施

**严格要求**：
- 必须返回合法的JSON格式
- 节点IP不能冲突
- 必须包含所有必需的核心服务
- edge实例总数不能超过服务器承载能力

**JSON结构示例**：

\`\`\`json
{
  "architecture_name": "方案名称（简短）",
  "summary": "方案摘要（1-2句话）",
  "reasoning": "设计理由（为什么这样设计，考虑了哪些因素）",
  "nodes": [
    {
      "node_id": "node-1",
      "hostname": "rtc-core-01",
      "ip_address": "192.168.1.10",
      "role": "core-services",
      "role_description": "核心管理服务",
      "services": ["local_ap", "local_balancer", "vosync", "cap_sync", "event_collector"],
      "instance_counts": {
        "udp_edge_cnt": 0,
        "aut_edge_cnt": 0,
        "web_edge_cnt": 0
      },
      "resources": {
        "cpu": 16,
        "memory": 32,
        "storage": 240,
        "bandwidth": 1000
      }
    }
  ],
  "network": {
    "ip_allocations": {
      "core_services": "192.168.1.0/24",
      "media_services": "192.168.2.0/23",
      "datahub": "192.168.4.0/24"
    },
    "mgmt_variables": {
      "ap": "192.168.1.10",
      "balancer": "192.168.1.10",
      "sync": "192.168.1.10",
      "event_collector": "192.168.1.10",
      "datahub_ip": "192.168.4.10"
    }
  },
  "ha_config": {
    "enabled": true,
    "critical_services": ["local_ap", "local_balancer"],
    "backup_node": "node-2"
  },
  "deployment_order": [
    "1. 核心服务节点",
    "2. 媒体服务节点",
    "3. 数据平台",
    "4. 监控服务"
  ],
  "risks": [
    {
      "risk": "风险描述",
      "severity": "high/medium/low",
      "mitigation": "缓解措施"
    }
  ],
  "recommendations": [
    "优化建议1",
    "优化建议2"
  ]
}
\`\`\`

请只返回JSON，不要有其他内容。
`;
  }

  /**
   * 解析AI架构响应
   */
  parseArchitectureResponse(content) {
    try {
      // 尝试提取JSON内容
      let jsonStr = content.trim();
      
      // 如果被包裹在```json```中，提取出来
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }
      
      // 解析JSON
      const architecture = JSON.parse(jsonStr);
      
      // 验证必需字段
      if (!architecture.nodes || !Array.isArray(architecture.nodes)) {
        throw new Error('Invalid architecture: missing nodes array');
      }
      
      return {
        success: true,
        architecture: architecture,
        rawContent: content
      };
    } catch (err) {
      console.error('[QwenAI] Failed to parse architecture:', err);
      
      return {
        success: false,
        error: err.message,
        rawContent: content
      };
    }
  }

  /**
   * AI配置验证
   */
  async validateConfiguration(configContent, configType = 'mgmt_sh') {
    const systemPrompt = '你是RTC私有化部署配置审查专家，负责检查配置文件的正确性和安全性。';

    const prompt = `
请检查以下RTC私有化部署配置是否正确：

配置类型: ${configType}

\`\`\`bash
${configContent}
\`\`\`

检查要点：
1. IP地址配置是否合理
2. 服务依赖关系是否正确
3. 实例数量是否合理
4. 证书配置是否完整
5. 混合云配置是否正确（如适用）
6. 是否有潜在的性能瓶颈
7. 是否有安全风险

请返回JSON格式的检查结果：

\`\`\`json
{
  "validation_result": "pass/warning/fail",
  "score": 85,
  "errors": [
    {
      "field": "字段名",
      "line": 行号,
      "message": "错误描述",
      "severity": "error",
      "suggestion": "修复建议"
    }
  ],
  "warnings": [
    {
      "field": "字段名",
      "message": "警告描述",
      "severity": "warning",
      "suggestion": "优化建议"
    }
  ],
  "suggestions": [
    {
      "field": "字段名",
      "impact": "high/medium/low",
      "message": "改进建议"
    }
  ]
}
\`\`\`

只返回JSON，不要有其他内容。
`;

    const response = await this.callQwen(prompt, systemPrompt, {
      temperature: 0.3,  // 降低温度提高准确性
      max_tokens: 2000
    });

    return this.parseValidationResponse(response.content);
  }

  /**
   * 解析验证响应
   */
  parseValidationResponse(content) {
    try {
      let jsonStr = content.trim();
      
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }
      
      const validation = JSON.parse(jsonStr);
      
      return {
        success: true,
        validation: validation,
        rawContent: content
      };
    } catch (err) {
      console.error('[QwenAI] Failed to parse validation:', err);
      
      return {
        success: false,
        error: err.message,
        rawContent: content
      };
    }
  }

  /**
   * AI故障诊断（运维阶段使用）
   */
  async diagnoseProblem(problemDescription, logs, metrics) {
    const systemPrompt = 'you are an RTC troubleshooting expert, helping diagnose and solve deployment issues.';

    const prompt = `
RTC私有化集群出现问题，请帮助诊断：

问题描述:
${problemDescription}

相关日志:
${logs}

性能指标:
${JSON.stringify(metrics, null, 2)}

请分析可能的原因和解决方案，返回JSON格式：

\`\`\`json
{
  "probable_causes": ["原因1", "原因2"],
  "solutions": [
    {
      "solution": "解决方案描述",
      "steps": ["步骤1", "步骤2"],
      "confidence": "high/medium/low"
    }
  ],
  "preventive_measures": ["预防措施1", "预防措施2"]
}
\`\`\`
`;

    const response = await this.callQwen(prompt, systemPrompt);
    
    try {
      let jsonStr = response.content.trim();
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }
      return JSON.parse(jsonStr);
    } catch (err) {
      return {
        rawContent: response.content,
        parsed: false
      };
    }
  }
}

module.exports = { QwenAIClient };
