# Hono c.json Cannot Serialize BigInt

Status: Active workaround

## Gejala

`c.json()` di Hono melempar error saat payload memuat `BigInt` (mis. id dari DB driver).

## Workaround

Selalu `.toString()` nilai BigInt sebelum masuk respons. Jangan biarkan tipe BigInt bocor ke layer HTTP.
