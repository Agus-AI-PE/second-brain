FROM node:22-slim

RUN corepack enable \
  && apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/agent/package.json packages/agent/
COPY apps/api/package.json apps/api/
COPY apps/platform/package.json apps/platform/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --dir apps/api exec prisma generate

ENV NODE_ENV=production
