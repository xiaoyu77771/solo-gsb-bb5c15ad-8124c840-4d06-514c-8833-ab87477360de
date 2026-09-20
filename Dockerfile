FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# 先装依赖（利用镜像层缓存）；better-sqlite3 使用官方预编译二进制
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# SQLite 数据目录（可挂载卷持久化）
ENV PORT=3000 \
    DB_PATH=/app/data/app.db
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000

# 启动时自动完成数据库建表与示例数据初始化
CMD ["node", "server.js"]
