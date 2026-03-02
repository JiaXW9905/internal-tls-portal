# Internal TLS Certificate Portal

Internal web portal for TLS certificate request, issuance, download, and lifecycle overview.

## Current Version
- App version: `0.9.8.1` (will be bumped with each release)
- Runtime port: `52344`

## Tech Stack
- Node.js + Express
- SQLite (`data/app.db`)
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
- Request: `/`
- Issuance: `/admin`
- Overview: `/overview`
- Users (admin): `/users`
- Settings (admin): `/settings`

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
- Chinese docs:
  - `docs/zh-CN/PRD.md`
  - `docs/zh-CN/HLD.md`
  - `docs/zh-CN/User-Guide.md`
  - `docs/zh-CN/Developer-Runbook.md`
  - `docs/zh-CN/LLM-Context-Prompt.md`
- English docs:
  - `docs/en/PRD.md`
  - `docs/en/HLD.md`
  - `docs/en/User-Guide.md`
  - `docs/en/Developer-Runbook.md`
  - `docs/en/LLM-Context-Prompt.md`
