# Qdrant Instead of pgvector

Status: Accepted, 2026-09-12

## Konteks

Membutuhkan penyimpanan vektor 2048-dim untuk RAG search. Database metadata sudah Postgres.

## Opsi

1. pgvector di Postgres yang sama.
2. Qdrant terpisah, Postgres hanya metadata.

## Hasil

Kami memilih opsi 2. Qdrant (cosine, 2048-dim); Postgres menyimpan teks/metadata/reminder saja. Migrasi Prisma terakhir meng-drop pgvector.

## Konsekuensi

- Qdrant payload `userId` = **UUID internal Postgres**, bukan telegram ID. Search wajib resolve user dulu (`resolveUserByTelegramId`) — filter dengan telegram ID menghasilkan hits=0 selamanya (bug historis).
- Isolasi multi-user lewat filter internal UUID, bukan tabel terpisah.
- Menghapus memory di DB harus juga menghapus titik vektornya (`deleteMemoryVector` di DELETE API) — kalau tidak, titik yatim melayang.
- Infra bertambah satu container Qdrant (port 6333).
