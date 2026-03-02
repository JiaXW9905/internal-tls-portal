#!/usr/bin/env bash
set -euo pipefail

# Ensure writable directories for SQLite + uploads when using bind mounts.
mkdir -p /app/data /app/uploads

# The node official image contains a 'node' user with uid/gid 1000.
chown -R node:node /app/data /app/uploads || true

# Start app as non-root.
exec su -s /bin/sh node -c "npm start"

