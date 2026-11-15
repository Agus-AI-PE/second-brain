# new URL(path, base) Overrides the Base Path

Status: Resolved; jangan dipakai untuk URL dasar website

## Gejala

Insiden "HTML challenge" lama: `new URL(path, base)` menimpa seluruh path base kalau `path` diawali `/` — URL jadi salah, request mendarat di rute website Cloudflare, dapat challenge page.

## Workaround

Bangun URL endpoint dengan string concat, bukan constructor `new URL()`. Selalu tulis endpoint lengkap (host + path) untuk API yang dilindungi Cloudflare.
