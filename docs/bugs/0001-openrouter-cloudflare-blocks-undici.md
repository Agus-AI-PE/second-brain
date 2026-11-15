# OpenRouter/Cloudflare Blocks Node fetch (undici) TLS

Status: Active workaround

## Gejala

Embedding via `fetch`/undici dari Node digagal oleh Cloudflare dengan halaman challenge HTML — request TLS dari undici terdeteksi bot.

## Workaround

Panggil OpenRouter lewat subprocess `/usr/bin/curl` (`apps/api/src/embed.ts` + `packages/agent`). Jangan "perbaiki" ini kembali ke `fetch`. Respons `<!DOCTYPE` (challenge page) dideteksi lalu di-retry.
