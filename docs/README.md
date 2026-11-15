# Docs

Pengetahuan project tinggal di sini. Buat tetap pendek, mutakhir, dan di folder yang tepat.

## Layout

| Folder      | Isi                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `decision/` | Kenapa kita pilih X, bukan Y (ADR): konteks, opsi, hasil, konsekuensi.                                                  |
| `products/` | Apa yang kita bangun: fitur, spesifikasi, arsitektur (system reference).                                                 |
| `rules/`    | Konvensi dan batasan yang wajib diikuti kontributor (dan agent).                                                         |
| `bugs/`     | Bug di **library/layanan pihak ketiga** yang kita pakai, plus workarounds.                                                |
| `guides/`   | Cara install, jalankan, dan perbaiki Second Brain. Nama file polos, tanpa nomor.                                          |

`bugs/` bukan untuk bug kita sendiri — lacak di issue tracker.

## Format file

`xxxx-name.md`: nomor urut 4 digit zero-padded, lalu nama kebab-case.

```
decision/0001-use-anvia-agent-core.md
products/0001-system-reference.md
rules/0001-workspace-and-dependencies.md
bugs/0001-openrouter-cloudflare-blocks-undici.md
```

- Nomor per folder, mulai `0001`, berjalan tanpa gap.
- Doc yang tidak lagi benar (bugnya fix upstream, workarounds hilang) dihapus, folder dinomori ulang, dan link ke doc yang bergeser diperbaiki.
- Setiap doc diawali `# Judul` dan baris `Status:`.
