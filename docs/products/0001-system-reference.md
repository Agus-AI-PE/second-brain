# System Reference

Status: Current (direview 2026-11-15). Sumber: implementasi aktual + PRD.

Second Brain: personal knowledge system lewat Telegram bot. Catatan/URL/foto/dokumen diarsipkan, di-OCR, di-embed, lalu bisa dicari lewat agent dengan memory dan reminder.

## Stack

- Node.js 22 + TypeScript (tsx), pnpm workspace
- Hono (REST API) + React + Vite (dashboard di `/dashboard`)
- Prisma 7.9 + PostgreSQL 16 (metadata; vektor di Qdrant)
- Redis + BullMQ (queue `embedding`, queue `send-reminder`)
- Qdrant (vektor, cosine, 2048-dim)
- Mistral OCR (foto/dokumen), Cloudflare R2 (arsip permanen)
- OpenRouter embeddings via `/usr/bin/curl` — lihat `bugs/0001`
- Chat model OpenAI-compatible untuk agent (`@anvia/core`) — lihat `decision/0001`
- `@anvia/telegram` adapter (polling), `@anvia/lens` observability
- MCP stdio server (`@modelcontextprotocol/server`)

## Struktur

```
.
├── apps/
│   ├── api/               # Hono HTTP API, mount admin dashboard, BullMQ embedding worker
│   │   ├── prisma/        # schema + migrations
│   │   └── src/
│   │       ├── index.ts   # health, memory CRUD, URL scrape, /search, /dashboard
│   │       ├── worker.ts  # download → OCR → R2 → embed → Qdrant
│   │       ├── embed.ts vector.ts r2.ts queue.ts
│   ├── platform/          # Telegram bot: agent runtime, access control, reminders
│   │   └── src/
│   │       ├── index.ts bot.ts handler.ts   # wiring, polling, handling
│   │       ├── memory-store.ts              # MemoryStore contract (Prisma+Qdrant+BullMQ)
│   │       ├── reminder-worker.ts           # delayed job + sweep PENDING 60s
│   │       ├── eval.ts cli.ts               # RAG eval suite + agent CLI
│   │       └── *.test.ts                    # vitest
│   ├── dashboard/         # React + Vite admin UI
│   └── mcp-server/        # MCP stdio: 3 tools memory + reminders
└── packages/
    └── agent/             # @second-brain/agent: createMemoryAgent, classifier, tools,
                            # conversation memory, reminder queue, Lens observer
```

## Alur data

1. User kirim note/URL/foto/dokumen ke bot Telegram.
2. Access control: user baru `PENDING`; admin approve/deny via inline button bot atau `/dashboard`.
3. Bot persist row `Memory` dan enqueue job embedding (frasa eksplisit "simpan"/"remember this", atau intent hasil klasifikasi agent). URL disave → scrape server-side.
4. Worker: download file Telegram → Mistral OCR → arsip R2 → embed OpenRouter → upsert vektor Qdrant.
5. Search: bot embed query, search Qdrant filter `userId`, agent menjawab dari hasil dalam bahasa user.
6. Reminder: tool agent menjadwalkan delayed job BullMQ; `reminder-worker` kirim via Telegram, sweep menutup gap job telat (idempoten PENDING→SENDING→SENT).
7. Tools yang sama diekspos via MCP untuk client eksternal (per-request spawn, context via env) — lihat `decision/0003`.

## Kontrak penting

- **MemoryStore**: satu kontrak, satu implementasi (Prisma + Qdrant + BullMQ). Semua akses data lewat ini.
- **Agent**: `createMemoryAgent({ store, embed, model, memory, trustedChatId, scheduleReminder })` → `runAgent()`. Tools tahu `chatId` dari trusted binding, bukan dari LLM.
- **Conversation memory**: Redis per user, TTL 24 jam, maks 40 pesan; time context (WIB + aturan relative-time) disuntik per-turn.
- **Lens**: `LensClient({ optional: true })` — disabled kalau env `ANVIA_LENS_*` kosong; flush per-request, close di shutdown.

## Layanan & perintah

| Layanan | Perintah | Port/Job |
|---|---|---|
| REST API + dashboard | `pnpm --dir apps/api run dev` | :3000 |
| Embed worker | `pnpm --dir apps/api run worker` | queue `embedding` |
| Telegram bot | `pnpm --dir apps/platform run dev` | long-polling |
| Reminder worker | `pnpm --dir apps/platform run reminder-worker` | queue `send-reminder` + sweep 60s |
| Infra | `docker compose up -d` | Postgres 5432, Redis 6379, Qdrant 6333 |

## Environment

Lihat `.env.example` untuk daftar lengkap. Ringkas:

| Var | Tujuan |
|---|---|
| `DATABASE_URL` / `REDIS_URL` / `QDRANT_URL` | Infra |
| `EMBED_URL` / `EMBED_MODEL` / `EMBED_API_KEY` / `EMBED_DIM` | OpenRouter embeddings |
| `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `AGENT_MODEL` | Chat model agent |
| `JUDGE_MODEL` | Model eval |
| `TELEGRAM_BOT_TOKEN` / `ADMIN_TELEGRAM_ID` | Bot + approval admin |
| `DASHBOARD_URL` | URL dashboard di pesan `/dashboard` |
| `API_PORT` | Port API + dashboard (default 3000) |
| `MISTRAL_API_KEY` | Mistral OCR |
| `R2_*` | Arsip R2 |
| `ANVIA_LENS_*` | Observability Lens (kosong = disabled) |
| `MCP_SERVER_COMMAND` | Launch command MCP server |
