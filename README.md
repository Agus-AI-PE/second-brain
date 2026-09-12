# Second Brain

Personal knowledge system driven by a Telegram bot. Save notes, links, photos, and documents; they get archived, OCR'd, embedded, and become searchable through an AI agent with memory and reminders.

## Stack

- Node.js + TypeScript (tsx)
- Hono
- Prisma 7.9 + PostgreSQL 16 (metadata only — vectors live in Qdrant)
- Redis + BullMQ (embedding pipeline)
- Qdrant (vector store, cosine, 2048-dim)
- Mistral OCR (document/photo text extraction)
- Cloudflare R2 (file archive)
- OpenRouter embeddings (via `/usr/bin/curl` — bypasses Cloudflare bot protection)
- OpenAI-compatible chat model for the agent (`@anvia/core`)
- pnpm workspace

## Structure

```text
.
├── apps/
│   ├── api/               # Hono API, Telegram bot, BullMQ worker
│   │   ├── prisma/        # schema + migrations
│   │   └── src/
│   │       ├── index.ts   # HTTP API (health, memory CRUD, search)
│   │       ├── bot.ts     # Telegram polling bot (saves, search, reminders)
│   │       ├── worker.ts  # BullMQ worker: download → OCR → R2 → embed → Qdrant
│   │       ├── agent.ts   # @anvia Agent with save/search/reminder tools
│   │       ├── embed.ts   # OpenRouter embeddings (curl-based)
│   │       ├── vector.ts  # Qdrant collection ops
│   │       ├── r2.ts      # R2 archiver
│   │       └── queue.ts   # BullMQ queue
│   └── platform/          # Telegram admin access control (approve/deny users)
└── packages/
    └── agent/             # Intent detection, prompts, agent tools, tracing
```

## Requirements

- Node.js, pnpm
- Docker Compose, or reachable PostgreSQL / Redis / Qdrant

## Setup

```bash
cp .env.example .env   # fill in values
pnpm install           # generates Prisma client into apps/api/src/generated/
```

Postgres needs database `secondbrain`. Schema: users/access control (`User`, `AccessRequest`), memories (`Memory`), reminders (`Reminder`).

## Infrastructure

```bash
docker compose up -d   # postgres, redis, qdrant
```

## Prisma

```bash
pnpm --dir apps/api run db:generate   # regenerate client (after schema edits)
pnpm --dir apps/api run db:migrate -- --name <name>
pnpm --dir apps/api run db:studio
```

All prisma commands load the root `.env` via `dotenv-cli`. `apps/api/src/generated/` is gitignored — run `db:generate` after clone.

## Run

```bash
pnpm --dir apps/api run dev      # HTTP API on :3000
pnpm --dir apps/api run bot      # Telegram bot (long polling)
pnpm --dir apps/api run worker   # embedding pipeline worker
pnpm --dir apps/platform run dev # admin access-control bot
```

## Data flow

1. User sends note/link/photo/document to Telegram bot.
2. Bot persists `Memory` row and enqueues an embedding job (explicit save phrases like "simpan"/"remember this" or agent-detected intent).
3. Worker: downloads Telegram file → Mistral OCR → archives to R2 → embeds via OpenRouter → upserts vector in Qdrant.
4. Search: bot embeds the query, searches Qdrant filtered by `userId`, agent answers from results in the user's language.

## Environment

See `.env.example` for the full list. Never commit `.env` — it's gitignored.

| Var | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection |
| `REDIS_URL` | Redis for BullMQ |
| `QDRANT_URL` | Qdrant instance |
| `EMBED_URL` / `EMBED_MODEL` / `EMBED_API_KEY` | OpenRouter embeddings |
| `EMBED_DIM` | Vector dimension (default 2048) |
| `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `AGENT_MODEL` | Chat model for the agent |
| `TELEGRAM_BOT_TOKEN` / `ADMIN_TELEGRAM_ID` | Bot + admin approval |
| `MISTRAL_API_KEY` | Mistral OCR |
| `R2_*` | Cloudflare R2 archive |

## Tests

```bash
pnpm --dir packages/agent test     # vitest
pnpm --dir apps/platform test      # vitest
```
