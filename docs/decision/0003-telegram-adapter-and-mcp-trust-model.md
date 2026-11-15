# Telegram Adapter Rewrite & MCP Trust Model

Status: Accepted, 2026-09-19

## Konteks

Bot awalnya long-polling custom di `apps/platform` (telegram.ts) dan tools agent dipanggil in-process. PRD minta MCP server sebagai lapisan tools eksternal.

## Opsi

1. Pertahankan polling custom; MCP server tetap panggil store langsung.
2. Rewrite ke adapter channel `@anvia/telegram` dan MCP stdio server; per-request spawn, context lewat env child process.

## Hasil

Kami memilih opsi 2:

- `createBot()` membungkus `telegram({ token, polling })` dari `@anvia/telegram` — typing, split pesan, actions (inline approve/deny), attachment loading otomatis. `telegram.ts` lama masih dipakai reminder-worker saja.
- MCP server (`apps/mcp-server`, stdio) dispawn per request via `McpClientGroup`; context (`SB_TELEGRAM_USER_ID`/`SB_CHAT_ID`/`SB_ATTACHMENT_*`) dikirim lewat env child process, lalu group di-close di `teardownRequest()`.

## Konsekuensi

- **Trust model**: chatId/telegramUserId untuk tool selalu terikat dari Telegram update (atau env proses), tidak pernah bisa dipilih LLM. Prinsip ini wajib untuk tool baru — lihat `rules/0002-secrets-and-trust-model.md`.
- Kalau MCP connect gagal, fallback ke in-process tools agar bot tetap hidup.
- Launch path MCP server default absolut dari `mcp.ts`; bisa dioverride `MCP_SERVER_COMMAND`.
- Fallback in-process harus tetap dipelihara; penghapusan tools in-process akan mematikan fallback.
