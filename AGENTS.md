# AGENTS.md

Batasan dan gaya kerja untuk AI agent dan kontributor. Cara tiap bagian bekerja ada di `docs/products/0001-system-reference.md`; kenapa demikian ada di `docs/decision/`.

## Overview

pnpm workspace monorepo (Node 22, TypeScript, tsx).

```
apps/              api (HTTP API + dashboard mount + embed worker), platform (Telegram bot,
                   reminder worker, evals), dashboard (React + Vite), mcp-server (stdio MCP)
packages/          agent (@second-brain/agent: agent runtime, tools, conversation memory, queue)
docs/              Pengetahuan project (lihat docs/README.md)
```

## Commands

Di root (tanpa script npm root — perintah per-workspace):

```sh
pnpm install                                   # install semua workspace + generate Prisma client
pnpm --dir apps/api run dev                    # HTTP API + dashboard :3000
pnpm --dir apps/api run worker                 # embedding pipeline worker
pnpm --dir apps/platform run dev               # Telegram bot (long polling)
pnpm --dir apps/platform run reminder-worker   # reminder delivery
pnpm --dir packages/agent test                 # vitest
pnpm --dir apps/platform test                  # vitest
pnpm --dir apps/platform run eval              # RAG eval suite (butuh infra jalan)
```

Port: API + dashboard `3000`. Infra: Postgres `5432`, Redis `6379`, Qdrant `6333`.

## Constraints

- **pnpm only.** Node 22, pnpm 10. Dependency di workspace pemakainya. Jangan pernah tambah paket `dotenv` di workspace yang pakai dotenv-cli. Rules: `docs/rules/0001`.
- **Secrets.** Jangan pernah commit `.env` atau secret. Setiap variabel juga ada di `.env.example` dengan placeholder aman. Rules: `docs/rules/0002`.
- **chatId trusted-bound.** Chat ID/telegramUserId untuk tool agent selalu terikat dari Telegram update atau env proses — tidak pernah dari keluaran LLM. Rules: `docs/rules/0002`.
- **Jangan edit file generated**: `apps/api/src/generated/` (Prisma client). Ubah `schema.prisma`, lalu `pnpm --dir apps/api run db:generate`. Prisma hanya lewat script npm yang memuat root `.env`.
- **Jangan "perbaiki" workaround terdokumentasi**: embedding lewat subprocess `/usr/bin/curl` (`bugs/0001`), `.toString()` BigInt sebelum `c.json` (`bugs/0002`), URL endpoint via string concat, bukan `new URL()` (`bugs/0004`).
- **Isolasi multi-user**: query Qdrant wajib filter `userId` = UUID internal Postgres, bukan telegram ID (`decision/0002`).
- **Akses data lewat MemoryStore** (satu kontrak, satu implementasi di `apps/platform/src/memory-store.ts`). Jangan panggil Prisma/Qdrant/BullMQ langsung dari handler.
- **Environment**: semua konfigurasi via `.env` (lihat `.env.example`); jangan hardcode konfigurasi di source.

## By area

- **packages/agent** (`@second-brain/agent`): tanpa Telegram dan tanpa DB langsung. `createMemoryAgent({ store, embed, model, memory, trustedChatId, scheduleReminder })`; tools menerima dependency lewat injection, bukan import store global. Provider chat model harus OpenAI-compatible (`providers/openai.ts`).
- **apps/platform** (bot runner): semua akses user lewat access gate (`ADMIN_TELEGRAM_ID` bypass / APPROVED / request). Attachment: photo = image tanpa filename (JPG), document = sisanya; download max 20MB via `channel.loadAttachment`. Reply auto-split via `channel.splitMessage`. Eval suite wajib bawa context header `telegramUserId` (log `user=0` = header ketinggalan).
- **apps/api** (Hono): respons selalu BigInt-free (`bugs/0002`). Worker pipeline: download → OCR (jika foto/PDF) → R2 → embed → Qdrant. DELETE memory wajib ikut hapus vektor Qdrant (`deleteMemoryVector`).
- **apps/mcp-server**: 3 tools memory + reminder, stdio. Client memspawn per-request dengan context via env child (`SB_TELEGRAM_USER_ID` dst.) dan close di `teardownRequest()`; fallback in-process tools harus tetap berfungsi (`decision/0003`).
- **apps/dashboard** (React + Vite): build diserve oleh API di `/dashboard`; jangan hardcode origin backend — panggil via path yang diserve.

## Docs

Sebelum kerja non-trivial, cek `docs/` (format `xxxx-name.md`, nomor per folder, lihat `docs/README.md`):

- `docs/rules/`: konvensi wajib. Ini meng-override default di sini.
- `docs/decision/`: keputusan lama. Jangan dibalik diam-diam; tulis decision baru yang menyusul.
- `docs/products/`: apa yang product lakukan, termasuk system reference.
- `docs/bugs/`: bug **library/layanan pihak ketiga** yang kita andalkan, plus workarounds. Bug kita sendiri ke issue tracker.

## Working style

- Perubahan kecil dan fokus; ikuti gaya kode di sekelilingnya. Baca bagian area terkait di `docs/products/0001-system-reference.md` dulu.
- Commit atomik kecil dengan subject imperatif singkat.
- Jalankan test dari area yang diubah sebelum commit. Test terhadap yang nyata bila bisa, dan sebutkan apa yang tidak bisa diverifikasi.
- Pilihan signifikan dicatat sebagai decision doc di pull request yang sama. Kalau perubahan mengubah cara kerja suatu bagian, perbarui bagiannya di `docs/products/0001-system-reference.md`.
- Jangan commit, push, merge, atau release kecuali diminta.
- Doc bernomor di dua pull request terbuka bisa tabrakan: renumber yang kedua saat merge.
