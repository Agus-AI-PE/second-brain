# Secrets and Trust Model

Status: Current

Aturan keamanan yang tidak bisa dinegosiasikan:

- **Jangan pernah commit secret atau `.env`.** Setiap variabel juga ada di `.env.example` dengan placeholder aman.
- **chatId/telegramUserId untuk tool selalu trusted-bound.** Nilainya datang dari Telegram update (atau env proses, mis. `SB_TELEGRAM_USER_ID` untuk MCP), tidak pernah dari keluaran LLM. Tool baru harus mengikuti pola ini — ini sengaja dirancang: LLM tidak boleh bisa memilih tujuan aksi.
- **Admin approval**: bypass hanya untuk `ADMIN_TELEGRAM_ID`; user lain mulai `PENDING` dan wajib approve/deny oleh admin (inline button atau `/dashboard`).
- **SSRF guard wajib** pada semua kode yang mengambil URL dari user (scrape, download attachment) sebelum di-request.
- **Akses lintas-user**: query Qdrant wajib difilter `userId` = UUID internal Postgres (bukan telegram ID) — isolasi multi-user bergantung padanya.
- **Reminder delivery idempoten**: transisi state PENDING → SENDING → SENT, sweep memastikan job telat tetap terkirim dan tidak dobel.
