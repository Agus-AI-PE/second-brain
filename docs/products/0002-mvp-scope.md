# MVP Scope (PRD Checklist)

Status: ~95% MVP PRD per 2026-09-19. Sumber: PRD_personal_knowledge_management_agent.md.

## Checklist

| # | Item PRD | Status | Bukti |
|---|----------|--------|-------|
| 1 | Telegram interface | ✅ | `@anvia/telegram` 0.3.0 (polling), typing, split, actions, attachments |
| 2 | Text ingestion | ✅ | Tool `save_memory`, conversation memory multi-turn |
| 3 | URL ingestion (scrape) | 🟡 | Scrape di REST API + handler /simpan URL; agent belum auto-detect URL → scrape (~30 m) |
| 4 | Image ingestion (Vision OCR) | ✅ | Mistral OCR: JPG/PNG/WEBP/BMP/GIF + PDF; arsip R2 + presign |
| 5 | Anvia AI Agent orchestrator | ✅ | `packages/agent`: createMemoryAgent, tools via MCP atau in-process |
| 6 | Semantic search (RAG) | ✅ | Embedding → Qdrant, hasil + sourceUrl + foto dikembalikan |
| 7 | MCP Server | ✅ | `apps/mcp-server` stdio, 3 tools; per-request spawn + fallback in-process |
| 8 | BullMQ + reminder one-time | ✅ | Delayed job + sweep PENDING 60s |
| 9 | Langfuse observability/eval | ✅ (Lens) | `@anvia/lens`, RAG eval suite `pnpm --dir apps/platform run eval` (2/2 pass) |
| 10 | Monorepo pnpm | ✅ | apps/api, apps/platform, apps/mcp-server, packages/agent |
| 11 | Self-hosted deploy + Cloudflare Tunnel | 🟡 | Jalan di Mac dev; PRD minta WSL2 + tunnel + webhook |

## Gap tersisa (urutan kerja)

1. URL scrape auto-detect di agent (~30 m)
2. Deploy WSL2 + Cloudflare Tunnel + webhook mode `webhook: { secretToken }` (1–2 j; adapter sudah dukung)
