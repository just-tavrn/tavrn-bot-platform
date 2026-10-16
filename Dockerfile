# SPDX-License-Identifier: Apache-2.0
# One image: the dashboard, the API and the bot in one Node.js process. Data (SQLite, the bot's key file and its
# encryption state) lives in /data: mount a volume there and back it up.

FROM node:25-alpine AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:25-alpine AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:25-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY package.json LICENSE NOTICE ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:8787/healthz >/dev/null || exit 1
# Node.js handles SIGTERM itself (server/main.ts stops the bot and closes the database).
CMD ["node", "--import", "tsx", "server/main.ts"]
