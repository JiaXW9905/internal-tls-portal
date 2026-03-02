#!/usr/bin/env bash
set -euo pipefail

# 构建并推送基础镜像的脚本
# 用法: bash build-base-image.sh <docker_hub_username>

if [ $# -lt 1 ]; then
  echo "Usage: bash build-base-image.sh <docker_hub_username>"
  echo "Example: bash build-base-image.sh myusername"
  exit 1
fi

DOCKER_USERNAME=$1
IMAGE_NAME="${DOCKER_USERNAME}/internal-tls-portal-base"
TAG="node18-deps-v1"

echo "====================================="
echo "Building base image: ${IMAGE_NAME}:${TAG}"
echo "====================================="

# 确保已登录 Docker Hub
echo "Checking Docker login status..."
if ! docker info 2>/dev/null | grep -q "Username"; then
  echo "Please login to Docker Hub first:"
  echo "  docker login"
  exit 1
fi

# 构建基础镜像
echo "Building base image with dependencies..."
docker build -f Dockerfile.base -t "${IMAGE_NAME}:${TAG}" .

# 推送到 Docker Hub
echo "Pushing to Docker Hub..."
docker push "${IMAGE_NAME}:${TAG}"

echo ""
echo "====================================="
echo "Base image created and pushed!"
echo "Image: ${IMAGE_NAME}:${TAG}"
echo "====================================="
echo ""
echo "Next steps:"
echo "1. Update Dockerfile to use this base image:"
echo "   FROM ${IMAGE_NAME}:${TAG}"
echo "2. Remove the npm install step from Dockerfile"
echo ""
