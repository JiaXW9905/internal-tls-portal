#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('${ROOT_DIR}/package.json').version")"
OUT_FILE="${ROOT_DIR}/internal-tls-portal-${VERSION}.tar.gz"

cd "${ROOT_DIR}"

# 如果 node_modules 不存在，提醒用户先安装依赖
if [ ! -d "node_modules" ]; then
  echo "WARNING: node_modules not found. Please run: npm install --omit=dev"
  echo "Continuing to package without dependencies..."
fi

COPYFILE_DISABLE=1 tar \
  --exclude="internal-tls-portal.tar.gz" \
  --exclude="internal-tls-portal-*.tar.gz" \
  --exclude="data" \
  --exclude="uploads" \
  --exclude=".DS_Store" \
  -czf "${OUT_FILE}" \
  -C "${ROOT_DIR}" .

echo "Package created: ${OUT_FILE}"
echo ""
if [ ! -d "node_modules" ]; then
  echo "NOTE: node_modules was not included in the package."
  echo "The server will install dependencies during Docker build."
fi
