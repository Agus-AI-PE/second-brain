# Workspace and Dependencies

Status: Current

Konvensi yang wajib diikuti di monorepo ini:

- **pnpm only.** Node.js 22, pnpm 10 (`packageManager` di root). Jangan pernah npm/yarn, tidak ada lockfile lain. Perintah dijalankan per-workspace: `pnpm --dir <workspace> run <script>` — tidak ada script root.
- **Dependency hidup di workspace pemakainya**, bukan root. Root `package.json` hanya metadata workspace.
- **Jangan tambah paket `dotenv`** di workspace yang pakai `dotenv-cli` — instalasinya menimpa binary `dotenv` dan merusak semua script (insiden nyata di apps/platform). `eval.ts` membaca env dari dotenv-cli saja.
- **File generated tidak diedit, tidak di-commit**: `apps/api/src/generated/` (Prisma client). Ubah `schema.prisma`, lalu jalankan script — lihat `guides/install-and-run.md`.
- **Prisma selalu lewat script npm** (`db:generate`, `db:migrate`, `db:studio` di `apps/api`), yang memuat root `.env` via dotenv-cli. Jangan panggil `prisma` langsung.
- **`dist/` dan `node_modules/` di-gitignore** di semua workspace; build output tidak di-commit.
- Kesalahan library yang berdampak lintas-wilayah didokumentasikan di `docs/bugs/`, bukan dibiarkan sebagai pengetahuan suku-bangsa.
