-- ============================================
-- RTC私有化部署管理服务
-- Version: 1.1.0
-- Description: RTC私有化部署的资源计算、AI架构设计、配置生成
-- ============================================

-- ============================================
-- 1. 注册RTC部署服务
-- ============================================
INSERT OR REPLACE INTO portal_services (
  id, name, name_en, description, icon, base_path, api_prefix, 
  enabled, sort_order, created_at
) VALUES (
  'rtc-deployment',
  'RTC部署管理',
  'RTC Deployment Management',
  'RTC私有化部署的资源评估、AI架构设计和配置生成',
  'rocket',
  '/rtc-deployment',
  '/api/rtc-deployment',
  1,
  2,
  datetime('now')
);

-- ============================================
-- 2. RTC部署项目表
-- ============================================
CREATE TABLE IF NOT EXISTS rtc_deployment_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_name TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  
  -- 需求信息
  concurrent_users INTEGER NOT NULL,
  channels INTEGER NOT NULL,
  channel_model TEXT NOT NULL,          -- '1v1+rec', '3v7+rec', 'broadcast', 'custom'
  has_video INTEGER DEFAULT 1,
  video_resolution TEXT DEFAULT '720p', -- '360p', '720p', '1080p'
  fps INTEGER DEFAULT 15,
  deployment_type TEXT NOT NULL,        -- 'pure' or 'hybrid'
  network_type TEXT,                    -- 'intranet', 'internet', 'dmz'
  sla_requirement TEXT,
  special_requirements TEXT,            -- 特殊需求（文本）
  
  -- 状态
  status TEXT NOT NULL DEFAULT 'draft', -- draft/calculating/designing/configured/deployed
  
  -- 人员
  created_by INTEGER NOT NULL,
  sa_email TEXT,
  sa_name TEXT,
  
  -- 时间
  created_at TEXT NOT NULL,
  updated_at TEXT,
  
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_rtc_projects_status ON rtc_deployment_projects(status);
CREATE INDEX idx_rtc_projects_customer ON rtc_deployment_projects(customer_name);
CREATE INDEX idx_rtc_projects_created_by ON rtc_deployment_projects(created_by);

-- ============================================
-- 3. 资源评估结果表
-- ============================================
CREATE TABLE IF NOT EXISTS rtc_resource_estimates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  
  -- 服务器需求
  total_servers INTEGER NOT NULL,
  media_servers INTEGER NOT NULL,
  aut_edge_servers INTEGER,
  udp_edge_servers INTEGER,
  web_edge_servers INTEGER,
  datahub_servers INTEGER DEFAULT 1,
  
  -- 资源汇总
  total_cpu INTEGER NOT NULL,
  total_memory INTEGER NOT NULL,
  total_bandwidth INTEGER NOT NULL,      -- Mbps
  total_storage INTEGER NOT NULL,
  
  -- Edge实例配置
  udp_edge_cnt INTEGER,
  aut_edge_cnt INTEGER,
  web_edge_cnt INTEGER,
  instance_reasoning TEXT,
  
  -- 码率信息
  user_audio_bitrate REAL,
  user_video_bitrate REAL,
  user_total_bitrate REAL,
  
  -- 计算参数
  redundancy_factor REAL DEFAULT 0.3,
  scenario_type TEXT,
  calculation_detail TEXT,
  
  -- 建议
  recommendations_json TEXT,
  
  calculated_at TEXT NOT NULL,
  
  FOREIGN KEY(project_id) REFERENCES rtc_deployment_projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_rtc_estimates_project ON rtc_resource_estimates(project_id);

-- ============================================
-- 4. AI架构方案表
-- ============================================
CREATE TABLE IF NOT EXISTS rtc_ai_architectures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  
  -- AI相关
  ai_model TEXT NOT NULL,               -- 'qwen-plus', 'qwen-max'
  ai_prompt TEXT NOT NULL,
  ai_response_raw TEXT NOT NULL,        -- AI原始响应
  ai_request_id TEXT,                   -- 千问请求ID
  ai_token_usage INTEGER,               -- Token使用量
  
  -- 方案内容
  architecture_name TEXT,
  architecture_summary TEXT,
  architecture_json TEXT NOT NULL,      -- 完整架构JSON
  reasoning TEXT,                       -- AI设计理由
  risks_json TEXT,                      -- 风险列表
  recommendations_json TEXT,            -- 建议列表
  
  -- SA审核
  sa_reviewed INTEGER DEFAULT 0,
  sa_approved INTEGER DEFAULT 0,
  sa_comments TEXT,
  sa_reviewed_at TEXT,
  sa_reviewed_by INTEGER,
  
  -- 版本管理
  version INTEGER DEFAULT 1,
  is_current INTEGER DEFAULT 1,         -- 是否当前使用的版本
  
  generated_at TEXT NOT NULL,
  
  FOREIGN KEY(project_id) REFERENCES rtc_deployment_projects(id) ON DELETE CASCADE,
  FOREIGN KEY(sa_reviewed_by) REFERENCES users(id)
);

CREATE INDEX idx_rtc_arch_project ON rtc_ai_architectures(project_id);
CREATE INDEX idx_rtc_arch_current ON rtc_ai_architectures(project_id, is_current);

-- ============================================
-- 5. 节点配置表
-- ============================================
CREATE TABLE IF NOT EXISTS rtc_deployment_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  architecture_id INTEGER,
  
  -- 节点信息
  node_id TEXT NOT NULL,                -- 'node-1', 'node-2'
  node_name TEXT,
  hostname TEXT,
  ip_address TEXT NOT NULL,
  node_role TEXT NOT NULL,              -- 'core', 'media', 'datahub', 'monitoring'
  role_description TEXT,
  
  -- 部署服务（JSON数组）
  services_json TEXT NOT NULL,          -- ["local_ap", "vosync", ...]
  
  -- Edge实例配置
  udp_edge_cnt INTEGER DEFAULT 0,
  aut_edge_cnt INTEGER DEFAULT 0,
  web_edge_cnt INTEGER DEFAULT 0,
  
  -- 资源配置
  cpu_cores INTEGER,
  memory_gb INTEGER,
  bandwidth_mbps INTEGER,
  storage_gb INTEGER,
  
  -- mgmt.sh变量配置（JSON）
  mgmt_vars_json TEXT,
  
  created_at TEXT NOT NULL,
  
  FOREIGN KEY(project_id) REFERENCES rtc_deployment_projects(id) ON DELETE CASCADE,
  FOREIGN KEY(architecture_id) REFERENCES rtc_ai_architectures(id) ON DELETE SET NULL
);

CREATE INDEX idx_rtc_nodes_project ON rtc_deployment_nodes(project_id);
CREATE INDEX idx_rtc_nodes_arch ON rtc_deployment_nodes(architecture_id);

-- ============================================
-- 6. 生成的配置文件表
-- ============================================
CREATE TABLE IF NOT EXISTS rtc_generated_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  
  config_type TEXT NOT NULL,            -- 'mgmt_sh', 'json_config', 'deployment_doc'
  file_name TEXT NOT NULL,
  file_content TEXT NOT NULL,
  file_size INTEGER,
  
  -- 下载信息
  download_path TEXT,                   -- 服务器上的文件路径
  download_count INTEGER DEFAULT 0,
  
  generated_at TEXT NOT NULL,
  generated_by INTEGER NOT NULL,
  
  FOREIGN KEY(project_id) REFERENCES rtc_deployment_projects(id) ON DELETE CASCADE,
  FOREIGN KEY(generated_by) REFERENCES users(id)
);

CREATE INDEX idx_rtc_configs_project ON rtc_generated_configs(project_id);

-- ============================================
-- 7. AI验证记录表
-- ============================================
CREATE TABLE IF NOT EXISTS rtc_ai_validations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  
  validation_type TEXT NOT NULL,        -- 'config_check', 'architecture_review'
  ai_model TEXT NOT NULL,
  validation_result TEXT NOT NULL,      -- 'pass', 'warning', 'fail'
  validation_score INTEGER,             -- 0-100
  
  errors_json TEXT,                     -- 发现的错误（JSON数组）
  warnings_json TEXT,                   -- 警告（JSON数组）
  suggestions_json TEXT,                -- 建议（JSON数组）
  
  ai_request_id TEXT,
  validated_at TEXT NOT NULL,
  
  FOREIGN KEY(project_id) REFERENCES rtc_deployment_projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_rtc_validations_project ON rtc_ai_validations(project_id);

-- ============================================
-- 8. RTC部署服务权限定义
-- ============================================

-- 权限定义
INSERT OR IGNORE INTO permissions (service_id, code, name, description, resource_type, action, created_at) VALUES
('rtc-deployment', 'rtc:project:create', '创建部署项目', '创建新的RTC部署项目', 'project', 'create', datetime('now')),
('rtc-deployment', 'rtc:project:read', '查看部署项目', '查看RTC部署项目列表和详情', 'project', 'read', datetime('now')),
('rtc-deployment', 'rtc:project:update', '修改部署项目', '修改项目需求和配置', 'project', 'update', datetime('now')),
('rtc-deployment', 'rtc:project:delete', '删除部署项目', '删除部署项目', 'project', 'delete', datetime('now')),
('rtc-deployment', 'rtc:calculator:use', '使用资源计算器', '计算资源需求', 'calculator', 'use', datetime('now')),
('rtc-deployment', 'rtc:ai:generate', 'AI生成架构', '使用AI生成架构方案', 'ai', 'generate', datetime('now')),
('rtc-deployment', 'rtc:ai:review', 'AI方案审核', 'SA审核AI生成的方案', 'ai', 'review', datetime('now')),
('rtc-deployment', 'rtc:ai:validate', 'AI配置验证', '使用AI验证配置正确性', 'ai', 'validate', datetime('now')),
('rtc-deployment', 'rtc:config:generate', '生成配置文件', '生成mgmt.sh等配置文件', 'config', 'generate', datetime('now')),
('rtc-deployment', 'rtc:config:download', '下载部署包', '下载生成的配置和部署包', 'config', 'download', datetime('now')),
('rtc-deployment', 'rtc:settings:manage', '管理AI设置', '配置千问API Key等设置', 'settings', 'manage', datetime('now'));

-- 角色定义
INSERT OR IGNORE INTO roles (service_id, code, name, description, is_system, created_at) VALUES
('rtc-deployment', 'rtc-sa', 'RTC解决方案架构师', 'SA全权限：创建项目、AI设计、审核方案、生成配置', 1, datetime('now')),
('rtc-deployment', 'rtc-engineer', 'RTC实施工程师', '查看项目、使用计算器、下载配置', 1, datetime('now')),
('rtc-deployment', 'rtc-viewer', 'RTC查看者', '仅查看项目和评估结果', 1, datetime('now'));

-- 角色权限关联

-- rtc-sa: 所有权限
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, granted_at)
SELECT 
  (SELECT id FROM roles WHERE code = 'rtc-sa'),
  p.id,
  datetime('now')
FROM permissions p
WHERE p.service_id = 'rtc-deployment';

-- rtc-engineer: 查看、计算、下载
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, granted_at)
SELECT 
  (SELECT id FROM roles WHERE code = 'rtc-engineer'),
  p.id,
  datetime('now')
FROM permissions p
WHERE p.code IN (
  'rtc:project:read',
  'rtc:calculator:use',
  'rtc:config:download'
);

-- rtc-viewer: 仅查看
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, granted_at)
SELECT 
  (SELECT id FROM roles WHERE code = 'rtc-viewer'),
  p.id,
  datetime('now')
FROM permissions p
WHERE p.code IN (
  'rtc:project:read'
);
