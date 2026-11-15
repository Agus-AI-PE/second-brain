# @anvia/channel Message Actions Validation

Status: Active workaround

## Gejala

Reply bot lempar `Channel message actions must be a non-empty array` atau
`Channel message action IDs must be unique`. Sebelum fix, handler admin
access (`/pending`, `/approve`, `/deny`) selalu gagal saat daftar kosong
atau daftar user menghasilkan action ID duplikat.

## Penyebab

`validateChannelActions` di `@anvia/channel@0.4.0` menolak:

- array kosong (harus `non-empty array`);
- action ID yang tidak unik dalam satu pesan;
- lebih dari 5 actions per pesan (hard cap);
- label kosong atau > 80 karakter.

## Workaround

Di `apps/platform/src/handler.ts`:

- Daftar kosong → reply teks polos **tanpa** field `actions` (jangan kirim `[]`).
- ID action unik per user: `noop:<telegramUserId>`; callback handler mengenali
  prefix `noop:` sebagai no-op.
- Cap `MAX_MESSAGE_ACTIONS = 5`; daftar pending berhenti di 4 (2 user ×
  approve+deny) supaya pasangan tombol tetap lengkap.

Di `apps/platform/src/index.ts`, dua call-site `reply()` memakai guard
`actions: r.actions?.length ? r.actions : undefined`.

Aturan bawaannya: pengirim pesan bertanggung jawab mengirim actions yang
sudah valid — library tidak menoleransi array kosong.
