/**
 * RTC资源计算器
 * 基于calbitrate.go移植，用于计算RTC私有化部署所需资源
 */

// 标准服务器配置
const SERVER_SPECS = {
  media: {
    cpu: 16,
    memory: 32,
    storage: 240,
    bandwidth: 10000,        // Mbps
    maxBandwidth: 2500,      // 单台最大视频带宽 2.5Gbps
    maxProcesses: 14,        // 最大edge进程数（线上最高14个）
    connectionsPerProcess: 200,  // 单进程最大连接数（线上最高280）
    recommendedProcesses: 10     // 推荐进程数
  },
  datahub: {
    cpu: 16,
    memory: 32,
    storage: 500,  // 数据平台需要更大存储
    bandwidth: 1000
  }
};

// 标准场景码率（Mbps）
const STANDARD_BITRATES = {
  audio: 0.1,          // 100Kbps
  video_720p: 1.1,     // 1.1Mbps  
  audioVideo_720p: 1.2 // 1.2Mbps (1.1M + 0.07M)
};

class RTCResourceCalculator {
  /**
   * 计算视频码率（基于jxy_cal_bitrate移植）
   */
  calculateBitrate(width, height, fps, qualityChoice = 'H', codecChoice = 'H264', pvcChoice = 'N') {
    const resolutionRatio = (width * height) / (640 * 360);
    const frameRateRatio = fps / 15;
    
    const saveRatio = this.getSaveRatio(width, height, qualityChoice);
    const newSaveRatio = this.getNewSaveRatio(width, height, codecChoice, pvcChoice);
    
    const bitrate = (800 * Math.pow(resolutionRatio, 0.75)) 
                    * Math.pow(frameRateRatio, 0.6) 
                    * saveRatio 
                    * newSaveRatio;
    
    return Math.round(bitrate);
  }

  getSaveRatio(width, height, qualityChoice) {
    if (qualityChoice === 'H') return 1.0;
    
    const profile = width * height;
    if (profile <= 120 * 160) return 0.9;
    if (profile <= 360 * 640) return 0.85;
    if (profile <= 540 * 960) return 0.75;
    if (profile <= 720 * 1280) return 0.7;
    if (profile <= 1080 * 1920) return 0.6;
    return 0.5;
  }

  getNewSaveRatio(width, height, codecChoice, pvcChoice) {
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

  /**
   * 获取分辨率参数
   */
  getResolutionParams(resolution) {
    const resolutionMap = {
      '360p': { width: 640, height: 360 },
      '720p': { width: 1280, height: 720 },
      '1080p': { width: 1920, height: 1080 },
      '480p': { width: 854, height: 480 }
    };
    return resolutionMap[resolution] || resolutionMap['720p'];
  }

  /**
   * 计算单用户码率
   */
  calculateUserBitrate(hasVideo, videoResolution = '720p', fps = 15) {
    if (!hasVideo) {
      return {
        audio: 0.1,
        video: 0,
        total: 0.1
      };
    }
    
    const { width, height } = this.getResolutionParams(videoResolution);
    const videoBitrateKbps = this.calculateBitrate(width, height, fps, 'H', 'H264', 'N');
    const videoBitrateMbps = videoBitrateKbps / 1000;
    
    return {
      audio: 0.07,
      video: videoBitrateMbps,
      total: videoBitrateMbps + 0.07
    };
  }

  /**
   * 计算资源需求（主入口）
   */
  calculate(scenario) {
    const {
      concurrentUsers,
      channels,
      channelModel,      // '1v1+rec', '3v7+rec', 'broadcast', 'custom'
      hasVideo = true,
      videoResolution = '720p',
      fps = 15,
      deploymentType = 'pure',  // 'pure' or 'hybrid'
      redundancy = 0.3    // 冗余系数
    } = scenario;

    // 1. 计算单用户码率
    const userBitrate = this.calculateUserBitrate(hasVideo, videoResolution, fps);

    // 2. 计算服务器需求
    const serverCalc = this.calculateServers(
      concurrentUsers, 
      channels, 
      channelModel, 
      userBitrate, 
      redundancy
    );

    // 3. 计算实例配置
    const instances = this.calculateInstances(
      concurrentUsers,
      serverCalc.mediaServers,
      channelModel
    );

    // 4. 生成资源摘要
    const summary = {
      totalServers: serverCalc.mediaServers + 1,  // +1 datahub
      mediaServers: serverCalc.mediaServers,
      datahubServers: 1,
      totalCPU: serverCalc.mediaServers * 16 + 16,
      totalMemory: serverCalc.mediaServers * 32 + 32,
      totalBandwidth: Math.ceil(serverCalc.totalBandwidthMbps),
      totalStorage: serverCalc.mediaServers * 240 + 500,
      userBitrate: userBitrate.total
    };

    // 5. 生成建议
    const recommendations = this.generateRecommendations(scenario, serverCalc, instances);

    return {
      summary,
      servers: serverCalc,
      instances,
      userBitrate,
      recommendations,
      calculatedAt: new Date().toISOString()
    };
  }

  /**
   * 计算服务器需求
   */
  calculateServers(concurrentUsers, channels, channelModel, userBitrate, redundancy) {
    const bitratePerUserMbps = userBitrate.total;

    // 1v1 + 录制场景
    if (channelModel === '1v1+rec') {
      return this.calculate1v1Recording(concurrentUsers, channels, bitratePerUserMbps, redundancy);
    }
    
    // 3v7 + 录制场景
    else if (channelModel === '3v7+rec') {
      return this.calculate3v7Recording(concurrentUsers, channels, bitratePerUserMbps, redundancy);
    }
    
    // 大型直播场景
    else if (channelModel === 'broadcast') {
      return this.calculateBroadcast(concurrentUsers, channels, bitratePerUserMbps, redundancy);
    }
    
    // 通用估算
    else {
      return this.calculateGeneric(concurrentUsers, bitratePerUserMbps, redundancy);
    }
  }

  /**
   * 1v1+录制场景计算
   */
  calculate1v1Recording(concurrentUsers, channels, bitratePerUserMbps, redundancy) {
    // 纯音频
    if (bitratePerUserMbps < 0.5) {
      const connectionsPerServer = SERVER_SPECS.media.recommendedProcesses * SERVER_SPECS.media.connectionsPerProcess;
      const channelsPerServer = Math.floor(connectionsPerServer / 3);  // 每频道3连接
      const serversNeeded = Math.ceil(channels / channelsPerServer);
      
      return {
        mediaServers: Math.ceil(serversNeeded * (1 + redundancy)),
        autEdgeServers: 0,
        udpEdgeServers: 0,
        totalBandwidthMbps: channels * 3 * bitratePerUserMbps,
        scenario: '1v1+录制-音频',
        calculation: `${channels}频道 × 3连接 ÷ ${channelsPerServer}频道/台 × (1+${redundancy}冗余)`
      };
    }
    
    // 音视频（最坏情况：每频道3台服务器）
    const maxBandwidth = SERVER_SPECS.media.maxBandwidth;
    
    // 用户AUT服务器: 下行3路（用户A下行: 用户B+用户B+录制）
    const usersPerAutServer = Math.floor(maxBandwidth / (bitratePerUserMbps * 3));
    
    // 录制UDP服务器: 下行2路（录制下行: 用户A+用户B）
    const recsPerUdpServer = Math.floor(maxBandwidth / (bitratePerUserMbps * 2));
    
    const totalUsers = channels * 2;
    const autServers = Math.ceil(totalUsers / usersPerAutServer);
    const udpServers = Math.ceil(channels / recsPerUdpServer);
    
    return {
      mediaServers: Math.ceil((autServers + udpServers) * (1 + redundancy)),
      autEdgeServers: Math.ceil(autServers * (1 + redundancy)),
      udpEdgeServers: Math.ceil(udpServers * (1 + redundancy)),
      totalBandwidthMbps: totalUsers * bitratePerUserMbps * 1.5,  // 考虑转发
      scenario: '1v1+录制-视频',
      calculation: `用户AUT: ${totalUsers}÷${usersPerAutServer}/台=${autServers}台, 录制UDP: ${channels}÷${recsPerUdpServer}/台=${udpServers}台`
    };
  }

  /**
   * 3v7+录制场景计算
   */
  calculate3v7Recording(concurrentUsers, channels, bitratePerUserMbps, redundancy) {
    if (bitratePerUserMbps < 0.5) {
      const connectionsPerServer = SERVER_SPECS.media.recommendedProcesses * SERVER_SPECS.media.connectionsPerProcess;
      const channelsPerServer = Math.floor(connectionsPerServer / 11);
      const serversNeeded = Math.ceil(channels / channelsPerServer);
      
      return {
        mediaServers: Math.ceil(serversNeeded * (1 + redundancy)),
        totalBandwidthMbps: channels * 11 * bitratePerUserMbps,
        scenario: '3v7+录制-音频'
      };
    }
    
    const maxBandwidth = SERVER_SPECS.media.maxBandwidth;
    
    // 主播服务器: 下行13路（3主播 + 7观众 + 3主播互看）
    const hostsPerServer = Math.floor(maxBandwidth / (bitratePerUserMbps * 13));
    
    // 观众服务器: 下行3路（3个主播）
    const audiencePerServer = Math.floor(maxBandwidth / (bitratePerUserMbps * 3));
    
    // 录制服务器: 下行3路（3个主播）
    const recsPerServer = Math.floor(maxBandwidth / (bitratePerUserMbps * 3));
    
    const totalHosts = channels * 3;
    const totalAudience = channels * 7;
    const totalRecs = channels;
    
    const hostServers = Math.ceil(totalHosts / hostsPerServer);
    const audienceServers = Math.ceil(totalAudience / audiencePerServer);
    const recServers = Math.ceil(totalRecs / recsPerServer);
    
    return {
      mediaServers: Math.ceil((hostServers + audienceServers + recServers) * (1 + redundancy)),
      hostEdgeServers: Math.ceil(hostServers * (1 + redundancy)),
      audienceEdgeServers: Math.ceil(audienceServers * (1 + redundancy)),
      recEdgeServers: Math.ceil(recServers * (1 + redundancy)),
      totalBandwidthMbps: (totalHosts + totalAudience + totalRecs) * bitratePerUserMbps,
      scenario: '3v7+录制-视频',
      calculation: `主播:${totalHosts}÷${hostsPerServer}/台, 观众:${totalAudience}÷${audiencePerServer}/台, 录制:${totalRecs}÷${recsPerServer}/台`
    };
  }

  /**
   * 大型直播场景计算
   */
  calculateBroadcast(concurrentUsers, channels, bitratePerUserMbps, redundancy) {
    // 简化: 假设1主播 + N观众
    const maxBandwidth = SERVER_SPECS.media.maxBandwidth;
    const viewersPerServer = Math.floor(maxBandwidth / bitratePerUserMbps);
    
    const serversNeeded = Math.ceil(concurrentUsers / viewersPerServer);
    
    return {
      mediaServers: Math.ceil(serversNeeded * (1 + redundancy)),
      totalBandwidthMbps: concurrentUsers * bitratePerUserMbps,
      scenario: '大型直播'
    };
  }

  /**
   * 通用场景估算
   */
  calculateGeneric(concurrentUsers, bitratePerUserMbps, redundancy) {
    const totalBandwidthMbps = concurrentUsers * bitratePerUserMbps;
    const serversNeeded = Math.ceil(totalBandwidthMbps / SERVER_SPECS.media.maxBandwidth);
    
    return {
      mediaServers: Math.ceil(serversNeeded * (1 + redundancy)),
      totalBandwidthMbps,
      scenario: '通用场景'
    };
  }

  /**
   * 计算edge实例配置
   */
  calculateInstances(concurrentUsers, mediaServers, channelModel) {
    const connectionsPerServer = Math.min(
      concurrentUsers / mediaServers,
      SERVER_SPECS.media.maxProcesses * SERVER_SPECS.media.connectionsPerProcess
    );
    
    const recommendedProcesses = Math.min(
      Math.ceil(connectionsPerServer / SERVER_SPECS.media.connectionsPerProcess),
      SERVER_SPECS.media.maxProcesses
    );
    
    // 根据场景分配AUT/UDP/WEB实例
    if (channelModel === '1v1+rec') {
      return {
        udp_edge_cnt: Math.max(1, Math.floor(recommendedProcesses * 0.3)),  // 30%给录制(UDP)
        aut_edge_cnt: Math.max(1, Math.floor(recommendedProcesses * 0.7)),  // 70%给用户(AUT)
        web_edge_cnt: Math.max(1, Math.floor(recommendedProcesses * 0.5)),  // Web可选
        reasoning: 'AUT主要承载用户，UDP主要承载录制'
      };
    } else if (channelModel === '3v7+rec') {
      return {
        udp_edge_cnt: Math.max(1, Math.floor(recommendedProcesses * 0.2)),
        aut_edge_cnt: Math.max(1, Math.floor(recommendedProcesses * 0.5)),
        web_edge_cnt: Math.max(1, Math.floor(recommendedProcesses * 0.5)),
        reasoning: '主播和观众分布在AUT和WEB'
      };
    } else {
      return {
        udp_edge_cnt: Math.max(1, Math.floor(recommendedProcesses * 0.3)),
        aut_edge_cnt: Math.max(1, Math.floor(recommendedProcesses * 0.5)),
        web_edge_cnt: Math.max(1, Math.floor(recommendedProcesses * 0.5)),
        reasoning: '均衡分配'
      };
    }
  }

  /**
   * 生成建议
   */
  generateRecommendations(scenario, serverCalc, instances) {
    const recommendations = [];

    // 建议1: 冗余检查
    if (scenario.redundancy < 0.3) {
      recommendations.push({
        type: 'warning',
        category: '冗余配置',
        message: '建议增加30%冗余以应对峰值流量和故障切换'
      });
    }

    // 建议2: 高可用
    if (serverCalc.mediaServers === 1) {
      recommendations.push({
        type: 'info',
        category: '高可用',
        message: '单台服务器无高可用保障，建议至少部署2台媒体服务器'
      });
    } else if (serverCalc.mediaServers >= 2 && serverCalc.mediaServers < 3) {
      recommendations.push({
        type: 'success',
        category: '高可用',
        message: '当前配置支持基础高可用（主备模式）'
      });
    }

    // 建议3: 混合云优势
    if (scenario.deploymentType === 'pure' && scenario.concurrentUsers > 500) {
      recommendations.push({
        type: 'suggestion',
        category: '架构优化',
        message: '用户数较多，可考虑混合云方案节省内网出入口带宽'
      });
    }

    // 建议4: 带宽充足性
    const bandwidthPerServer = serverCalc.totalBandwidthMbps / serverCalc.mediaServers;
    if (bandwidthPerServer > 2000) {
      recommendations.push({
        type: 'warning',
        category: '性能瓶颈',
        message: `单台服务器平均带宽${Math.ceil(bandwidthPerServer)}Mbps，接近上限2500Mbps，建议增加服务器或降低码率`
      });
    }

    // 建议5: 实例数量
    const totalInstances = instances.udp_edge_cnt + instances.aut_edge_cnt + instances.web_edge_cnt;
    if (totalInstances > SERVER_SPECS.media.maxProcesses) {
      recommendations.push({
        type: 'error',
        category: '配置错误',
        message: `总实例数${totalInstances}超过单台最大${SERVER_SPECS.media.maxProcesses}，需要调整`
      });
    } else if (totalInstances < 5 && serverCalc.mediaServers > 1) {
      recommendations.push({
        type: 'info',
        category: '资源利用',
        message: '实例数较少，可考虑增加以充分利用服务器资源'
      });
    }

    return recommendations;
  }

  /**
   * 生成资源报告（文本格式）
   */
  generateReport(calculationResult, scenario) {
    const { summary, servers, instances, userBitrate, recommendations } = calculationResult;

    return `
RTC私有化资源需求评估报告
生成时间: ${new Date().toLocaleString('zh-CN')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
一、场景信息
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• 并发用户数: ${scenario.concurrentUsers}
• 频道数量: ${scenario.channels}
• 频道模型: ${scenario.channelModel}
• 媒体类型: ${scenario.hasVideo ? `视频(${scenario.videoResolution} ${scenario.fps}fps)` : '纯音频'}
• 部署类型: ${scenario.deploymentType === 'pure' ? '纯私有部署' : '混合云部署'}
• 冗余系数: ${(scenario.redundancy * 100).toFixed(0)}%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
二、资源需求汇总
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• 服务器总数: ${summary.totalServers}台
  - 媒体服务器: ${summary.mediaServers}台
  - 数据平台: ${summary.datahubServers}台

• CPU总计: ${summary.totalCPU}核
• 内存总计: ${summary.totalMemory}GB
• 存储总计: ${summary.totalStorage}GB
• 带宽总计: ${summary.totalBandwidth}Mbps (${(summary.totalBandwidth/1000).toFixed(1)}Gbps)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
三、单台服务器配置
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• 媒体服务器: 16C 32G 240GB SSD 10Gbps
• 数据平台: 16C 32G 500GB SSD 1Gbps

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
四、Edge实例配置建议
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• udp_edge_cnt: ${instances.udp_edge_cnt}
• aut_edge_cnt: ${instances.aut_edge_cnt}
• web_edge_cnt: ${instances.web_edge_cnt}
• 说明: ${instances.reasoning}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
五、码率详情
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• 单用户音频: ${userBitrate.audio}Mbps
• 单用户视频: ${userBitrate.video.toFixed(2)}Mbps
• 单用户总计: ${userBitrate.total.toFixed(2)}Mbps

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
六、建议和提示
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${recommendations.map((r, i) => `${i+1}. [${r.type.toUpperCase()}] ${r.category}: ${r.message}`).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
计算场景: ${servers.scenario}
计算依据: ${servers.calculation || '基于标准公式'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  }
}

module.exports = { RTCResourceCalculator, SERVER_SPECS, STANDARD_BITRATES };
