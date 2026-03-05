# 产业互联网内部门户

Industrial Internet Internal Portal - 企业内部服务统一门户

## Current Version
- App version: `1.0.2`
- Runtime port: `52344`
- Architecture: Portal + Multi-Service + RBAC

## Overview
统一的企业服务入口平台，提供：
- 🏠 **服务导航门户** - 卡片式服务展示，直观清晰
- 🔐 **TLS证书管理** - 证书申请、签发、下载与生命周期管理（首个接入服务）
- 🛡️ **RBAC权限系统** - 细粒度权限控制、完整审计日志
- 📊 **可扩展架构** - 支持更多企业服务快速接入

## Tech Stack
- Node.js + Express (单体应用)
- SQLite (`data/app.db`)
- RBAC Permission System (8 tables, 自研)
- Static frontend (`public/*.html`, `public/*.js`)
- Docker / Docker Compose

## Quick Start (Local)
```bash
npm install
npm start
```
Open: `http://localhost:52344`

## Quick Start (Docker)
```bash
docker compose up -d --build
docker compose ps
```

## Main Pages
- Login: `/login`
- Register: `/register`
- Forgot Password: `/forgot`
- **Portal Home: `/portal`** ⭐️ (New in v1.0)
- TLS - Request: `/` or `/tls`
- TLS - Issuance: `/admin` (admin/dev)
- TLS - Overview: `/overview` (admin/dev/product)
- TLS - Users: `/users` (admin)
- TLS - Settings: `/settings` (admin)
- Account: `/account`

## Environment
Reference file: `deploy/env.example`

Important vars:
- `PORT`
- `SESSION_SECRET`
- `ADMIN_EMAIL`
- `NODE_ENV`
- `ENV_TYPE`

## Packaging
```bash
bash deploy/package.sh
```
Output: `internal-tls-portal-<version>.tar.gz`

## Documentation
- Changelog: `CHANGELOG.md`
- Implementation Summary: `IMPLEMENTATION-SUMMARY.md`
- Quick Validation: `QUICK-VALIDATION-GUIDE.md`
- Chinese docs:
  - `docs/zh-CN/PRD.md` - 产品需求
  - `docs/zh-CN/HLD.md` - 高层设计
  - `docs/zh-CN/Developer-Runbook.md` - 开发运维手册
  - `docs/zh-CN/RBAC-Integration-Guide.md` - RBAC集成指南 ⭐️
  - `docs/zh-CN/Portal-RBAC-Implementation-Plan.md` - 实施计划 ⭐️
  - `docs/zh-CN/User-Guide.md` - 用户指南
  - `docs/zh-CN/LLM-Context-Prompt.md` - AI协作上下文
- English docs:
  - `docs/en/PRD.md`
  - `docs/en/HLD.md`
  - `docs/en/User-Guide.md`
  - `docs/en/Developer-Runbook.md`
  - `docs/en/LLM-Context-Prompt.md`

## What's New in v1.0.2
- 🎉 **Portal Architecture**: 从单一TLS系统升级为多服务门户
- 🛡️ **RBAC System**: 完整的权限管理和审计体系
- 📱 **Hierarchical Navigation**: 可展开/折叠的分层级侧边栏
- 🔌 **Service Integration**: 清晰的新服务接入机制
- ✅ **Backward Compatible**: 所有现有功能和API完全兼容
