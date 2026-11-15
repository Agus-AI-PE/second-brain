# Use Anvia Agent Core from Day 1

Status: Accepted, 2026-09-11

## Konteks

Second Brain butuh agent LLM yang mendeteksi intent, memanggil tool (save/search/reminder), dan menjaga conversation memory multi-turn. Pertanyaannya: bangun orchestrator sendiri atau pakai runtime yang sudah ada.

## Opsi

1. Tulis agent loop sendiri di atas API OpenAI-compatible.
2. Pakai `@anvia/core` (agent runtime + MemoryStore contract + tool scaffolding) sebagai fondasi.

## Hasil

Kami memilih opsi 2: `@anvia/core` WAJIB day-1, bukan ditunda. Stack LLM-nya OpenAI-compatible saja (gateway/OpenRouter/OpenAI/Anthropic bisa ditukar lewat env `OPENAI_BASE_URL`/`AGENT_MODEL`), tanpa SDK vendor spesifik.

## Konsekuensi

- Intent, guardrails, conversation memory, dan tool wiring tidak perlu dibangun dari nol (`packages/agent` tinggal merakit `createMemoryAgent`).
- Upgrades core (mis. 1.5.0 untuk Lens observability) harus disamakan di semua workspace yang memakainya (`packages/agent`, `apps/platform`, `apps/api`) supaya store/tool dibuat dari satu instansi core.
- Eval + observability mengikuti ekosistem Anvia: `@anvia/lens` untuk trace, `evalReporter` untuk RAG eval.
