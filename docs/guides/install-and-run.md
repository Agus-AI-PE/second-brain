# Install and Run

Status: Current

## Requirement

- Node.js 22, pnpm 10
- Docker Compose, atau Postgres/Redis/Qdrant yang sudah jalan

## Setup

```sh
cp .env.example .env   # isi nilainya
pnpm install           # generate Prisma client ke apps/api/src/generated/
```

Postgres butuh database `secondbrain`. Schema: users/access control (`User`, `AccessRequest`), memories (`Memory`), reminders (`Reminder`).

Detail semua variabel env: `docs/products/0001-system-reference.md`.

## Infra

```sh
docker compose up -d                       # postgres, redis, qdrant + app services
docker compose up -d postgres redis qdrant # hanya backing services
```

## Prisma

```sh
pnpm --dir apps/api run db:generate           # regenerate client (setelah edit schema)
pnpm --dir apps/api run db:migrate -- --name <name>
pnpm --dir apps/api run db:studio
```

## Jalankan

```sh
pnpm --dir apps/api run dev                    # HTTP API + dashboard :3000
pnpm --dir apps/api run worker                 # embedding pipeline worker
pnpm --dir apps/platform run dev               # Telegram agent bot (long polling)
pnpm --dir apps/platform run reminder-worker   # reminder delivery worker
pnpm --dir apps/dashboard run dev              # dashboard dev server (Vite)
pnpm --dir apps/mcp-server run dev             # MCP server (stdio)
```

## Tests

```sh
pnpm --dir packages/agent test     # vitest
pnpm --dir apps/platform test      # vitest
```

## Deploy

Docker image build dashboard, generate Prisma client, lalu jalankan services dari `docker-compose.yaml`: `migrate` (one-shot), `api`, `worker` (embeddings), `reminder` (delivery).
