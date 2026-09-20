# --- Dashboard build (Vite static, served by API at /dashboard) ---
FROM node:22-slim AS dashboard
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/dashboard/package.json apps/dashboard/
RUN pnpm install --frozen-lockfile
COPY apps/dashboard apps/dashboard
RUN pnpm --dir apps/dashboard run build

FROM node:22-slim

RUN corepack enable \
  && apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/agent/package.json packages/agent/
COPY apps/api/package.json apps/api/
COPY apps/platform/package.json apps/platform/
COPY apps/mcp-server/package.json apps/mcp-server/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --dir apps/api exec prisma generate

# Static dashboard served by the API at /dashboard
COPY --from=dashboard /app/apps/dashboard/dist apps/dashboard/dist

ENV NODE_ENV=production
