/**
 * RTC部署配置生成器
 * 根据架构方案生成mgmt.sh配置和部署文档
 */

const fs = require('fs');
const path = require('path');

class RTCConfigGenerator {
  /**
   * 生成mgmt.sh配置文件
   */
  generateMgmtSh(architecture, projectInfo) {
    const network = architecture.network || {};
    const mgmtVars = network.mgmt_variables || {};
    
    // 查找核心节点和媒体节点
    const coreNode = architecture.nodes.find(n => n.role === 'core-services' || n.services.includes('local_ap'));
    const mediaNodes = architecture.nodes.filter(n => n.role === 'media' || n.role === 'media-services');
    const datahubNode = architecture.nodes.find(n => n.role === 'datahub');
    
    // 提取实例配置（使用第一个媒体节点的配置）
    const firstMediaNode = mediaNodes[0] || coreNode;
    const instanceCounts = firstMediaNode?.instance_counts || {
      udp_edge_cnt: 1,
      aut_edge_cnt: 1,
      web_edge_cnt: 1
    };
    
    const config = `#!/bin/bash
# ============================================
# RTC私有化部署配置
# ============================================
# 项目名称: ${projectInfo.project_name}
# 客户名称: ${projectInfo.customer_name}
# 部署类型: ${projectInfo.deployment_type === 'hybrid' ? '混合云' : '纯私有'}
# 生成时间: ${new Date().toISOString()}
# 生成方式: 系统生成 + SA审核
# ============================================

function usage() {
	echo "script for managing on premise RTC services from agora.io"
	echo "=== Start a service ==="
	echo "  ./mgmt.sh start <service name>"
	echo "  eg. : ./mgmt.sh start local_ap"
	echo ""
	echo "== show this help ==="
	echo "  ./mgmt.sh -h or ./mgmt.sh --help"
}

# ============================================
# 核心IP配置
# ============================================
# 本机IP（必须配置为本机实际IP）
local_ip=${coreNode?.ip_address || '127.0.0.1'}

# 数据平台IP
datahub_ip=${datahubNode?.ip_address || mgmtVars.datahub_ip || '127.0.0.1'}

# Local AP服务器IP列表（逗号分隔）
local_ap_ips=${mgmtVars.ap || coreNode?.ip_address || '127.0.0.1'}

# Local AP服务IP（边缘节点连接用）
ap=${mgmtVars.ap || coreNode?.ip_address || '$local_ip'}

# Local Balancer服务IP
balancer=${mgmtVars.balancer || coreNode?.ip_address || '$local_ip'}

# Vosync和Cap_sync服务IP
sync=${mgmtVars.sync || coreNode?.ip_address || '$local_ip'}

# Event Collector服务IP
event_collector=${mgmtVars.event_collector || coreNode?.ip_address || '$local_ip'}

${projectInfo.deployment_type === 'hybrid' ? `# ============================================
# 混合云配置
# ============================================
# Proxy VOS IP（公网SD-RTN接入点，向SA申请）
# 格式: IP1,IP2,IP3（逗号分隔）
vos_ip=${mgmtVars.vos_ip || '120.92.138.184,120.92.117.169'}
` : '# 纯私有部署，无需配置vos_ip'}

# ============================================
# Vendor和License配置
# ============================================
# Vendor信息（格式: <app_id>:<vendor_id>[:+/-:<private_key>]）
# 示例: 12345:VID123:+:YOUR_PRIVATE_KEY
# 多个vendor用逗号分隔
vendor_ids=

# ============================================
# 证书配置
# ============================================
# Native SDK证书（由Agora签发，向SA申请）
tls_cert=
tls_cert_key=

# Web SDK证书（由CA签发，客户提供）
web_cert=
web_cert_key=
web_domain_prefix=private

# ============================================
# 路径配置
# ============================================
# 日志目录
log_path=/var/log/agora

# 数据目录（influxdb等）
data_path=/data/agora

# 临时目录
tmp_path=/tmp

# ============================================
# Edge实例配置
# ============================================
# 各类Edge的实例数量
udp_edge_cnt=${instanceCounts.udp_edge_cnt}
aut_edge_cnt=${instanceCounts.aut_edge_cnt}
web_edge_cnt=${instanceCounts.web_edge_cnt}

# 单台服务器最大用户数
max_user_count=${Math.floor(projectInfo.concurrent_users / (mediaNodes.length || 1))}

# 最大内存限制（KB）
max_mem=4000000

# ============================================
# 网络配置
# ============================================
# SDK访问的IP（可以是转发IP）
ip_for_client=$local_ip

# Edge间通信IP
ip_for_comm=$local_ip

${projectInfo.deployment_type === 'hybrid' ? `# 混合云通信IP（必须能访问互联网）
ip_for_cloud=$local_ip
` : ''}

# InfluxDB主机IP
influxdb_host=$local_ip

# ============================================
# 端口配置
# ============================================
# Web AP端口（默认443）
# web_ap_port=10443

# Event Collector Web端口（默认6443）
# event_web_port=16443

# Edge起始端口
udp_client_port=4001
aut_client_port=4701
web_client_port=4501

# InfluxDB数据库名
influxdb_database_name=proxy_monitor

# ============================================
# 高级配置（可选）
# ============================================
# 是否启用频道合并（默认启用）
# channel_merge=false

# TLS重协商（默认启用，设置true禁用）
# tls_no_renegotiation=false

# TLS加密套件（2.1.22+支持）
# cipher_list=high-security

# P2P TCP直连（默认禁用）
# p2p_tcp=on

# 自定义首页
# index_page=custom_index.html

# Event Collector Web Origin（默认开启）
# web_origin_on=off

# 用户ID
# uid=

# ============================================
# 镜像仓库配置
# ============================================
registry=registry.cn-hangzhou.aliyuncs.com/agoraio-public

# 镜像版本tag
local_ap_tag=release-v2_1_15-20260114
local_balancer_tag=release-v1_2_2-20250530
vosync_tag=release-v1_8_8-20250530
cap_sync_tag=release-v1_2_0-20250530
web_edge_tag=release-v3_1_9-20260114
udp_edge_tag=release-v3_0_12-20260114
aut_edge_tag=release-v3_0_12-20260114
event_collector_tag=release-v1_9_5-20251015
arb_tag=release-v1_0_3-20250530
infra_helper_tag=release-v1_1_16-20250826
web_collector_proxy_tag=release-v1_7_0-20230418

img_local_ap="\${registry}/agora_local_ap:\${local_ap_tag}"
img_local_balancer="\${registry}/agora_local_balancer:\${local_balancer_tag}"
img_vosync="\${registry}/agora_vosync:\${vosync_tag}"
img_cap_sync="\${registry}/agora_cap_sync:\${cap_sync_tag}"
img_web_edge="\${registry}/agora_web_media_edge:\${web_edge_tag}"
img_udp_edge="\${registry}/agora_udp_media_edge:\${udp_edge_tag}"
img_aut_edge="\${registry}/agora_aut_media_edge:\${aut_edge_tag}"
img_event_collector="\${registry}/agora_event_collector:\${event_collector_tag}"
img_arb="\${registry}/agora_arb:\${arb_tag}"
img_infra_helper="\${registry}/agora_infra_helper:\${infra_helper_tag}"
img_web_collector_proxy="\${registry}/agora_web_collector_proxy:\${web_collector_proxy_tag}"

img_grafana="\${registry}/grafana:8.2.7"
img_influxdb="\${registry}/influxdb:1.8"
img_cadvisor="\${registry}/cadvisor:v0.49.1"
img_netdata="\${registry}/netdata:v1.33"

# ============================================
# 以下为完整管理函数
# ============================================
service_container_name() {
  local svc="$1"
  echo "agora_\${svc}"
}

service_image() {
  local svc="$1"
  case "$svc" in
    local_ap) echo "$img_local_ap" ;;
    local_balancer) echo "$img_local_balancer" ;;
    vosync) echo "$img_vosync" ;;
    cap_sync) echo "$img_cap_sync" ;;
    web_edge) echo "$img_web_edge" ;;
    udp_edge) echo "$img_udp_edge" ;;
    aut_edge) echo "$img_aut_edge" ;;
    event_collector) echo "$img_event_collector" ;;
    arb) echo "$img_arb" ;;
    infra_helper) echo "$img_infra_helper" ;;
    grafana) echo "$img_grafana" ;;
    influxdb) echo "$img_influxdb" ;;
    cadvisor) echo "$img_cadvisor" ;;
    netdata) echo "$img_netdata" ;;
    *) echo "" ;;
  esac
}

run_service() {
  local svc="$1"
  local image
  local cname
  image="$(service_image "$svc")"
  cname="$(service_container_name "$svc")"
  if [ -z "$image" ]; then
    echo "Unknown service: $svc"
    return 1
  fi

  if docker ps -a --format '{{.Names}}' | grep -q "^\${cname}$"; then
  echo "[INFO] container exists, restarting: \${cname}"
    docker rm -f "\${cname}" >/dev/null 2>&1 || true
  fi

  echo "[INFO] starting \${svc} with image \${image}"
  docker run -d --name "\${cname}" --restart unless-stopped \\
    --network host \\
    -v "\${log_path}:/var/log/agora" \\
    -v "\${data_path}:/data/agora" \\
    -e LOCAL_IP="\${local_ip}" \\
    -e AP="\${ap}" \\
    -e BALANCER="\${balancer}" \\
    -e SYNC="\${sync}" \\
    -e EVENT_COLLECTOR="\${event_collector}" \\
    -e DATAHUB_IP="\${datahub_ip}" \\
    -e UDP_EDGE_CNT="\${udp_edge_cnt}" \\
    -e AUT_EDGE_CNT="\${aut_edge_cnt}" \\
    -e WEB_EDGE_CNT="\${web_edge_cnt}" \\
    "\${image}"
}

stop_service() {
  local svc="$1"
  local cname
  cname="$(service_container_name "$svc")"
  echo "[INFO] stopping \${svc}"
  docker rm -f "\${cname}" >/dev/null 2>&1 || true
}

status_service() {
  local svc="$1"
  local cname
  cname="$(service_container_name "$svc")"
  if docker ps --format '{{.Names}}' | grep -q "^\${cname}$"; then
    echo "\${svc}: running"
  else
    echo "\${svc}: stopped"
  fi
}

all_services=(local_ap local_balancer vosync cap_sync event_collector udp_edge aut_edge web_edge arb infra_helper influxdb netdata cadvisor grafana)

start_all() {
  for s in "\${all_services[@]}"; do
    run_service "\${s}" || return 1
  done
}

stop_all() {
  for s in "\${all_services[@]}"; do
    stop_service "\${s}"
  done
}

status_all() {
  for s in "\${all_services[@]}"; do
    status_service "\${s}"
  done
}

main() {
  local cmd="$1"
  local svc="$2"
  case "$cmd" in
    start)
      if [ "$svc" = "all" ] || [ -z "$svc" ]; then start_all; else run_service "$svc"; fi
      ;;
    stop)
      if [ "$svc" = "all" ] || [ -z "$svc" ]; then stop_all; else stop_service "$svc"; fi
      ;;
    restart)
      if [ "$svc" = "all" ] || [ -z "$svc" ]; then stop_all && start_all; else stop_service "$svc" && run_service "$svc"; fi
      ;;
    status)
      if [ "$svc" = "all" ] || [ -z "$svc" ]; then status_all; else status_service "$svc"; fi
      ;;
    -h|--help|help|"")
      usage
      ;;
    *)
      echo "Unknown command: $cmd"
      usage
      return 1
      ;;
  esac
}

main "$@"
`;

    return config;
  }

  /**
   * 生成部署文档
   */
  generateDeploymentDoc(architecture, projectInfo, resourceEstimate) {
    const { nodes } = architecture;
    
    return `
# ${projectInfo.customer_name} - RTC私有化部署方案

## 项目信息
- **项目名称**: ${projectInfo.project_name}
- **客户名称**: ${projectInfo.customer_name}
- **部署类型**: ${projectInfo.deployment_type === 'hybrid' ? '混合云部署' : '纯私有部署'}
- **预计规模**: ${projectInfo.concurrent_users}并发用户, ${projectInfo.channels}频道
- **方案生成**: ${new Date().toLocaleString('zh-CN')}

---

## 一、资源需求汇总

### 服务器清单
- **总计**: ${resourceEstimate.summary.totalServers}台
  - 媒体服务器: ${resourceEstimate.summary.mediaServers}台
  - 数据平台: ${resourceEstimate.summary.datahubServers}台

### 资源汇总
- **CPU**: ${resourceEstimate.summary.totalCPU}核
- **内存**: ${resourceEstimate.summary.totalMemory}GB
- **存储**: ${resourceEstimate.summary.totalStorage}GB
- **带宽**: ${(resourceEstimate.summary.totalBandwidth/1000).toFixed(1)}Gbps

---

## 二、服务器详细配置

${nodes.map((node, i) => `
### 服务器${i + 1}: ${node.hostname || node.node_id}
- **IP地址**: ${node.ip_address}
- **角色**: ${node.role_description || node.role}
- **部署服务**:
${node.services.map(s => `  - ${s}`).join('\n')}
${node.instance_counts && (node.instance_counts.udp_edge_cnt > 0 || node.instance_counts.aut_edge_cnt > 0 || node.instance_counts.web_edge_cnt > 0) ? `
- **Edge实例配置**:
  - UDP Edge: ${node.instance_counts.udp_edge_cnt}个进程
  - AUT Edge: ${node.instance_counts.aut_edge_cnt}个进程  
  - Web Edge: ${node.instance_counts.web_edge_cnt}个进程
` : ''}
- **硬件配置**: ${node.resources?.cpu || 16}核 ${node.resources?.memory || 32}GB ${node.resources?.storage || 240}GB SSD ${node.resources?.bandwidth || 10000}Mbps
`).join('\n')}

---

## 三、部署步骤

### 准备工作
1. 确认所有服务器已安装Docker（20.04+）和Python3
2. 准备证书文件：
   - Native证书: tls_cert + tls_cert_key（向SA申请）
   - Web证书: web_cert + web_cert_key（客户提供CA证书）
3. 上传部署包到所有服务器
4. 解压部署包: \`tar -xzf agora-private-rtc-v2_1_x.tar.gz\`

### 部署顺序（按推荐顺序）

${architecture.deployment_order ? architecture.deployment_order.map((step, i) => 
  `#### 步骤${i + 1}: ${step}`
).join('\n\n') : '请按照标准顺序部署'}

### 详细启动命令

#### 在核心服务器上 (${nodes.find(n => n.role.includes('core'))?.ip_address || 'IP'})
\`\`\`bash
cd /path/to/rtc-deployment

# 1. 复制证书到agora目录
cp tls_cert tls_cert_key web_cert web_cert_key ./agora/

# 2. 修改mgmt.sh配置
# 使用生成的配置文件替换mgmt.sh顶部的变量定义

# 3. 启动核心服务
./mgmt.sh start local_ap
./mgmt.sh start local_balancer  
./mgmt.sh start vosync
./mgmt.sh start cap_sync
./mgmt.sh start event_collector
\`\`\`

#### 在媒体服务器上 (各媒体节点)
\`\`\`bash
# 启动Edge服务
./mgmt.sh start aut_edge
./mgmt.sh start web_edge
./mgmt.sh start udp_edge

# 启动辅助服务
./mgmt.sh start arb
./mgmt.sh start infra_helper
\`\`\`

#### 在数据平台服务器上 (${datahubNode?.ip_address || 'IP'})
\`\`\`bash
# 部署数据平台（参考数据平台部署文档）
\`\`\`

#### 监控服务（可选）
\`\`\`bash
./mgmt.sh start influxdb
./mgmt.sh start netdata
./mgmt.sh start cadvisor
./mgmt.sh start grafana
\`\`\`

---

## 四、网络和防火墙配置

### 需要开通的端口

${architecture.firewall_rules?.length ? `
| 源 | 目标 | 协议 | 端口 | 方向 | 用途 |
|---|---|---|---|---|---|
${architecture.firewall_rules.map(r => `| ${r.source || '-'} | ${r.destination || '-'} | ${r.protocol || '-'} | ${r.port || '-'} | ${r.direction || '-'} | ${r.purpose || '-'} |`).join('\n')}
` : `
| 源 | 目标 | 协议/端口 | 用途 |
|---|---|---|---|
| Native SDK | Local AP | TCP/8003, UDP/8004 | SDK接入分配 |
| Web SDK | Local AP | TCP/443 | Web SDK接入 |
| Native SDK | AUT Edge | UDP/4700+ | 媒体数据传输 |
| Web SDK | Web Edge | TCP/4500+, UDP/4500+ | WebRTC传输 |
| SDK | Event Collector | TCP/6443, UDP/4301 | 事件收集 |
${projectInfo.deployment_type === 'hybrid' ? `| Edge | Proxy VOS | TCP/5201, UDP/5001 | 混合云通信 |` : ''}
`}

完整端口清单请参考私有化部署文档。

---

## 五、验证清单

### 启动后检查
- [ ] 所有Docker容器正常运行: \`docker ps\`
- [ ] 日志无ERROR: \`tail -f /var/log/agora/*.log\`
- [ ] 监控平台可访问: http://${nodes[0]?.ip_address}:3000

### SDK接入测试
- [ ] Native SDK可以加入频道
- [ ] Web SDK可以加入频道
- [ ] 音视频互通正常
- [ ] 录制功能正常（如有）

### 性能验证
- [ ] CPU使用率 < 80%
- [ ] 内存使用率 < 80%
- [ ] 带宽使用正常
- [ ] 无丢包和延迟

---

## 六、风险提示

${architecture.risks ? architecture.risks.map(r => 
  `### ${r.risk} (${r.severity})\n**缓解措施**: ${r.mitigation}`
).join('\n\n') : '请参考系统生成的风险评估'}

---

## 七、联系支持

- **SA**: ${projectInfo.sa_name || projectInfo.sa_email || '联系您的SA'}
- **技术支持**: support@agora.io
- **紧急热线**: [填写]

---

**文档版本**: v1.0  
**最后更新**: ${new Date().toLocaleString('zh-CN')}
`;
  }

  /**
   * 生成README文件
   */
  generateReadme(projectInfo, architecture) {
    return `
# ${projectInfo.project_name} - 部署包

## 快速开始

1. 解压部署包
2. 复制证书文件到 \`agora/\` 目录
3. 修改 \`mgmt.sh\` 配置（IP、Vendor等）
4. 执行部署命令

详见 \`部署文档.md\`

## 文件说明

- \`mgmt.sh\` - 部署管理脚本（已预配置IP）
- \`部署文档.md\` - 详细部署指南
- \`架构方案.json\` - 生成的架构方案
- \`资源清单.txt\` - 资源需求清单
- \`agora/\` - 配置文件目录（放置证书）

## 重要提示

⚠️ 部署前必须：
1. 将Native证书(tls_cert, tls_cert_key)放入agora/目录
2. 将Web证书(web_cert, web_cert_key)放入agora/目录
3. 在mgmt.sh中配置vendor_ids
4. 确认所有IP地址正确

## 技术支持

如有问题请联系: ${projectInfo.sa_email || 'your-sa@company.com'}
`;
  }

  /**
   * 生成防火墙规则文档
   */
  generateFirewallDoc(architecture, projectInfo) {
    const rules = architecture.firewall_rules || [];
    if (!rules.length) return '';

    const rows = rules.map(r =>
      `| ${r.source || '-'} | ${r.destination || '-'} | ${r.protocol || '-'} | ${r.port || '-'} | ${r.direction || '-'} | ${r.purpose || '-'} |`
    ).join('\n');

    return `# ${projectInfo.customer_name} - 防火墙放通规则

| 源 | 目标 | 协议 | 端口 | 方向 | 用途 |
|---|---|---|---|---|---|
${rows}

---
生成时间: ${new Date().toLocaleString('zh-CN')}
`;
  }

  /**
   * 为指定节点生成 mgmt.sh 配置段
   */
  generateNodeMgmtSh(nodeConfig, projectInfo) {
    const vars = nodeConfig.variables || {};
    const lines = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n');

    return `#!/bin/bash
# ============================================
# RTC私有化部署配置 - ${nodeConfig.hostname || nodeConfig.node_id}
# ============================================
# 项目名称: ${projectInfo.project_name}
# 客户名称: ${projectInfo.customer_name}
# 节点ID: ${nodeConfig.node_id}
# 生成时间: ${new Date().toISOString()}
# ============================================

${lines}
`;
  }

  /**
   * 生成所有配置文件
   */
  generateAll(architecture, projectInfo, resourceEstimate) {
    const files = {
      'mgmt.sh': this.generateMgmtSh(architecture, projectInfo),
      '部署文档.md': this.generateDeploymentDoc(architecture, projectInfo, resourceEstimate),
      '架构方案.json': JSON.stringify(architecture, null, 2),
      '资源清单.txt': resourceEstimate ? this.generateResourceList(resourceEstimate) : '',
      'README.md': this.generateReadme(projectInfo, architecture)
    };

    // 防火墙规则文档
    if (architecture.firewall_rules?.length) {
      files['防火墙规则.md'] = this.generateFirewallDoc(architecture, projectInfo);
    }

    // 为每个节点生成独立的 mgmt.sh（如果 AI 提供了 mgmt_configs）
    if (architecture.mgmt_configs?.length) {
      for (const nc of architecture.mgmt_configs) {
        const fileName = `mgmt-${nc.node_id || nc.hostname || 'unknown'}.sh`;
        files[fileName] = this.generateNodeMgmtSh(nc, projectInfo);
      }
    }

    return files;
  }

  /**
   * 生成资源清单文本
   */
  generateResourceList(resourceEstimate) {
    const { summary } = resourceEstimate;
    return `
RTC私有化资源清单
=====================

服务器需求:
- 媒体服务器: ${summary.mediaServers}台 × (16C 32G 240GB SSD 10Gbps)
- 数据平台: ${summary.datahubServers}台 × (16C 32G 500GB SSD 1Gbps)

资源汇总:
- CPU总计: ${summary.totalCPU}核
- 内存总计: ${summary.totalMemory}GB
- 存储总计: ${summary.totalStorage}GB
- 带宽总计: ${(summary.totalBandwidth/1000).toFixed(1)}Gbps

Edge实例配置:
- UDP Edge: ${resourceEstimate.instances.udp_edge_cnt}个/台
- AUT Edge: ${resourceEstimate.instances.aut_edge_cnt}个/台
- Web Edge: ${resourceEstimate.instances.web_edge_cnt}个/台

单用户码率:
- 音频: ${resourceEstimate.userBitrate.audio}Mbps
- 视频: ${resourceEstimate.userBitrate.video.toFixed(2)}Mbps
- 合计: ${resourceEstimate.userBitrate.total.toFixed(2)}Mbps
`;
  }
}

module.exports = { RTCConfigGenerator };
