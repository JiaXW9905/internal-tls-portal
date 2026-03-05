# Internal TLS Portal Developer & Operations Runbook

## 1. Scope
This runbook is for future developers and operators. It covers:
- local development startup
- Docker deployment
- release packaging
- upgrade and rollback
- day-to-day operations
- troubleshooting

Current baseline: `0.9.8.4`

---

## 2. Repository Map
- Backend entry: `src/server.js`
- DB bootstrap/migration: `src/db.js`
- Frontend pages: `public/*.html` + `public/*.js`
- Docker compose: `docker-compose.yml`
- Container entrypoint: `deploy/docker-entrypoint.sh`
- Packaging script: `deploy/package.sh`
- Optional base image script: `deploy/build-base-image.sh`
- Persistent data directory: `data/`
- Persistent file directory: `uploads/`

---

## 3. Local Development

### 3.1 Prerequisites
- Node.js 18+
- npm
- Docker / Docker Compose (for container validation)

### 3.2 Run without Docker
```bash
npm install
npm start
```
Default URL: `http://localhost:52344`

### 3.3 Run with Docker
```bash
docker-compose up -d --build
docker-compose ps
```
Stop:
```bash
docker-compose down
```

---

## 4. Environment Configuration
Reference file: `deploy/env.example`

Key variables:
- `PORT` (default `52344`)
- `SESSION_SECRET` (must be strong in production)
- `ADMIN_EMAIL`
- `NODE_ENV=production`
- `ENV_TYPE=prod`

Production notes:
- Keep real secrets in `deploy/env.prod`, never commit secrets.
- Validate `SESSION_SECRET` before each release.

---

## 5. Release Packaging

### 5.1 Build release tarball
```bash
bash deploy/package.sh
```
Output example: `internal-tls-portal-0.9.8.4.tar.gz`

### 5.2 Dependency packaging behavior
- If local `node_modules` exists, tarball includes dependencies (faster server build).
- If missing, dependencies are installed during Docker build on server (slower).

---

## 6. Production Deployment (Docker)

### 6.1 Standard manual flow
```bash
# 1) Upload package
scp internal-tls-portal-<version>.tar.gz devops@<server>:/home/devops/wjx/tls/

# 2) Unpack to new version directory
tar -xzf internal-tls-portal-<version>.tar.gz -C /home/devops/wjx/tls/internal-tls-portal-<version>

# 3) Prepare env file
cp /home/devops/wjx/tls/internal-tls-portal-<prev>/deploy/env.prod /home/devops/wjx/tls/internal-tls-portal-<version>/deploy/env.prod

# 4) Copy persistent data when needed
cp -r /home/devops/wjx/tls/internal-tls-portal-<prev>/data /home/devops/wjx/tls/internal-tls-portal-<version>/
cp -r /home/devops/wjx/tls/internal-tls-portal-<prev>/uploads /home/devops/wjx/tls/internal-tls-portal-<version>/

# 5) Start
cd /home/devops/wjx/tls/internal-tls-portal-<version>
docker-compose up -d --build
docker-compose ps
```

### 6.2 If your environment has `docker-upgrade.sh`
Use your environment-maintained upgrade script:
```bash
bash docker-upgrade.sh internal-tls-portal-<version>.tar.gz
```
> This script is not part of this repository.

---

## 7. Upgrade and Rollback

### 7.1 Mandatory pre-upgrade
- Backup `data/app.db`
- Backup `uploads/`
- Record currently running version/container
- Verify port `52344` availability

### 7.2 Fast rollback
Rollback to previous known-good version directory and keep same mounted data.

```bash
# stop bad version
cd /home/devops/wjx/tls/internal-tls-portal-<bad_version>
docker-compose down

# start previous good version
cd /home/devops/wjx/tls/internal-tls-portal-<good_version>
docker-compose up -d
```

If data corruption is suspected, restore backed-up DB/files first.

---

## 8. Day-to-day Operations

### 8.1 Health check
```bash
curl -s http://127.0.0.1:52344/api/health
```
Expected: `{"ok":true}`

### 8.2 Logs
```bash
docker ps
docker logs <container_name>
docker logs -f <container_name>
```

### 8.3 Runtime checks
```bash
docker-compose ps
docker-compose top
```

---

## 9. Troubleshooting Playbook

### 9.1 `Failed to fetch` / `ERR_CONNECTION_REFUSED`
Usually app is down or crashed.
1. Check `docker ps`
2. Inspect `docker logs <container>`
3. Validate `GET /api/health`

### 9.2 Overview page empty / API errors
Check recent SQL changes in `/api/overview`, especially:
- `ORDER BY` + `LIMIT/OFFSET` order
- alias consistency in joined queries

### 9.3 Build stuck at `npm install`
Options:
1. include `node_modules` during packaging (supported now)
2. use prebuilt dependency base image (`Dockerfile.base`, `deploy/build-base-image.sh`)

### 9.4 Old/test data appears after upgrade
Check:
- copied `data/` and `uploads/` source paths
- volume mount paths
- wrong environment access (localhost vs production)

### 9.5 Version badge missing
Check:
- `public/version.js`
- script inclusion in page
- badge injection script loading

---

## 10. Data Maintenance
Clear all certificate business data (keep users/settings):
```bash
node deploy/clear-all-certificates.js
```
> Recommended only for test-data reset or clean import preparation.

---

## 11. Go-live Checklist
- [ ] `CHANGELOG.md` updated
- [ ] `package.json` and `public/version.js` versions aligned
- [ ] `deploy/env.prod` validated (`SESSION_SECRET` in particular)
- [ ] DB and uploads backup done
- [ ] Smoke tests pass (login, request, issue, download, overview)
- [ ] Role and data-scope checks pass
- [ ] Upgrade and rollback path validated
- [ ] Post-release checks pass (`/api/health`, logs, version badge)

---

## 12. Handover Recommendations
- Publish this runbook together with PRD/HLD in internal doc portal.
- Add a “release-specific notes” section for each production release.
- Keep a fixed release cadence: pre-review -> release window -> post-release observation.

