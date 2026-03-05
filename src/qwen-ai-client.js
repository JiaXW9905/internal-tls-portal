/**
 * 千问AI客户端（通义千问）
 * 用于RTC私有化部署的AI辅助决策
 * 支持通过环境变量 HTTPS_PROXY / HTTP_PROXY 走代理（内网环境）
 */

const fs = require('fs');
const path = require('path');
const { fetch: undiciFetch, EnvHttpProxyAgent } = require('undici');
const JSON5 = require('json5');
const { jsonrepair } = require('jsonrepair');

class QwenAIClient {
  constructor(apiKey = null, model = 'qwen-max') {
    // 如果没有传入apiKey，尝试从配置文件读取
    this.proxy = null;
    if (!apiKey) {
      try {
        const configPath = path.join(__dirname, '..', '.ai_config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        this.apiKey = config.qwen.api_key;
        this.endpoint = config.qwen.endpoint;
        this.model = config.qwen.model || model;
        if (config.qwen.proxy) this.proxy = config.qwen.proxy;
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

    const proxyOpts = this.proxy ? { httpsProxy: this.proxy } : {};
    const proxyAgent = new EnvHttpProxyAgent(proxyOpts);
    try {
      const response = await undiciFetch(this.endpoint, {
        dispatcher: proxyAgent,
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

      const content = result.output?.choices?.[0]?.message?.content;
      if (content == null || typeof content !== 'string') {
        throw new Error(result.message || 'AI返回内容为空或格式异常');
      }

      return {
        content,
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
      temperature: 0.6,
      max_tokens: 4500
    });

    return this.parseArchitectureResponse(response.content);
  }

  /**
   * 基于当前节点规划重绘拓扑布局（用于节点微调后联动优化）
   */
  async redrawTopology(requirements, architecture) {
    const systemPrompt = '你是一位RTC私有化部署可视化架构专家，擅长生成清晰、可读、精确的网络拓扑结构。';
    const prompt = this.buildTopologyRedrawPrompt(requirements, architecture);
    const response = await this.callQwen(prompt, systemPrompt, {
      temperature: 0.3,
      max_tokens: 2600
    });
    return this.parseTopologyRedrawResponse(response.content);
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
      sla,
      specialRequirements,
      networkSecurity
    } = requirements;

    const similarCasesText = similarCases.length > 0
      ? `\n【历史相似案例】（供参考）\n${similarCases.map((c, i) => 
          `案例${i+1}: ${c.summary}\n- 规模: ${c.users}用户, ${c.channels}频道\n- 方案: ${c.architecture_summary}`
        ).join('\n\n')}`
      : '';

    // 构建网络安全要求描述
    let networkSecurityText = '';
    if (networkSecurity) {
      const parts = [];
      if (networkSecurity.has_air_gap) {
        parts.push(`- 网闸隔离: 是${networkSecurity.air_gap_description ? '（' + networkSecurity.air_gap_description + '）' : ''}`);
      }
      if (networkSecurity.has_proxy) {
        parts.push(`- 代理: 是${networkSecurity.proxy_address ? '（地址: ' + networkSecurity.proxy_address + '）' : ''}`);
      }
      if (networkSecurity.has_firewall) {
        parts.push(`- 防火墙: 是${networkSecurity.firewall_description ? '（' + networkSecurity.firewall_description + '）' : ''}`);
      }
      if (parts.length > 0) {
        networkSecurityText = `\n\n【网络安全要求】\n${parts.join('\n')}`;
      }
    }

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
${specialRequirements ? `- 特殊需求: ${specialRequirements}` : ''}
${networkSecurityText}

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
${networkSecurity?.has_air_gap ? '8. 网闸隔离场景：内外网分区部署，核心服务在内网，通过网闸与外网SDK交互' : ''}
${networkSecurity?.has_proxy ? '9. 代理场景：混合云通信需经代理转发，mgmt.sh中需配置代理变量' : ''}
${networkSecurity?.has_firewall ? '10. 防火墙场景：所有跨区访问端口需明确列出，方便客户申请放通' : ''}
11. 可视化布局约束：节点/网络组件不得重叠，连线尽量美观且不遮挡节点标题和服务文本
12. 连线表达约束：媒体流量、业务控制流量、运维管理流量需使用不同 style/color 语义（例如 media/control/mgmt）
13. 空间利用约束：优先采用横向或网格化布局，避免所有区域单列堆叠导致画布过高

【请设计并以JSON格式输出】

架构方案必须包含：

1. **节点规划**: 每台服务器的角色、IP、部署的服务组件
2. **实例配置**: 每个edge服务的实例数量（udp/aut/web_edge_cnt）
3. **网络拓扑**: 扁平节点拓扑（不使用区域层级），包含节点与连接关系
4. **防火墙规则**: 所有需要放通的端口规则（源/目标/协议/端口/方向/用途）
5. **mgmt.sh配置**: 每个节点的mgmt.sh关键变量值
6. **高可用**: 关键服务的主备配置
7. **部署顺序**: 推荐的部署步骤
8. **风险评估**: 潜在瓶颈和缓解措施

**严格要求**：
- 必须返回合法的JSON格式
- 节点IP不能冲突
- 必须包含所有必需的核心服务
- edge实例总数不能超过服务器承载能力
- topology 与 layout 需要满足不重叠、不越界、连线尽量规避文本遮挡
- topology.connections 可附带 from_service/to_service/protocol/port/flow_type 字段，用于精细渲染服务级链路

**JSON结构示例**：

\`\`\`json
{
  "architecture_name": "方案名称",
  "summary": "方案摘要",
  "reasoning": "设计理由",
  "nodes": [
    {
      "node_id": "node-1",
      "hostname": "rtc-core-01",
      "ip_address": "192.168.1.10",
      "role": "core-services",
      "role_description": "核心管理服务",
      "services": ["local_ap", "local_balancer", "vosync", "cap_sync", "event_collector"],
      "instance_counts": { "udp_edge_cnt": 0, "aut_edge_cnt": 0, "web_edge_cnt": 0 },
      "resources": { "cpu": 16, "memory": 32, "storage": 240, "bandwidth": 1000 }
    }
  ],
  "topology": {
    "nodes": [
      { "node_id": "node-1", "hostname": "rtc-core-01", "services": ["local_ap", "local_balancer"] },
      { "node_id": "node-2", "hostname": "rtc-media-01", "services": ["udp_edge", "aut_edge", "web_edge"] }
    ],
    "connections": [
      { "from_service": "web_edge", "to_service": "local_balancer", "protocol": "tcp", "port": "2700", "description": "tcp:2700", "flow_type": "control" }
    ]
  },
  "firewall_rules": [
    { "source": "SDK客户端", "destination": "Local AP", "protocol": "TCP", "port": "8003", "direction": "inbound", "purpose": "SDK接入分配" },
    { "source": "SDK客户端", "destination": "Local AP", "protocol": "TCP", "port": "443", "direction": "inbound", "purpose": "Web SDK接入" },
    { "source": "SDK客户端", "destination": "AUT Edge", "protocol": "UDP", "port": "4700-4714", "direction": "inbound", "purpose": "AUT媒体传输" },
    { "source": "SDK客户端", "destination": "Web Edge", "protocol": "TCP/UDP", "port": "4500-4514", "direction": "inbound", "purpose": "WebRTC传输" }
  ],
  "mgmt_configs": [
    {
      "node_id": "node-1",
      "hostname": "rtc-core-01",
      "variables": {
        "local_ip": "192.168.1.10",
        "ap": "192.168.1.10",
        "balancer": "192.168.1.10",
        "sync": "192.168.1.10",
        "event_collector": "192.168.1.10",
        "datahub_ip": "192.168.4.10",
        "udp_edge_cnt": 0,
        "aut_edge_cnt": 0,
        "web_edge_cnt": 0
      }
    }
  ],
  "network": {
    "ip_allocations": { "core_services": "192.168.1.0/24", "media_services": "192.168.2.0/23" },
    "mgmt_variables": { "ap": "192.168.1.10", "balancer": "192.168.1.10", "sync": "192.168.1.10", "datahub_ip": "192.168.4.10" }
  },
  "ha_config": { "enabled": true, "critical_services": ["local_ap", "local_balancer"], "backup_node": "node-2" },
  "deployment_order": ["1. 核心服务节点", "2. 媒体服务节点", "3. 数据平台", "4. 监控服务"],
  "risks": [{ "risk": "风险描述", "severity": "high", "mitigation": "缓解措施" }],
  "recommendations": ["优化建议1"]
}
\`\`\`

请只返回JSON，不要有其他内容。
`;
  }

  /**
   * 构建“拓扑重绘”Prompt（基于已确定的节点方案）
   */
  buildTopologyRedrawPrompt(requirements, architecture) {
    const projectInfo = {
      customerName: requirements.customerName,
      deploymentType: requirements.deploymentType,
      networkType: requirements.networkType,
      networkSecurity: requirements.networkSecurity || null
    };
    return `
请根据以下“已确定的节点规划”重新设计拓扑图布局，目标是：
1) 精确反映扁平节点关系（不使用区域层级）
2) 字体大小适宜、布局清晰、可读性高
3) 尽量减少连线交叉
4) 输出可供前端Canvas渲染的数据

【项目信息】
${JSON.stringify(projectInfo, null, 2)}

【当前方案（仅供重绘参考，节点数据必须保留）】
${JSON.stringify(architecture, null, 2)}

【硬性要求】
- 不允许删除或改名 nodes 中已有节点
- 不允许更改节点IP和服务清单
- 可以优化 topology.nodes / topology.connections / layout
- 如果存在网闸/防火墙/代理，需通过 network_components 或 connections 描述
- 必须返回合法JSON
- 节点、网络组件之间不得发生重叠
- 连线尽量规避节点标题和服务文字，避免遮挡
- media/control/mgmt 流量要有不同的样式语义（可通过 flow_type 字段表达）
- 优先横向或网格化分布区域，避免单列纵向挤压

【输出JSON格式】
\`\`\`json
{
  "topology": {
    "nodes": [
      { "node_id": "node-1", "hostname": "rtc-core-01", "services": ["local_ap", "local_balancer"] },
      { "node_id": "node-2", "hostname": "rtc-media-01", "services": ["udp_edge", "aut_edge", "web_edge"] }
    ],
    "connections": [
      { "from_service": "web_edge", "to_service": "local_balancer", "protocol": "tcp", "port": "2700", "description": "tcp:2700", "flow_type": "control" }
    ]
  },
  "layout": {
    "node_positions": { "node-1": { "x": 120, "y": 180 } },
    "component_positions": { "comp-firewall-1": { "x": 420, "y": 140 } },
    "client_positions": {
      "native_sdk": { "x": 760, "y": 40 },
      "web_sdk": { "x": 760, "y": 96 }
    }
  }
}
\`\`\`

只返回JSON，不要其他文字。
`;
  }

  /**
   * 在未进入字符串的前提下，从 start 起找匹配的闭合括号下标
   */
  _findMatchingCloseBracket(str, start, openChar, closeChar) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < str.length; i++) {
      const c = str[i];
      if (escape) { escape = false; continue; }
      if (inString) {
        if (c === '\\') escape = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') { inString = true; continue; }
      if (c === openChar) depth++;
      else if (c === closeChar) {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  /**
   * 仅移除“不在字符串内”的尾逗号（, 后紧跟空白和 ] 或 }），避免误伤字符串内容
   */
  _removeTrailingCommasOutsideStrings(jsonStr) {
    let out = '';
    let i = 0;
    while (i < jsonStr.length) {
      const c = jsonStr[i];
      if (c === '"') {
        out += c;
        i++;
        while (i < jsonStr.length) {
          const s = jsonStr[i];
          if (s === '\\') { out += s; if (i + 1 < jsonStr.length) out += jsonStr[i + 1]; i += 2; continue; }
          if (s === '"') { out += s; i++; break; }
          out += s;
          i++;
        }
        continue;
      }
      if (c === ',') {
        const rest = jsonStr.slice(i + 1);
        const match = rest.match(/^\s*(\]|\})/);
        if (match) {
          out += match[1];
          i += 1 + match[0].length;
          continue;
        }
      }
      out += c;
      i++;
    }
    return out;
  }

  /**
   * 从文本中提取第一个完整 JSON 对象或数组（字符串感知）
   */
  _extractJsonPayload(text) {
    const firstObject = text.indexOf('{');
    const firstArray = text.indexOf('[');
    if (firstObject === -1 && firstArray === -1) return text;
    const start = (firstArray !== -1 && (firstArray < firstObject || firstObject === -1)) ? firstArray : firstObject;
    const openChar = text[start];
    const closeChar = openChar === '{' ? '}' : ']';
    const end = this._findMatchingCloseBracket(text, start, openChar, closeChar);
    if (end === -1) return text.slice(start);
    return text.slice(start, end + 1);
  }

  /**
   * 解析AI架构响应
   */
  parseArchitectureResponse(content) {
    try {
      let jsonStr = (content && typeof content === 'string' ? content : String(content)).trim();
      if (!jsonStr) throw new Error('AI返回内容为空');

      // 若被 ```json``` 或 ``` 包裹，先提取
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      // 字符串感知：提取第一个完整 JSON 对象或数组
      jsonStr = this._extractJsonPayload(jsonStr);

      // 先尝试直接解析
      let architecture;
      const fixed = this._removeTrailingCommasOutsideStrings(jsonStr);
      try {
        architecture = JSON.parse(jsonStr);
      } catch (parseErr) {
        try {
          architecture = JSON.parse(fixed);
        } catch (parseErr2) {
          try {
            // JSON5容忍单引号、尾逗号、未加引号的key等
            architecture = JSON5.parse(fixed);
          } catch (_) {
            try {
              // jsonrepair 尝试修复常见结构性错误
              const repaired = jsonrepair(fixed);
              architecture = JSON.parse(repaired);
            } catch (repairErr) {
              throw parseErr;
            }
          }
        }
      }
      if (!architecture || typeof architecture !== 'object') {
        throw new Error('AI返回的不是有效JSON对象');
      }
      if (!Array.isArray(architecture.nodes)) {
        architecture.nodes = [];
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
   * 解析拓扑重绘响应
   */
  parseTopologyRedrawResponse(content) {
    try {
      let jsonStr = (content && typeof content === 'string' ? content : String(content)).trim();
      if (!jsonStr) throw new Error('AI返回内容为空');
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) jsonStr = jsonMatch[1].trim();
      jsonStr = this._extractJsonPayload(jsonStr);

      const fixed = this._removeTrailingCommasOutsideStrings(jsonStr);
      let payload = null;
      try {
        payload = JSON.parse(jsonStr);
      } catch (_) {
        try {
          payload = JSON.parse(fixed);
        } catch (_) {
          try {
            payload = JSON5.parse(fixed);
          } catch (_) {
            const repaired = jsonrepair(fixed);
            payload = JSON.parse(repaired);
          }
        }
      }

      if (!payload || typeof payload !== 'object') {
        throw new Error('拓扑重绘返回内容不是JSON对象');
      }
      if (!payload.topology || (!Array.isArray(payload.topology.nodes) && !Array.isArray(payload.topology.connections))) {
        throw new Error('拓扑重绘返回缺少 topology.nodes/connections');
      }

      return {
        success: true,
        topology: payload.topology,
        layout: payload.layout || null,
        rawContent: content
      };
    } catch (err) {
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
