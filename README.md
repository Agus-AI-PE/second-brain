# Second Brain

API service for a personal knowledge system. Current API exposes a minimal Hono health endpoint and uses PostgreSQL with pgvector for future memory storage.

## Stack

- Node.js
- TypeScript
- Hono
- Prisma 7.9.0
- PostgreSQL 16 with pgvector
- Redis
- pnpm

## Requirements

- Node.js
- pnpm
- Docker with Compose, or reachable PostgreSQL and Redis services
- PostgreSQL database `secondbrain`
- PostgreSQL `vector` extension

## Project Structure

```text
.
├── apps/
│   └── api/
│       ├── prisma/
│       │   └── schema.prisma
│       ├── src/
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
├── .env
├── docker-compose.yaml
├── package.json
├── pnpm-workspace.yaml
└── prisma.config.ts
```

## Environment

Create `second-brain/.env`:

```env
DATABASE_URL="postgresql://postgres:supersecretpassword@192.168.1.26:5432/secondbrain?schema=public"
REDIS_URL="redis://192.168.1.26:6379"
```

`DATABASE_URL` must point to a PostgreSQL instance reachable from the machine running Prisma.

## Install

From project root:

```bash
pnpm install
```

Install uses workspace dependencies and keeps Prisma at version `7.9.0`.

## Local Infrastructure

Start PostgreSQL with pgvector and Redis:

```bash
docker compose up -d
```

Check services:

```bash
docker compose ps
```

Stop services:

```bash
docker compose down
```

Persistent data uses Docker volumes `pgdata` and `redisdata`.

## Prisma

Schema path:

```text
apps/api/prisma/schema.prisma
```

The `Memory` model stores text, Telegram file IDs, source type, timestamps, and optional `vector(1536)` embeddings.

Generate Prisma Client:

```bash
pnpm --dir apps/api run db:generate
```

Create and apply a development migration:

```bash
pnpm --dir apps/api run db:migrate -- --name init_vector_db
```

Check migration status:

```bash
pnpm --dir apps/api exec dotenv -e ../../.env -- prisma migrate status
```

Prisma commands load environment variables through `dotenv-cli` and the root `.env` file.

## Development

Start API in watch mode:

```bash
pnpm --dir apps/api run dev
```

API listens on:

```text
http://localhost:3000
```

Health endpoint:

```bash
curl http://localhost:3000/
```

Expected response:

```text
Hello Hono!
```

## Available Scripts

Run from `apps/api`:

| Command | Purpose |
| --- | --- |
| `pnpm run dev` | Start Hono API with `tsx watch` and root `.env` |
| `pnpm run build` | Compile TypeScript to `dist/` |
| `pnpm run start` | Start compiled API |
| `pnpm run db:migrate -- --name <name>` | Create and apply development migration |
| `pnpm run db:generate` | Generate Prisma Client |
| `pnpm run postinstall` | Sync Prisma skills when available |

## Validation

Build the API:

```bash
pnpm --dir apps/api run build
```

Validate Prisma schema:

```bash
pnpm --dir apps/api exec prisma validate --schema prisma/schema.prisma
```

If validation reports a database connection error, verify `DATABASE_URL`, network access, PostgreSQL availability, credentials, and the pgvector extension.

## Troubleshooting

### `P1001: Can't reach database server`

Confirm PostgreSQL is running and reachable:

```bash
nc -vz 192.168.1.26 5432
```

If using Docker locally:

```bash
docker compose up -d postgres
```

### `dotenv: command not found`

Install dependencies from project root:

```bash
pnpm install
```

### Migration command fails

Confirm Prisma version:

```bash
pnpm --dir apps/api exec prisma --version
```

Expected Prisma CLI version:

```text
7.9.0
```

### pgvector extension missing

Enable the extension in the target database:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

The PostgreSQL user must have permission to create extensions.
