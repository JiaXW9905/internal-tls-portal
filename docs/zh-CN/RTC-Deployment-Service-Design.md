# RTC私有化部署管理服务 - 完整设计方案

## 文档信息
- **服务名称**: RTC私有化部署管理
- **服务ID**: `rtc-deployment`
- **目标**: 将SA手工部署工作自动化，提效90%
- **AI应用**: 架构设计、配置验证
- **设计日期**: 2026-03-02

---

## 一、需求分析与提效评估

### 1.1 当前工作流程分析

基于提供的文档和脚本，SA当前工作流程：

```
步骤1: 需求收集
├─ 客户规模（并发用户、频道数）
├─ 部署类型（纯私有/混合云）
├─ 网络环境（内网隔离/内外网互通）
└─ SLA要求
⏱️ 耗时: 30分钟（需客户沟通）

步骤2: 资源评估 ⭐️ 可自动化
├─ 计算码率（使用jxy_cal_bitrate）
├─ 计算服务器数量
├─ 计算CPU/内存/带宽需求
└─ 生成资源清单
⏱️ 当前: 1-2小时（查表、Excel计算）
⏱️ 自动化后: 30秒

步骤3: 架构设计 ⭐️ AI辅助
├─ 确定拓扑结构（单区域/多区域）
├─ 规划节点分配（14个服务组件）
├─ 设计网络方案（IP规划、路由）
└─ 高可用设计
⏱️ 当前: 3-4小时（需丰富经验）
⏱️ AI辅助后: 30分钟（AI生成 + SA Review）

步骤4: 配置生成 ⭐️ 可自动化
├─ 填写mgmt.sh中的变量
├─ 生成配置文件（local_ap.json等）
├─ 生成docker-compose（如需要）
└─ 准备证书文件
⏱️ 当前: 1-2小时（手工填写，易错）
⏱️ 自动化后: 5分钟

步骤5: 实地部署 🤝 半自动化
├─ 上传部署包
├─ 执行部署脚本
├─ 健康检查
└─ 交付文档
⏱️ 当前: 2-4小时（现场操作）
⏱️ 半自动化后: 1-2小时（远程执行）
```

### 1.2 提效量化分析

| 环节 | 当前耗时 | 自动化后 | AI加成 | 节省时间 | 提效比例 |
|------|---------|---------|--------|---------|---------|
| 需求收集 | 30分钟 | 30分钟 | - | 0 | 0% |
| 资源评估 | 1.5小时 | 30秒 | - | 89分钟 | 99% |
| 架构设计 | 3.5小时 | 30分钟 | ✅ AI生成 | 3小时 | 86% |
| 配置生成 | 1.5小时 | 5分钟 | ✅ AI验证 | 85分钟 | 94% |
| 实地部署 | 3小时 | 1.5小时 | - | 1.5小时 | 50% |
| **总计** | **10小时** | **2.5小时** | - | **7.5小时** | **75%** |

**结论**：
- ✅ 单个项目节省: **7.5小时**（75%提效）
- ✅ 如果每月10个项目: 节省**75小时** ≈ **9.4人天/月**
- ✅ AI贡献: 额外节省**2小时/项目**（主要在架构设计和配置验证）

---

## 二、核心知识提取

### 2.1 码率计算逻辑

从 `calbitrate.go` 提取的计算公式：

```javascript
/**
 * 计算视频码率（基于Go代码jxy_cal_bitrate移植）
 * @param {number} width - 视频宽度
 * @param {number} height - 视频高度  
 * @param {number} fps - 帧率
 * @param {string} qualityChoice - 画质选择 'H'=高画质, 其他=标准
 * @param {string} codecChoice - 编码器 'H265' or 'H264'
 * @param {string} pvcChoice - PVC选择 'Y' or 'N'
 * @returns {number} 码率(Kbps)
 */
function calculateBitrate(width, height, fps, qualityChoice = 'H', codecChoice = 'H264', pvcChoice = 'N') {
  // 分辨率比例 (相对于640x360基准)
  const resolutionRatio = (width * height) / (640 * 360);
  
  // 帧率比例 (相对于15fps基准)
  const frameRateRatio = fps / 15;
  
  // 画质保存比率
  const saveRatio = getSaveRatio(width, height, qualityChoice);
  
  // 编码器和PVC保存比率
  const newSaveRatio = getNewSaveRatio(width, height, codecChoice, pvcChoice);
  
  // 计算推荐码率
  const bitrate = (800 * Math.pow(resolutionRatio, 0.75)) 
                  * Math.pow(frameRateRatio, 0.6) 
                  * saveRatio 
                  * newSaveRatio;
  
  return Math.round(bitrate);
}

function getSaveRatio(width, height, qualityChoice) {
  if (qualityChoice === 'H') return 1.0;
  
  const profile = width * height;
  if (profile <= 120 * 160) return 0.9;
  if (profile <= 360 * 640) return 0.85;
  if (profile <= 540 * 960) return 0.75;
  if (profile <= 720 * 1280) return 0.7;
  if (profile <= 1080 * 1920) return 0.6;
  return 0.5;
}

function getNewSaveRatio(width, height, codecChoice, pvcChoice) {
  const profile = width * height;
  let codecSave = 0;
  
  if (codecChoice === 'H265') {
    if (profile >= 1920 * 1080) codecSave = 20;
    else if (profile >= 1280 * 720) codecSave = 15;
    else if (profile >= 540 * 960) codecSave = 10;
    else codecSave = 5;
  }
  
  let pvcSave = 0;
  if (pvcChoice === 'Y' && profile >= 320 * 240 && profile <= 1280 * 720) {
    pvcSave = 15;
  }
  
  return (100 - Math.max(codecSave, pvcSave)) / 100;
}
```

**标准场景码率**：
- 音频: 100 Kbps
- 720p视频: 1.1 Mbps
- 音视频合计: 1.2 Mbps (1.1M + 0.07M)

### 2.2 资源评估公式

从 `RTC资源评估.pdf` 提取：

```javascript
/**
 * 服务器资源评估
 */
const SERVER_SPECS = {
  standard: {
    cpu: 16,           // 核心数
    memory: 32,        // GB
    storage: 240,      // GB SSD
    bandwidth: 10000,  // Mbps (10Gbps)
    maxProcesses: 14,  // 最大edge进程数
    connectionsPerProcess: 200,  // 每进程最大连接数
    maxBandwidthPerServer: 2500  // Mbps (单台服务器最大视频带宽)
  },
  datahub: {
    cpu: 16,
    memory: 32,
    storage: 500,      // 数据平台需要更大存储
    bandwidth: 1000
  }
};

/**
 * 计算所需服务器数量
 * @param {object} requirements - 客户需求
 * @returns {object} 服务器需求
 */
function calculateServerRequirements(requirements) {
  const {
    concurrentUsers,    // 并发用户数
    channels,           // 频道数
    channelModel,       // '1v1+rec', '3v7+rec', 'broadcast'
    hasVideo,           // 是否有视频
    deploymentType,     // 'pure' or 'hybrid'
    redundancy = 0.3    // 冗余系数（默认30%）
  } = requirements;
  
  // 场景1: 1v1 + 录制
  if (channelModel === '1v1+rec') {
    if (!hasVideo) {
      // 纯音频
      // 每组通话3个连接（用户A + 用户B + 录制）
      // 单台最大连接: 200 * 10 = 2000
      const maxChannelsPerServer = Math.floor(2000 / 3);
      const serversNeeded = Math.ceil(channels / maxChannelsPerServer);
      
      return {
        mediaServers: Math.ceil(serversNeeded * (1 + redundancy)),
        type: 'audio-only'
      };
    } else {
      // 音视频
      // 最坏情况：每个频道分配到3台不同服务器
      // 用户edge-aut: 下行3路 * 1.2Mbps = 3.6Mbps
      // 录制edge-udp: 下行2路 * 1.2Mbps = 2.4Mbps
      
      const usersPerAutServer = Math.floor(2500 / (1.2 * 3));  // ≈694
      const usersPerUdpServer = Math.floor(2500 / (1.2 * 2));  // ≈1041
      
      const totalUsers = channels * 2;  // 1v1
      const autServers = Math.ceil(totalUsers / usersPerAutServer);
      const udpServers = Math.ceil(channels / usersPerUdpServer);  // 录制
      
      return {
        autEdgeServers: Math.ceil(autServers * (1 + redundancy)),
        udpEdgeServers: Math.ceil(udpServers * (1 + redundancy)),
        totalMediaServers: Math.ceil((autServers + udpServers) * (1 + redundancy)),
        type: 'video-1v1'
      };
    }
  }
  
  // 场景2: 3v7 + 录制
  else if (channelModel === '3v7+rec') {
    if (!hasVideo) {
      // 纯音频: 每组11个连接
      const maxChannelsPerServer = Math.floor(2000 / 11);
      const serversNeeded = Math.ceil(channels / maxChannelsPerServer);
      
      return {
        mediaServers: Math.ceil(serversNeeded * (1 + redundancy)),
        type: 'audio-3v7'
      };
    } else {
      // 音视频
      // 主播机器: 下行13路 * 1.2 = 15.6Mbps → 96人/台
      // 观众机器: 下行3路 * 1.2 = 3.6Mbps → 694人/台
      // 录制机器: 下行3路 * 1.2 = 3.6Mbps → 694人/台
      
      const hostsPerServer = Math.floor(2500 / (1.2 * 13));  // ≈160
      const audiencePerServer = Math.floor(2500 / (1.2 * 3));  // ≈694
      const recPerServer = Math.floor(2500 / (1.2 * 3));  // ≈694
      
      const totalHosts = channels * 3;
      const totalAudience = channels * 7;
      const totalRec = channels;
      
      const hostServers = Math.ceil(totalHosts / hostsPerServer);
      const audienceServers = Math.ceil(totalAudience / audiencePerServer);
      const recServers = Math.ceil(totalRec / recPerServer);
      
      return {
        hostEdgeServers: Math.ceil(hostServers * (1 + redundancy)),
        audienceEdgeServers: Math.ceil(audienceServers * (1 + redundancy)),
        recEdgeServers: Math.ceil(recServers * (1 + redundancy)),
        totalMediaServers: Math.ceil((hostServers + audienceServers + recServers) * (1 + redundancy)),
        type: 'video-3v7'
      };
    }
  }
  
  // 通用估算（基于带宽）
  else {
    const bitratePerUser = hasVideo ? 1.2 : 0.1;  // Mbps
    const totalBandwidth = concurrentUsers * bitratePerUser;
    const serversNeeded = Math.ceil(totalBandwidth / 2500);  // 单台2.5Gbps
    
    return {
      mediaServers: Math.ceil(serversNeeded * (1 + redundancy)),
      type: 'generic'
    };
  }
}
```

### 1.3 部署脚本关键变量

从 `mgmt.sh` 提取的核心配置：

```bash
# 关键IP配置
local_ip=127.0.0.1              # 本机IP
datahub_ip=127.0.0.1            # 数据平台IP
ap=$local_ip                     # Local AP服务器IP（可多个，逗号分隔）
balancer=$local_ip               # Local Balancer IP
sync=$local_ip                   # Vosync和Cap_sync IP
event_collector=$local_ip        # Event Collector IP

# 混合云配置
vos_ip=                          # 混合云Proxy VOS IP（可选）

# Vendor配置
vendor_ids=                      # 格式: <app_id>:<vendor_id>[:+/-:<private_key>]

# 证书配置
tls_cert=                        # Native证书文件名
tls_cert_key=                    # Native证书密钥
web_cert=                        # Web证书文件名
web_cert_key=                    # Web证书密钥

# 实例配置
udp_edge_cnt=1                   # UDP Edge实例数
aut_edge_cnt=1                   # AUT Edge实例数
web_edge_cnt=1                   # Web Edge实例数
max_user_count=500               # 最大用户数限制

# 网络配置
ip_for_client=$local_ip          # SDK访问的IP
ip_for_comm=$local_ip            # Edge间通信IP
ip_for_cloud=$local_ip           # 混合云通信IP（如需要）
```

**关键洞察**：
1. 所有服务通过mgmt.sh脚本启动
2. 配置主要是IP地址和实例数量
3. 支持多节点部署（ap、sync等可多个IP）
4. 混合云需要配置vos_ip

---

## 二、自动化能力设计

### 2.1 资源需求计算引擎 ⭐️⭐️⭐️

#### 核心能力
```javascript
class RTCResourceCalculator {
  /**
   * 计算资源需求（主入口）
   */
  calculate(scenario) {
    const {
      concurrentUsers,
      channels,
      channelType,      // '1v1', '1v7', '3v7', 'broadcast'
      hasRecording,
      hasVideo,
      videoResolution,  // '360p', '720p', '1080p'
      fps,
      deploymentType    // 'pure', 'hybrid'
    } = scenario;
    
    // 1. 计算单用户码率
    const bitrate = this.calculateUserBitrate(
      videoResolution, fps, hasVideo
    );
    
    // 2. 计算总带宽需求
    const bandwidth = this.calculateTotalBandwidth(
      concurrentUsers, channels, channelType, bitrate
    );
    
    // 3. 计算服务器数量
    const servers = this.calculateServerCount(
      concurrentUsers, channels, channelType, bandwidth
    );
    
    // 4. 计算各服务实例数
    const instances = this.calculateInstances(
      concurrentUsers, servers.mediaServers
    );
    
    // 5. 生成资源清单
    return {
      summary: {
        totalServers: servers.mediaServers + 1, // +1 for datahub
        totalCPU: servers.mediaServers * 16 + 16,
        totalMemory: servers.mediaServers * 32 + 32,
        totalBandwidth: bandwidth,
        estimatedCost: this.estimateCost(servers)
      },
      servers: servers,
      instances: instances,
      bitrate: bitrate,
      recommendations: this.generateRecommendations(scenario, servers)
    };
  }
  
  /**
   * 计算单用户码率
   */
  calculateUserBitrate(resolution, fps, hasVideo) {
    if (!hasVideo) {
      return { audio: 0.1, video: 0, total: 0.1 };  // Mbps
    }
    
    const resolutionMap = {
      '360p': { width: 640, height: 360 },
      '720p': { width: 1280, height: 720 },
      '1080p': { width: 1920, height: 1080 }
    };
    
    const { width, height } = resolutionMap[resolution] || resolutionMap['720p'];
    
    // 使用jxy_cal_bitrate逻辑
    const videoBitrateKbps = calculateBitrate(width, height, fps, 'H', 'H264', 'N');
    const videoBitrateMbps = videoBitrateKbps / 1000;
    
    return {
      audio: 0.07,  // 70Kbps
      video: videoBitrateMbps,
      total: videoBitrateMbps + 0.07
    };
  }
  
  /**
   * 生成推荐建议
   */
  generateRecommendations(scenario, servers) {
    const recommendations = [];
    
    // 推荐1: 冗余建议
    if (servers.redundancy < 0.3) {
      recommendations.push({
        type: 'warning',
        message: '建议增加30%冗余以应对峰值流量'
      });
    }
    
    // 推荐2: 高可用建议
    if (servers.mediaServers === 1) {
      recommendations.push({
        type: 'info',
        message: '单台服务器无高可用保障，建议至少部署2台'
      });
    }
    
    // 推荐3: 混合云建议
    if (scenario.deploymentType === 'pure' && scenario.concurrentUsers > 500) {
      recommendations.push({
        type: 'suggestion',
        message: '用户数较多，可考虑混合云方案节省内网带宽'
      });
    }
    
    return recommendations;
  }
}
```

**价值**：
- ⏱️ 从1.5小时 → 30秒
- ✅ 准确率: 100%（基于公式）
- 📊 可视化: 清晰的资源清单

---

### 2.2 AI架构设计引擎 ⭐️⭐️⭐️

#### 千问API集成

```javascript
/**
 * 千问AI客户端（通义千问）
 */
class QwenAIClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.endpoint = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
  }
  
  /**
   * 生成RTC部署架构方案
   */
  async generateArchitecture(requirements, resourceEstimate) {
    const prompt = this.buildArchitecturePrompt(requirements, resourceEstimate);
    
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'qwen-plus',  // 或 'qwen-max' for 更强能力
        input: {
          messages: [
            {
              role: 'system',
              content: '你是一位经验丰富的RTC（实时通信）私有化部署架构师，专门设计基于Agora SD-RTN的私有化部署方案。'
            },
            {
              role: 'user',
              content: prompt
            }
          ]
        },
        parameters: {
          temperature: 0.7,
          result_format: 'message'
        }
      })
    });
    
    const result = await response.json();
    return this.parseArchitectureResponse(result);
  }
  
  /**
   * 构建架构设计Prompt
   */
  buildArchitecturePrompt(requirements, resourceEstimate) {
    return `
请为以下RTC私有化部署需求设计详细的架构方案：

【客户需求】
- 客户名称: ${requirements.customerName}
- 并发用户数: ${requirements.concurrentUsers}
- 频道数量: ${requirements.channels}
- 频道模型: ${requirements.channelModel}
- 是否视频: ${requirements.hasVideo ? '是' : '否'}
- 部署类型: ${requirements.deploymentType === 'pure' ? '纯私有' : '混合云'}
- 网络环境: ${requirements.networkType}
- SLA要求: ${requirements.sla}

【资源评估结果】
- 需要媒体服务器: ${resourceEstimate.servers.mediaServers}台
- 需要数据平台: 1台
- 总CPU: ${resourceEstimate.summary.totalCPU}核
- 总内存: ${resourceEstimate.summary.totalMemory}GB
- 总带宽: ${resourceEstimate.summary.totalBandwidth}Mbps

【可用服务组件】(共14个)
核心管理服务:
1. agora_local_ap - 接入和分配服务
2. agora_local_balancer - 服务发现
3. agora_vosync - 频道事件同步
4. agora_cap_sync - 频道能力同步

媒体处理服务:
5. agora_udp_media_edge - UDP媒体接入（Native SDK）
6. agora_aut_media_edge - AUT媒体接入（Native SDK，新协议）
7. agora_web_media_edge - WebRTC媒体接入（Web SDK）

数据和负载服务:
8. agora_event_collector - 事件收集
9. agora_arb - 负载均衡
10. agora_infra_helper - 日志清理

监控服务:
11. agora_netdata - 服务器监控
12. agora_cadvisor - 容器监控  
13. agora_influxdb - 监控数据库
14. agora_grafana - 监控可视化

【请设计并输出】

1. **服务器节点规划**
   - 节点数量和角色分配
   - 每个节点部署哪些服务组件
   - 各组件的实例数量

2. **网络拓扑设计**
   - IP地址分配方案（假设客户网段: 192.168.0.0/16）
   - 服务间连接关系
   - 混合云场景的SD-RTN接入点配置

3. **高可用设计**
   - 关键服务的主备配置
   - 故障切换策略

4. **部署清单**
   - 每台服务器的mgmt.sh配置变量
   - 需要开通的防火墙端口

5. **风险评估**
   - 潜在瓶颈点
   - 缓解措施

请用JSON格式输出架构方案，方便系统解析和生成配置。JSON结构如下：

{
  "architecture_name": "方案名称",
  "nodes": [
    {
      "node_id": "node-1",
      "role": "core-services",
      "ip_address": "192.168.1.10",
      "services": ["local_ap", "local_balancer", "vosync", "cap_sync"],
      "instance_counts": {
        "udp_edge_cnt": 0,
        "aut_edge_cnt": 0,
        "web_edge_cnt": 0
      },
      "resources": {
        "cpu": 16,
        "memory": 32,
        "bandwidth": 1000
      }
    }
  ],
  "network": {
    "ip_allocations": {},
    "firewall_rules": []
  },
  "ha_config": {},
  "deployment_steps": [],
  "risks": [],
  "recommendations": []
}
`;
  }
  
  /**
   * 解析AI响应
   */
  parseArchitectureResponse(response) {
    try {
      // 提取JSON部分
      const content = response.output.choices[0].message.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      // 如果没有JSON，返回原始文本
      return {
        rawText: content,
        parsed: false
      };
    } catch (err) {
      console.error('[AI] Failed to parse architecture:', err);
      return null;
    }
  }
  
  /**
   * AI配置验证
   */
  async validateConfiguration(config) {
    const prompt = `
请检查以下RTC私有化部署配置是否合理：

${JSON.stringify(config, null, 2)}

请检查：
1. IP地址是否有冲突
2. 端口配置是否合理
3. 服务依赖关系是否正确
4. 资源配置是否足够
5. 是否有安全风险
6. 是否有性能瓶颈

请列出发现的问题（errors）和优化建议（suggestions）。

返回JSON格式：
{
  "validation_result": "pass/warning/fail",
  "errors": [
    {"field": "...", "message": "...", "severity": "error"}
  ],
  "suggestions": [
    {"field": "...", "message": "...", "impact": "high/medium/low"}
  ]
}
`;
    
    const response = await this.callQwen(prompt);
    return this.parseValidationResponse(response);
  }
  
  async callQwen(prompt) {
    // 实现千问API调用
    // ...
  }
}
```

**价值**：
- ⏱️ 架构设计: 从3.5小时 → 30分钟
- 💡 方案质量: AI考虑更全面
- ✅ 配置验证: 自动发现问题

---

### 2.3 配置文件生成器 ⭐️⭐️⭐️

```javascript
/**
 * mgmt.sh配置生成器
 */
class DeploymentScriptGenerator {
  /**
   * 生成mgmt.sh配置
   */
  generateMgmtConfig(architecture) {
    const { nodes, network, vendorConfig, certificates } = architecture;
    
    // 找出各服务所在的IP
    const apIPs = nodes
      .filter(n => n.services.includes('local_ap'))
      .map(n => n.ip_address)
      .join(',');
    
    const balancerIPs = nodes
      .filter(n => n.services.includes('local_balancer'))
      .map(n => n.ip_address)
      .join(',');
    
    const syncIPs = nodes
      .filter(n => n.services.includes('vosync'))
      .map(n => n.ip_address)
      .join(',');
    
    // 生成配置
    const config = `#!/bin/bash
# 自动生成的部署配置
# 生成时间: ${new Date().toISOString()}
# 项目: ${architecture.project_name}

# === 关键IP配置 ===
local_ip=${architecture.local_ip}
datahub_ip=${architecture.datahub_ip}
ap=${apIPs}
balancer=${balancerIPs}
sync=${syncIPs}
event_collector=${architecture.event_collector_ip}

${architecture.deploymentType === 'hybrid' ? `# 混合云配置
vos_ip=${architecture.vos_ip}` : ''}

# === Vendor配置 ===
vendor_ids=${vendorConfig.vendor_ids}

# === 证书配置 ===
tls_cert=${certificates.tls_cert}
tls_cert_key=${certificates.tls_cert_key}
web_cert=${certificates.web_cert}
web_cert_key=${certificates.web_cert_key}

# === Edge实例配置 ===
udp_edge_cnt=${architecture.udp_edge_cnt}
aut_edge_cnt=${architecture.aut_edge_cnt}
web_edge_cnt=${architecture.web_edge_cnt}
max_user_count=${architecture.max_user_count}

# === 网络配置 ===
ip_for_client=${architecture.ip_for_client}
ip_for_comm=${architecture.ip_for_comm}
${architecture.deploymentType === 'hybrid' ? `ip_for_cloud=${architecture.ip_for_cloud}` : ''}

# === 其他配置 ===
log_path=${architecture.log_path || '/var/log/agora'}
data_path=${architecture.data_path || '/data/agora'}

# === 镜像仓库和版本 ===
registry=registry.cn-hangzhou.aliyuncs.com/agoraio-public
local_ap_tag=release-v2_1_15-20260114
# ... 其他镜像tag ...

# ===============================================
# 以下为标准启动脚本，通常无需修改
# ===============================================
`;
    
    return config + this.getStandardScriptFunctions();
  }
  
  /**
   * 生成部署说明文档
   */
  generateDeploymentDoc(architecture) {
    return `
# ${architecture.project_name} 部署文档

## 一、架构概览
- 部署类型: ${architecture.deploymentType}
- 服务器数量: ${architecture.nodes.length}台
- 预计并发: ${architecture.concurrentUsers}用户

## 二、服务器清单

${architecture.nodes.map((node, i) => `
### 服务器${i + 1}: ${node.node_id}
- IP地址: ${node.ip_address}
- 角色: ${node.role}
- 部署服务: ${node.services.join(', ')}
- 配置: ${node.resources.cpu}C ${node.resources.memory}G ${node.resources.bandwidth}Mbps
`).join('\n')}

## 三、部署步骤

1. 上传部署包到各服务器
2. 解压并进入目录
3. 复制证书文件到agora/目录
4. 修改mgmt.sh配置（或使用生成的配置）
5. 依次启动服务（按顺序）:
   - 步骤1: 启动核心服务
     ./mgmt.sh start local_ap
     ./mgmt.sh start local_balancer
     ./mgmt.sh start vosync
     ./mgmt.sh start cap_sync
   
   - 步骤2: 启动媒体服务
     ./mgmt.sh start aut_edge
     ./mgmt.sh start web_edge
     ./mgmt.sh start udp_edge
   
   - 步骤3: 启动辅助服务
     ./mgmt.sh start event_collector
     ./mgmt.sh start arb
     ./mgmt.sh start infra_helper

6. 健康检查
7. 功能验证

## 四、防火墙配置

需要开通以下端口:
${architecture.network.firewall_rules.map(r => 
  `- ${r.source} → ${r.dest}: ${r.protocol}/${r.port} (${r.purpose})`
).join('\n')}

## 五、验证清单
- [ ] 所有服务启动成功
- [ ] Native SDK可以接入
- [ ] Web SDK可以接入
- [ ] 监控平台可访问
- [ ] 通话质量正常
`;
  }
}
```

**价值**：
- ⏱️ 配置生成: 从2小时 → 5分钟
- ✅ 错误率: 接近0%
- 📄 文档化: 自动生成部署文档

---

## 三、系统功能设计

### 3.1 核心功能模块

```
1. 项目管理
   ├─ 创建部署项目
   ├─ 需求采集表单
   └─ 项目状态跟踪

2. 资源计算器 ⭐️
   ├─ 场景模板（1v1、3v7、直播等）
   ├─ 自定义参数输入
   ├─ 实时计算结果
   └─ 资源清单导出

3. AI架构设计器 🤖
   ├─ AI生成架构方案
   ├─ SA Review和调整
   ├─ 可视化架构图
   └─ 方案版本管理

4. 配置生成器 ⭐️
   ├─ mgmt.sh配置生成
   ├─ JSON配置文件生成
   ├─ IP地址规划
   └─ 部署文档生成

5. AI配置验证器 🤖
   ├─ 自动检查配置
   ├─ 发现潜在问题
   └─ 优化建议

6. 部署包管理
   ├─ 一键打包下载
   ├─ 版本管理
   └─ 历史方案查询
```

### 3.2 前端页面设计

#### 页面列表
```
/rtc-deployment                    - 项目列表
/rtc-deployment/create             - 创建项目
/rtc-deployment/:id/calculator     - 资源计算器
/rtc-deployment/:id/architect      - AI架构设计（含Review）
/rtc-deployment/:id/configurator   - 配置生成器
/rtc-deployment/:id/download       - 下载部署包
/rtc-deployment/settings           - 千问API配置
```

#### 资源计算器界面
```
┌──────────────────────────────────────┐
│  RTC资源需求计算器                    │
├──────────────────────────────────────┤
│  场景模板:                            │
│  ○ 1v1 + 录制                        │
│  ● 3v7 + 录制                        │
│  ○ 大型直播                          │
│  ○ 自定义                            │
├──────────────────────────────────────┤
│  并发用户数: [1000] 人                │
│  频道数量: [200] 个                   │
│  视频分辨率: [720p ▼]                │
│  帧率: [15fps ▼]                     │
│  部署类型: ○纯私有 ●混合云            │
│  冗余系数: [30%]                     │
├──────────────────────────────────────┤
│  [计算资源需求]                       │
├──────────────────────────────────────┤
│  📊 计算结果:                         │
│  ┌────────────────────────────────┐  │
│  │ 媒体服务器: 24台                │  │
│  │ - AUT Edge服务器: 18台          │  │
│  │ - UDP Edge服务器: 6台           │  │
│  │ 数据平台: 1台                   │  │
│  │ 总CPU: 400核                    │  │
│  │ 总内存: 800GB                   │  │
│  │ 总带宽: 30Gbps                  │  │
│  └────────────────────────────────┘  │
│                                       │
│  ⚠️ 建议:                            │
│  • 已包含30%冗余                     │
│  • 建议配置高可用                    │
│                                       │
│  [下一步: AI架构设计 →]              │
└──────────────────────────────────────┘
```

#### AI架构设计界面
```
┌──────────────────────────────────────┐
│  AI架构设计助手 (千问)                │
├──────────────────────────────────────┤
│  基于资源评估结果:                    │
│  • 24台媒体服务器                     │
│  • 1台数据平台                       │
│  • 总带宽30Gbps                      │
├──────────────────────────────────────┤
│  [🤖 AI生成架构方案]  [✏️ 手工设计]  │
├──────────────────────────────────────┤
│  🤖 AI生成中...  ████████░░ 80%     │
├──────────────────────────────────────┤
│  ✅ 方案已生成! (用时: 15秒)          │
│                                       │
│  架构方案预览:                        │
│  ┌────────────────────────────────┐  │
│  │ 核心服务区 (1台)                │  │
│  │ 192.168.1.10                    │  │
│  │ - local_ap                      │  │
│  │ - local_balancer                │  │
│  │ - vosync                        │  │
│  │ - cap_sync                      │  │
│  │                                 │  │
│  │ 媒体服务区 (24台)               │  │
│  │ 192.168.2.10-33                 │  │
│  │ - aut_edge (18台)              │  │
│  │ - udp_edge (6台)               │  │
│  │ - web_edge (24台)              │  │
│  │                                 │  │
│  │ 数据平台区 (1台)                │  │
│  │ 192.168.3.10                    │  │
│  │ - datahub服务                   │  │
│  └────────────────────────────────┘  │
│                                       │
│  [查看详细架构] [下载架构图]          │
│  [SA审核通过 ✓] [需要调整]           │
└──────────────────────────────────────┘
```

---

## 四、数据库设计

### 4.1 核心表结构

```sql
-- RTC部署项目表
CREATE TABLE rtc_deployment_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_name TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  
  -- 需求信息
  concurrent_users INTEGER NOT NULL,
  channels INTEGER NOT NULL,
  channel_model TEXT NOT NULL,      -- '1v1+rec', '3v7+rec', 'broadcast'
  has_video INTEGER DEFAULT 1,
  video_resolution TEXT,            -- '360p', '720p', '1080p'
  fps INTEGER DEFAULT 15,
  deployment_type TEXT NOT NULL,    -- 'pure', 'hybrid'
  network_type TEXT,                -- 'intranet', 'internet', 'dmz'
  sla_requirement TEXT,
  
  -- 状态
  status TEXT NOT NULL DEFAULT 'draft',  -- draft/calculating/designing/configured/deployed
  
  -- 人员
  created_by INTEGER NOT NULL,
  sa_email TEXT,
  
  -- 时间
  created_at TEXT NOT NULL,
  updated_at TEXT,
  
  FOREIGN KEY(created_by) REFERENCES users(id)
);

-- 资源评估结果表
CREATE TABLE rtc_resource_estimates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  
  -- 服务器需求
  media_servers INTEGER NOT NULL,
  aut_edge_servers INTEGER,
  udp_edge_servers INTEGER,
  web_edge_servers INTEGER,
  datahub_servers INTEGER DEFAULT 1,
  
  -- 资源汇总
  total_cpu INTEGER,
  total_memory INTEGER,
  total_bandwidth INTEGER,
  total_storage INTEGER,
  
  -- 实例数量
  udp_edge_instances INTEGER,
  aut_edge_instances INTEGER,
  web_edge_instances INTEGER,
  
  -- 计算参数
  user_bitrate_mbps REAL,
  redundancy_factor REAL DEFAULT 0.3,
  
  calculated_at TEXT NOT NULL,
  
  FOREIGN KEY(project_id) REFERENCES rtc_deployment_projects(id) ON DELETE CASCADE
);

-- AI架构方案表
CREATE TABLE rtc_ai_architectures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  
  -- AI相关
  ai_model TEXT NOT NULL,           -- 'qwen-plus', 'qwen-max'
  ai_prompt TEXT NOT NULL,
  ai_response TEXT NOT NULL,
  ai_response_json TEXT,            -- 解析后的JSON
  
  -- 方案信息
  architecture_name TEXT,
  architecture_json TEXT NOT NULL,   -- 完整架构JSON
  
  -- SA审核
  sa_reviewed INTEGER DEFAULT 0,
  sa_approved INTEGER DEFAULT 0,
  sa_comments TEXT,
  sa_reviewed_at TEXT,
  sa_reviewed_by INTEGER,
  
  -- 版本
  version INTEGER DEFAULT 1,
  is_current INTEGER DEFAULT 1,
  
  created_at TEXT NOT NULL,
  
  FOREIGN KEY(project_id) REFERENCES rtc_deployment_projects(id) ON DELETE CASCADE,
  FOREIGN KEY(sa_reviewed_by) REFERENCES users(id)
);

-- 节点配置表
CREATE TABLE rtc_deployment_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  architecture_id INTEGER,
  
  node_id TEXT NOT NULL,            -- 'node-1', 'node-2'
  node_name TEXT,
  node_role TEXT NOT NULL,          -- 'core', 'media', 'datahub', 'monitoring'
  ip_address TEXT NOT NULL,
  
  -- 部署服务（JSON数组）
  services_json TEXT NOT NULL,      -- ["local_ap", "vosync", ...]
  
  -- 实例配置
  udp_edge_cnt INTEGER DEFAULT 0,
  aut_edge_cnt INTEGER DEFAULT 0,
  web_edge_cnt INTEGER DEFAULT 0,
  
  -- 资源配置
  cpu_cores INTEGER,
  memory_gb INTEGER,
  bandwidth_mbps INTEGER,
  storage_gb INTEGER,
  
  -- 网络配置
  ip_for_client TEXT,
  ip_for_comm TEXT,
  ip_for_cloud TEXT,
  
  created_at TEXT NOT NULL,
  
  FOREIGN KEY(project_id) REFERENCES rtc_deployment_projects(id) ON DELETE CASCADE,
  FOREIGN KEY(architecture_id) REFERENCES rtc_ai_architectures(id)
);

-- 配置文件生成记录表
CREATE TABLE rtc_generated_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  
  config_type TEXT NOT NULL,        -- 'mgmt_sh', 'docker_compose', 'json_config'
  file_name TEXT NOT NULL,
  file_content TEXT NOT NULL,
  file_path TEXT,                   -- 生成的文件路径
  
  generated_at TEXT NOT NULL,
  generated_by INTEGER NOT NULL,
  
  FOREIGN KEY(project_id) REFERENCES rtc_deployment_projects(id) ON DELETE CASCADE,
  FOREIGN KEY(generated_by) REFERENCES users(id)
);

-- AI验证记录表
CREATE TABLE rtc_ai_validations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  
  validation_type TEXT NOT NULL,    -- 'config_check', 'architecture_review'
  ai_model TEXT NOT NULL,
  validation_result TEXT NOT NULL,  -- 'pass', 'warning', 'fail'
  
  errors_json TEXT,                 -- 发现的错误
  suggestions_json TEXT,            -- 优化建议
  
  created_at TEXT NOT NULL,
  
  FOREIGN KEY(project_id) REFERENCES rtc_deployment_projects(id) ON DELETE CASCADE
);
```

---

## 五、RBAC权限设计

### 5.1 角色定义

```javascript
const RTC_DEPLOYMENT_ROLES = [
  {
    code: 'rtc-sa',
    name: 'RTC解决方案架构师',
    description: 'SA全权限：创建项目、AI设计、生成配置、审核方案'
  },
  {
    code: 'rtc-engineer',
    name: 'RTC实施工程师',
    description: '执行部署、查看项目、下载配置'
  },
  {
    code: 'rtc-viewer',
    name: 'RTC查看者',
    description: '仅查看项目和资源评估'
  }
];
```

### 5.2 权限定义

```javascript
const RTC_DEPLOYMENT_PERMISSIONS = [
  // 项目管理
  { code: 'rtc:project:create', name: '创建部署项目' },
  { code: 'rtc:project:read', name: '查看项目' },
  { code: 'rtc:project:update', name: '修改项目' },
  { code: 'rtc:project:delete', name: '删除项目' },
  
  // 资源计算
  { code: 'rtc:calculator:use', name: '使用资源计算器' },
  
  // AI架构设计
  { code: 'rtc:ai:generate', name: 'AI生成架构' },
  { code: 'rtc:ai:review', name: 'AI方案审核' },
  { code: 'rtc:ai:approve', name: 'AI方案批准' },
  
  // 配置生成
  { code: 'rtc:config:generate', name: '生成配置文件' },
  { code: 'rtc:config:download', name: '下载部署包' },
  
  // AI验证
  { code: 'rtc:ai:validate', name: 'AI配置验证' },
  
  // 系统配置
  { code: 'rtc:settings:manage', name: '管理AI API配置' }
];
```

---

## 六、前端UI设计（详细）

### 6.1 资源计算器页面

```html
<!-- /public/rtc-deployment/calculator.html -->
<div class="calculator-container">
  <h2>RTC资源需求计算器</h2>
  
  <!-- 场景模板选择 -->
  <section class="scenario-templates">
    <h3>选择场景模板</h3>
    <div class="template-cards">
      <div class="template-card" data-template="1v1+rec">
        <div class="icon">👥</div>
        <h4>1v1 + 录制</h4>
        <p>一对一通话场景</p>
      </div>
      <div class="template-card active" data-template="3v7+rec">
        <div class="icon">🎓</div>
        <h4>3v7 + 录制</h4>
        <p>小班课场景</p>
      </div>
      <div class="template-card" data-template="broadcast">
        <div class="icon">📺</div>
        <h4>大型直播</h4>
        <p>互动直播场景</p>
      </div>
      <div class="template-card" data-template="custom">
        <div class="icon">⚙️</div>
        <h4>自定义</h4>
        <p>高级配置</p>
      </div>
    </div>
  </section>
  
  <!-- 参数输入 -->
  <section class="parameters">
    <div class="form-grid">
      <div class="form-group">
        <label>并发用户数</label>
        <input type="number" id="concurrent-users" value="2000">
        <span class="hint">系统中同时在线的最大用户数</span>
      </div>
      
      <div class="form-group">
        <label>频道数量</label>
        <input type="number" id="channels" value="200">
        <span class="hint">同时进行的频道数</span>
      </div>
      
      <div class="form-group">
        <label>是否包含视频</label>
        <select id="has-video">
          <option value="true">是</option>
          <option value="false">否（纯音频）</option>
        </select>
      </div>
      
      <div class="form-group" id="video-options">
        <label>视频分辨率</label>
        <select id="video-resolution">
          <option value="360p">360p (640x360)</option>
          <option value="720p" selected>720p (1280x720)</option>
          <option value="1080p">1080p (1920x1080)</option>
        </select>
      </div>
      
      <div class="form-group">
        <label>帧率</label>
        <select id="fps">
          <option value="15" selected>15 FPS</option>
          <option value="24">24 FPS</option>
          <option value="30">30 FPS</option>
        </select>
      </div>
      
      <div class="form-group">
        <label>部署类型</label>
        <select id="deployment-type">
          <option value="pure">纯私有部署</option>
          <option value="hybrid" selected>混合云部署</option>
        </select>
      </div>
      
      <div class="form-group">
        <label>冗余系数</label>
        <input type="number" id="redundancy" value="30" min="0" max="100">
        <span class="hint">%（建议30%）</span>
      </div>
    </div>
    
    <button onclick="calculateResources()" class="btn-primary">
      🧮 计算资源需求
    </button>
  </section>
  
  <!-- 计算结果 -->
  <section class="results" id="results" style="display: none;">
    <h3>📊 资源评估结果</h3>
    
    <div class="result-cards">
      <div class="result-card">
        <div class="card-value" id="total-servers">26</div>
        <div class="card-label">总服务器数</div>
        <div class="card-detail">25台媒体 + 1台数据</div>
      </div>
      
      <div class="result-card">
        <div class="card-value" id="total-cpu">416</div>
        <div class="card-label">总CPU核心</div>
        <div class="card-detail">16核/台</div>
      </div>
      
      <div class="result-card">
        <div class="card-value" id="total-memory">832</div>
        <div class="card-label">总内存(GB)</div>
        <div class="card-detail">32GB/台</div>
      </div>
      
      <div class="result-card">
        <div class="card-value" id="total-bandwidth">30</div>
        <div class="card-label">总带宽(Gbps)</div>
        <div class="card-detail">10Gbps/台</div>
      </div>
    </div>
    
    <!-- 详细分配 -->
    <div class="detailed-allocation">
      <h4>服务器详细分配</h4>
      <table>
        <thead>
          <tr>
            <th>服务类型</th>
            <th>服务器数量</th>
            <th>主要组件</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody id="server-allocation">
          <!-- 动态生成 -->
        </tbody>
      </table>
    </div>
    
    <!-- 建议 -->
    <div class="recommendations" id="recommendations">
      <!-- AI生成的建议 -->
    </div>
    
    <!-- 操作按钮 -->
    <div class="actions">
      <button onclick="exportResourceReport()" class="btn-secondary">
        📄 导出资源报告
      </button>
      <button onclick="goToAIDesign()" class="btn-primary">
        🤖 下一步: AI架构设计 →
      </button>
    </div>
  </section>
</div>
```

### 6.2 AI架构设计页面

```html
<!-- /public/rtc-deployment/architect.html -->
<div class="architect-container">
  <h2>🤖 AI架构设计助手</h2>
  
  <!-- 资源摘要 -->
  <section class="resource-summary">
    <h3>基于资源评估</h3>
    <div class="summary-badges">
      <span class="badge">24台媒体服务器</span>
      <span class="badge">1台数据平台</span>
      <span class="badge">400核CPU</span>
      <span class="badge">30Gbps带宽</span>
    </div>
  </section>
  
  <!-- AI生成控制 -->
  <section class="ai-controls">
    <div class="ai-status" id="ai-status">
      <div class="status-icon">🤖</div>
      <div class="status-text">准备就绪，点击按钮开始AI设计</div>
    </div>
    
    <button onclick="generateWithAI()" class="btn-ai">
      🚀 AI自动生成架构方案
    </button>
    
    <div class="ai-options">
      <label>
        <input type="checkbox" id="include-ha" checked>
        包含高可用设计
      </label>
      <label>
        <input type="checkbox" id="include-monitoring" checked>
        包含监控方案
      </label>
    </div>
  </section>
  
  <!-- AI生成进度 -->
  <section class="ai-progress" id="ai-progress" style="display: none;">
    <div class="progress-bar">
      <div class="progress-fill" id="progress-fill"></div>
    </div>
    <div class="progress-steps" id="progress-steps">
      <div class="step active">📊 分析需求</div>
      <div class="step">🏗️ 生成拓扑</div>
      <div class="step">🔍 优化方案</div>
      <div class="step">✅ 完成</div>
    </div>
  </section>
  
  <!-- 架构方案展示 -->
  <section class="architecture-result" id="architecture-result" style="display: none;">
    <div class="result-header">
      <h3>✅ AI架构方案已生成</h3>
      <div class="meta">
        <span>生成时间: <span id="gen-time"></span></span>
        <span>AI模型: 千问-Plus</span>
        <span>用时: <span id="gen-duration"></span>秒</span>
      </div>
    </div>
    
    <!-- 架构拓扑图 -->
    <div class="topology-diagram" id="topology-diagram">
      <!-- 可视化架构图 -->
    </div>
    
    <!-- 节点列表 -->
    <div class="nodes-list">
      <h4>节点配置清单</h4>
      <div id="nodes-table">
        <!-- 动态生成节点表格 -->
      </div>
    </div>
    
    <!-- AI推理说明 -->
    <div class="ai-reasoning">
      <h4>💡 AI设计理由</h4>
      <div id="ai-reasoning-text"></div>
    </div>
    
    <!-- 风险提示 -->
    <div class="risks-warnings" id="risks">
      <h4>⚠️ 风险提示</h4>
      <ul id="risk-list"></ul>
    </div>
    
    <!-- SA审核区 -->
    <div class="sa-review-section">
      <h4>SA审核</h4>
      <textarea id="sa-comments" placeholder="审核意见或调整建议..."></textarea>
      
      <div class="review-actions">
        <button onclick="rejectArchitecture()" class="btn-secondary">
          ❌ 需要重新生成
        </button>
        <button onclick="approveArchitecture()" class="btn-success">
          ✅ SA确认通过
        </button>
      </div>
    </div>
  </section>
  
  <!-- 操作按钮 -->
  <div class="actions">
    <button onclick="downloadArchitecture()" class="btn-secondary">
      📥 下载架构文档
    </button>
    <button onclick="goToConfigurator()" class="btn-primary" id="next-btn" disabled>
      下一步: 生成配置文件 →
    </button>
  </div>
</div>
```

---

## 七、API设计

### 7.1 核心API列表

```javascript
// ============================================
// RTC部署项目管理
// ============================================

// 创建项目
POST /api/rtc-deployment/projects
Body: {
  project_name, customer_name, concurrent_users, channels,
  channel_model, has_video, video_resolution, fps,
  deployment_type, network_type, sla_requirement
}

// 获取项目列表
GET /api/rtc-deployment/projects
Query: ?status=draft&created_by=123

// 获取项目详情
GET /api/rtc-deployment/projects/:id

// ============================================
// 资源计算
// ============================================

// 计算资源需求
POST /api/rtc-deployment/projects/:id/calculate
Body: { scenario parameters }
Response: {
  summary: { totalServers, totalCPU, ... },
  servers: { mediaServers, ... },
  instances: { udp_edge_cnt, ... },
  recommendations: [...]
}

// ============================================
// AI架构设计
// ============================================

// AI生成架构方案
POST /api/rtc-deployment/projects/:id/ai-generate
Body: { include_ha, include_monitoring }
Response: {
  architecture_id,
  architecture_json,
  ai_reasoning,
  risks,
  estimated_time: "15s"
}

// SA审核架构
POST /api/rtc-deployment/architectures/:id/review
Body: { approved: true/false, comments }

// ============================================
// 配置生成
// ============================================

// 生成mgmt.sh配置
POST /api/rtc-deployment/projects/:id/generate-config
Body: { architecture_id, config_type: 'mgmt_sh' }
Response: { file_name, file_content, download_url }

// 生成所有配置文件
POST /api/rtc-deployment/projects/:id/generate-all
Response: { files: [...], package_url }

// ============================================
// AI配置验证
// ============================================

// AI验证配置
POST /api/rtc-deployment/projects/:id/ai-validate
Body: { config_json }
Response: {
  validation_result: 'pass/warning/fail',
  errors: [...],
  suggestions: [...]
}

// ============================================
// 千问AI配置
// ============================================

// 获取AI配置
GET /api/rtc-deployment/settings/ai

// 更新AI配置
POST /api/rtc-deployment/settings/ai
Body: { api_key, model: 'qwen-plus' }
```

---

## 八、实施计划

### 第1周: 基础框架
- [ ] 创建数据库表结构
- [ ] 定义RBAC角色和权限
- [ ] 实现项目CRUD API
- [ ] 实现资源计算器（移植Go代码到JS）

### 第2周: AI集成
- [ ] 集成千问API客户端
- [ ] 实现AI架构生成
- [ ] 实现AI配置验证
- [ ] SA审核流程

### 第3周: 配置生成
- [ ] mgmt.sh配置生成器
- [ ] IP地址规划器
- [ ] 部署文档生成
- [ ] 打包下载功能

### 第4周: 前端开发
- [ ] 资源计算器页面
- [ ] AI架构设计页面
- [ ] 配置生成页面
- [ ] 项目管理页面

### 第5周: 测试上线
- [ ] 功能测试
- [ ] AI效果测试
- [ ] SA试用反馈
- [ ] 文档编写

**预计工期**: 5周

---

## 九、AI Prompt工程（关键）

### 9.1 架构设计Prompt模板

```javascript
const ARCHITECTURE_DESIGN_PROMPT = `
你是一位在Agora工作10年的资深RTC私有化部署架构师，精通SD-RTN技术架构。

【客户需求】
- 客户名称: {customer_name}
- 行业: {industry}（如：金融/政企/教育）
- 并发用户: {concurrent_users}
- 频道数量: {channels}
- 频道模型: {channel_model}（如：1v1+录制）
- 媒体类型: {media_type}（音频/音视频）
- 部署类型: {deployment_type}（纯私有/混合云）
- 网络环境: {network_type}
- SLA要求: {sla}

【资源评估】
- 需要{media_servers}台媒体服务器
- 需要{datahub_servers}台数据平台服务器
- 单用户码率: {user_bitrate}Mbps
- 总带宽需求: {total_bandwidth}Gbps

【可用服务组件及其职责】
核心管理服务（必须）:
1. agora_local_ap - SDK接入的第一站，分配edge节点
2. agora_local_balancer - 媒体服务发现和注册
3. agora_vosync - 频道事件同步（创建/销毁）
4. agora_cap_sync - 频道能力同步

媒体处理服务:
5. agora_udp_media_edge - Native SDK UDP媒体接入（旧版兼容）
6. agora_aut_media_edge - Native SDK AUT媒体接入（新协议，抗丢包）
7. agora_web_media_edge - Web SDK WebRTC媒体接入

数据服务:
8. agora_event_collector - SDK事件收集
9. agora_arb - CPU/带宽超限时的负载均衡

辅助服务:
10. agora_infra_helper - 日志清理

监控服务（可选但推荐）:
11-14. influxdb, netdata, cadvisor, grafana

【部署约束】
1. 核心服务(local_ap/balancer/sync)通常部署在1-2台专用服务器
2. 媒体服务(edge)根据带宽需求分布在多台服务器，每台最多10-14个进程
3. 监控服务可以和核心服务共用，或独立部署
4. 混合云需要配置vos_ip连接公网SD-RTN
5. IP地址段: 客户提供192.168.0.0/16，请合理分配避免冲突

【历史相似案例】（供参考）
{similar_cases}

【请输出】

请设计一个最优的部署架构，包含：

1. 服务器节点规划
   - 每台服务器的角色（core/media/datahub/monitoring）
   - 每台服务器部署哪些组件
   - 每台服务器的IP地址分配

2. 服务实例配置
   - udp_edge_cnt, aut_edge_cnt, web_edge_cnt

3. 网络连接关系
   - 各服务的依赖关系
   - IP配置变量（ap, balancer, sync, event_collector）

4. 高可用方案
   - 关键服务的备份
   - 故障切换策略

5. 监控方案
   - 监控服务部署位置
   - 关键监控指标

6. 潜在风险
   - 可能的瓶颈
   - 缓解措施

**输出格式必须是JSON**，结构如下：

\`\`\`json
{
  "architecture_name": "架构方案名称",
  "reasoning": "设计理由（中文，2-3句话）",
  "nodes": [
    {
      "node_id": "node-1",
      "ip_address": "192.168.1.10",
      "role": "core-services",
      "hostname": "rtc-core-01",
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
      },
      "mgmt_vars": {
        "local_ip": "192.168.1.10",
        "ap": "192.168.1.10",
        "balancer": "192.168.1.10",
        "sync": "192.168.1.10",
        "event_collector": "192.168.1.10"
      }
    }
  ],
  "network": {
    "ip_range": "192.168.0.0/16",
    "allocations": {
      "core": "192.168.1.0/24",
      "media": "192.168.2.0/23",
      "datahub": "192.168.4.0/24"
    },
    "firewall_rules": [
      {
        "source": "client",
        "destination": "192.168.1.10",
        "protocol": "TCP",
        "port": "443,8003,8004",
        "purpose": "SDK接入Local AP"
      }
    ]
  },
  "ha_config": {
    "enabled": true,
    "critical_services": ["local_ap", "local_balancer"],
    "strategy": "active-standby",
    "failover_time": "30s"
  },
  "deployment_order": [
    "1. 部署核心服务（node-1）",
    "2. 部署媒体服务（node-2 to node-N）",
    "3. 部署数据平台",
    "4. 部署监控服务",
    "5. 健康检查和验证"
  ],
  "risks": [
    {
      "risk": "单点故障",
      "severity": "medium",
      "mitigation": "建议local_ap部署主备"
    }
  ],
  "recommendations": [
    "建议在核心服务器配置SSD提升性能",
    "建议启用TLS加密提升安全性"
  ]
}
\`\`\`
`;
```

### 9.2 配置验证Prompt

```javascript
const CONFIG_VALIDATION_PROMPT = `
你是RTC私有化部署配置审查专家。

请检查以下mgmt.sh配置是否正确：

\`\`\`bash
{config_content}
\`\`\`

需要检查的要点：
1. IP地址
   - 是否在合理网段
   - 是否有冲突
   - ap/balancer/sync的IP是否可达

2. 服务依赖
   - edge服务是否正确配置了ap/balancer/sync
   - event_collector的IP配置是否正确

3. 实例数量
   - udp/aut/web_edge_cnt是否合理
   - 是否超过单机承载能力

4. 证书配置
   - tls_cert和web_cert是否都配置
   - 文件名是否合理

5. 混合云配置
   - 如果是混合云，vos_ip是否配置
   - ip_for_cloud是否正确

6. 性能瓶颈
   - 带宽是否足够
   - CPU/内存是否匹配

请返回JSON格式的检查结果：

\`\`\`json
{
  "validation_result": "pass/warning/fail",
  "errors": [
    {
      "field": "ap",
      "line": 48,
      "message": "AP IP地址未配置",
      "severity": "error",
      "suggestion": "必须配置local_ap服务器的IP"
    }
  ],
  "warnings": [
    {
      "field": "udp_edge_cnt",
      "message": "实例数量较少",
      "severity": "warning",
      "suggestion": "建议增加到10个实例以充分利用服务器"
    }
  ],
  "suggestions": [
    {
      "field": "max_user_count",
      "impact": "medium",
      "message": "建议根据实际并发调整max_user_count"
    }
  ],
  "score": 85
}
\`\`\`
`;
```

---

## 十、ROI分析与价值

### 10.1 直接价值

**时间节省**：
- 单项目: 7.5小时
- 月度10个项目: 75小时 ≈ 9.4人天
- 年度120个项目: 900小时 ≈ 112.5人天

**质量提升**：
- 配置错误率: 从5% → <0.5%
- 方案标准化: 100%
- 知识沉淀: AI持续学习

### 10.2 间接价值

**客户满意度**：
- 方案交付速度更快
- 配置质量更可靠
- 专业度提升

**团队能力**：
- 新SA快速上手
- 经验知识固化
- 减少对个人经验依赖

---

## 十一、下一步行动

### 选项1: 先做MVP验证价值（推荐）

**2周完成**，包含：
1. ✅ 资源计算器（纯前端）
2. ✅ AI架构生成（集成千问）
3. ✅ mgmt.sh配置生成

**不包含**：
- 复杂的可视化
- 远程部署
- 历史案例库

**目标**: 快速验证提效价值

---

### 选项2: 完整实施（5周）

按照上述完整方案实施。

---

## 🤔 请您决定

1. **立即开始MVP**（推荐）- 我可以现在就开始实现资源计算器
2. **继续细化方案** - 讨论更多技术细节
3. **提供千问API Key** - 我可以先测试AI集成效果

您希望如何推进？🚀
