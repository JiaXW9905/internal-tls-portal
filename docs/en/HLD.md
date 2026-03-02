# Internal TLS Portal High-Level Design (HLD)

## 1. Overview
This system is a monolithic Node.js web app for certificate request, issuance, download, overview, user management, and system settings.  
Deployment model: single Docker container + SQLite + local file storage via bind mounts.

## 2. Goals and Design Principles
- **Low complexity**: single process + SQLite for fast internal delivery.
- **Upgradeable/Rollbackable**: version-folder deployment pattern.
- **Permission first**: centralized auth + query-level data scoping.
- **Operable**: clear health endpoint, logs, data directory, and file directory.

## 3. Architecture
- Frontend: static pages + vanilla JavaScript (`public/*.html`, `public/*.js`).
- Backend: Express app (`src/server.js`).
- Data store: SQLite (`data/app.db`).
- Artifact storage: certificate ZIP files in `uploads/`.
- Session: `express-session` MemoryStore (current implementation).
- Scheduler: `node-cron` for expiry notification emails.

## 4. Runtime Components
- App entry: `src/server.js`
- DB bootstrap/migration: `src/db.js`
- Container entrypoint: `deploy/docker-entrypoint.sh`
- Compose: `docker-compose.yml`
- Environment config: `deploy/env.prod` (from `deploy/env.example`)

## 5. Module Design

### 5.1 Auth and Authorization
- `requireAuth`: session check.
- `requireRole`: role-based authorization.
- `requireAdmin`: admin-only endpoints.
- Query-level data scoping is additionally enforced (for example `/api/requests`).

### 5.2 Requests and Certificates
- `requests` table stores workflow status (`pending/issued/revoked/withdrawn`).
- `request_certificates` stores certificate file metadata and issue/revoke metadata.
- Listing joins latest active certificate per request.

### 5.3 Overview
- APIs: `GET /api/overview`, `GET /api/overview/export`
- Supports keyword/status/expiring filters.
- Expiry display policy: explicit expiry field first; otherwise `cert_created_at + 730 days`.

### 5.4 User and Settings
- User APIs: role update, profile edit, password reset, email verify.
- System settings persisted in `system_settings` (SMTP and notifications).

## 6. Data Flow (Summary)
1. Frontend calls `/api/*`.
2. Backend enforces session and role checks.
3. SQLite queries run with permission constraints.
4. Download endpoint reads files from `uploads/`.
5. State transitions persisted for issue/revoke/withdraw actions.

## 7. Deployment Topology
- Container exposes port `52344`.
- Host bind mounts:
  - `./data -> /app/data`
  - `./uploads -> /app/uploads`
- Benefit: data persistence across image/container upgrades.

## 8. Upgrade and Rollback Design
- Upgrade: unpack new version folder -> copy data/env -> start new container.
- Rollback: stop current version -> restart previous version folder/container.
- Mandatory: backup `data/app.db` and `uploads/` before release.

## 9. Observability and Troubleshooting Entrypoints
- Health check: `GET /api/health`
- Primary logs: `docker logs <container>`
- Common failure classes:
  - Port already in use
  - SQL syntax/runtime failures
  - DB metadata vs file-system inconsistency

## 10. Known Technical Debt and Recommendations
- `express-session` MemoryStore is not production-grade; migrate to Redis.
- SQLite is fine at current scale; migrate to MySQL/PostgreSQL when concurrency grows.
- Add automated regression tests (permissions, pagination, upgrade paths).
- Standardize release script pipeline (precheck + deploy + verify + rollback).

## 11. Document Links
- PRD: `docs/en/PRD.md`
- Planned follow-up docs:
  - User Operation Guide
  - Developer/Ops Runbook
  - Go-live Checklist
  - LLM context prompt template

