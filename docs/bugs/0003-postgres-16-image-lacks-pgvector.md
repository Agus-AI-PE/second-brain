# Postgres 16 Image Lacks pgvector

Status: Resolved untuk volume sekarang; waspadai volume baru

## Gejala

Migrasi Prisma init memakai pgvector, tetapi image `postgres:16` polos tidak punya extension. Volume dev DB yang di-flush gagal migrate.

## Workaround

Jalankan init SQL manual tanpa baris vector, lalu `migrate resolve --applied` untuk migrasi init, lanjut migrasi berikutnya normal. Alternatif lebih bersih: ganti image ke `pgvector/pgvector`. Lihat catatan volume 19/9 di `decision/0003` dan riwayat `.progress`.
