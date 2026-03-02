FROM node:18-bullseye

WORKDIR /app

# 先复制所有文件（包括 node_modules）
COPY . .

# 如果 node_modules 不存在，则安装依赖
RUN if [ ! -d "node_modules" ]; then \
      npm config set registry https://registry.npmmirror.com && \
      npm install --omit=dev; \
    fi

RUN mkdir -p /app/data /app/uploads && chown -R node:node /app && chmod +x /app/deploy/docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 52344

ENTRYPOINT ["/app/deploy/docker-entrypoint.sh"]
