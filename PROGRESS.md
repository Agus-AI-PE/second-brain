# Second Brain — Progress & Plan

> Update: 2026-09-12. Sumber: PRD_personal_knowledge_management_agent.md + implementasi aktual.

## Status Layanan (dev Mac lokal)

| Layanan | Perintah | Port/Job |
|---|---|---|
| REST API (Hono) | `pnpm --dir apps/api run dev` | :3000 |
| Embed worker (BullMQ) | `pnpm --dir apps/api run worker` | queue `embedding` |
| Telegram bot (Anvia agent) | `pnpm --dir apps/platform run dev` | long-polling |
| Reminder worker | `pnpm --dir apps/platform run reminder-worker` | queue `send-reminder` + sweep 60s |
| Infra | `docker compose up -d` | Postgres 5432, Redis 6379, Qdrant 6333 |

Env yang wajib terisi di `.env`: `DATABASE_URL`, `REDIS_URL`, `QDRANT_URL`, `EMBED_URL/MODEL/API_KEY/DIM`, `OPENAI_BASE_URL/API_KEY`, `AGENT_MODEL`, `MISTRAL_API_KEY`, `TELEGRAM_BOT_TOKEN`, `ADMIN_TELEGRAM_ID`, `R2_ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET`.

## Arsitektur Aktual

```
packages/agent        ← reusable, tanpa Telegram/DB
  agent.ts            createMemoryAgent({store, embed, model, memory, trustedChatId, scheduleReminder}), runAgent()
  classifier.ts       classifyIntent + routeAndRespond (intent/sentiment zod)
  conversation-memory Anvia MemoryStore contract, Redis-backed per user (TTL 24j, 40 msg)
  tools/              save_memory, search_memory, set_reminder (chatId trusted-bound, bukan dari LLM)
  providers/openai.ts createCompletionModel (OpenAI-compatible: gateway/OpenRouter/dll)
  intent.ts reminder-queue.ts  intent regex ID + BullMQ queue factory
  embedding: EMBED_* env via /usr/bin/curl (Cloudflare memblok fetch/undici)

apps/api              REST + infra
  index.ts            POST/GET/DELETE /memories, POST /search, GET /health
  worker.ts           OCR (jika foto) → embedText → upsert Qdrant
  embed.ts vector.ts r2.ts queue.ts

apps/platform         Telegram runner
  index.ts            long-polling, gate akses (ADMIN_TELEGRAM_ID bypass / APPROVED / request),
                      caption = intent, OCR+R2 untuk foto/gambar/PDF, agentFor(chatId) per-request
  memory-store.ts     implementasi kontrak MemoryStore (Prisma+Qdrant+BullMQ)
  reminder-worker.ts  delayed job delivery + sweep PENDING (idempoten: PENDING→SENDING→SENT)
  access*.ts handler.ts telegram.ts   scaffold admin approval (belum digabung ke index.ts)
```

Alur: pesan/foto/caption → agent Anvia pilih tool → Postgres (teks/metadata) + R2 (file) + Mistral OCR (gambar/PDF) → BullMQ embed → Qdrant (vektor 2048, filter internal userId). Reminder: DB row + delayed job + sweep.

## ✅ Selesai & Teruji Live

- Text save/search natural via chat ("simpan…", "cariin…")
- Caption foto = intent: "simpan X" / "cariin X" di gambar
- Foto JPG + file PNG/WEBP/BMP/GIF + PDF → OCR → tersimpan
- Reminder end-to-end: set via chat → delayed job → notif Telegram jam H + sweep telat
- Multi-turn conversation memory ("hari ini" dipahami setelah tanya balik)
- Time context per-turn (tanggal/jam WIB + aturan relative-time)
- Klasifikasi intent/sentiment (`classifyIntent`, zod-validated)
- Multi-user: isolasi Qdrant filter internal UUID, FK cascade, sesi per user, gate akses
- Keamanan: chatId reminder bound dari Telegram update (LLM tak bisa pilih chat), SSRF-guard scrape
- Infra: 5 migrasi Prisma (terakhir drop pgvector → Qdrant), R2 arsip permanen
- 23 test hijau (8 agent, 15 platform)

## ❌ Gap vs MVP PRD

| Item | Catatan | Estimasi |
|---|---|---|
| Langfuse observability | dep 0; Anvia sediakan `@anvia/langfuse`; trace LLM/tool/cost + RAG eval | 2–4 j |
| MCP Server | tools masih panggil store langsung; PRD minta lapisan MCP | ~1 hari |
| Cloudflare Tunnel + deploy | polling tak butuh tunnel; PRD minta webhook+tunnel di WSL2 | 1–2 j (infra) |
| URL scrape di bot | scrape ada di REST API saja; bot belum routing URL → scrape | 30 m |
| RAG evaluations | butuh Langfuse dulu | ikut Langfuse |

## Urutan Kerja Berikutnya

1. URL scrape di bot (30 m) — nilai langsung, tinggal deteksi URL di `handleMessage` → pakai scrape logic apps/api
2. Langfuse (2–4 j) — `@anvia/langfuse`, env `LANGFUSE_*`, pasang observer di agent
3. Gabung scaffold admin approval (inline button /pending /approve) ke bot index.ts
4. MCP Server refactor (~1 hari)
5. Deploy: webhook + Cloudflare Tunnel, ganti long-polling

## Catatan Teknis Penting (jangan hilang)

- **Qdrant payload `userId` = internal UUID Postgres**, bukan telegram ID. Search wajib resolve dulu (`resolveUserByTelegramId`) — bug lama: filter pakai telegram ID → hits=0 selamanya.
- **Embedding via curl subprocess**: OpenRouter/Cloudflare memblok TLS undici (node fetch) dengan challenge page; `/usr/bin/curl` lolos. Deteksi `<!DOCTYPE` → retry.
- **`new URL(path, base)`** menimpa path base jika path diawali `/` — penyebab insiden "HTML challenge" (URL salah → rute website). Sekarang string concat.
- **BigInt serialization**: Hono `c.json` gagal serialisasi BigInt — selalu `.toString()` dulu.
- **Orphan Qdrant points**: hapus memory di DB tak selalu bersih titik lama; sudah ada `deleteMemoryVector` di DELETE API.
- **Orphan reminder schedule**: worker mati saat due → sweep 60s menutup gap.
- Model gateway devscale tersedia: `gpt-5.6-luna`, `deepseek-v4.1-flash`, `gemini-3.8-flash`, `glm-5.3-flash`, `muse-spark-1.3-contributor`.
