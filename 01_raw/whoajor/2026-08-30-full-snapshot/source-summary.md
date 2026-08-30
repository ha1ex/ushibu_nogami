---
type: source-summary
title: "Полный снимок stats.whoajor.com — 2026-08-30-full-snapshot"
date: 2026-08-30
raw: "/01_raw/whoajor/2026-08-30-full-snapshot"
source: "https://stats.whoajor.com"
confidence: high
tags: [whoajor, cs2, full-snapshot]
---

# Полный снимок stats.whoajor.com — 2026-08-30-full-snapshot

## Provenance и полнота

FACT: Снимок содержит ровно 863 HTTP-ответов, 368 матчей, 368 карточек матчей, 81 игроков, 39 видов оружия и 1 тегов. [source: /01_raw/whoajor/2026-08-30-full-snapshot/validation-report.json]

FACT: Точный временной диапазон источника: `2023-11-16T19:08:00` — `2026-08-27T20:04:00`. [source: /01_raw/whoajor/2026-08-30-full-snapshot/responses/2a8d5ff40f455a640c8e606b768a05af5ab3fecad5db12980c34e2a09389705b.json]

FACT: Валидатор подтвердил статус `complete`; root hash: `3ec0c97ff8e1ba4181b6a7a72aa4aa9391926b4afeda617880a1a25d0298eb34`. [source: /01_raw/whoajor/2026-08-30-full-snapshot/validation-report.json]

FACT: Нормализованная SQLite сохранила те же exact counts; data fingerprint SQLite: `eb8f79492f442d2fb3cc57f5751d226dd23c73f66f3425e33fdc0376a1bee3a0`; SHA-256 распакованной SQLite: `d0c575401a5c1caf62c4b551327b6bf43aa7426ed9c39c9d073d07a34084fad8`; SHA-256 файла whoajor.sqlite.gz: `9aaea6cb8854f0469869e96cc68f56ed82f9a3980ca2e12b77a3411f6fea2452`. [source: /01_raw/whoajor/2026-08-30-full-snapshot/whoajor.sqlite.gz]

FACT: Канонический raw evidence — manifest и content-addressed exact HTTP bodies в каталоге `/01_raw/whoajor/2026-08-30-full-snapshot`. [source: /01_raw/whoajor/2026-08-30-full-snapshot/manifest.json]

INFERENCE: Совпадение counts в независимом validation report и SQLite позволяет использовать базу как производное представление raw-снимка, но не заменяет raw evidence. [source: /01_raw/whoajor/2026-08-30-full-snapshot/validation-report.json] [source: /01_raw/whoajor/2026-08-30-full-snapshot/whoajor.sqlite.gz]

## Методологические ограничения

FACT: SteamID хранится в SQLite только как TEXT, без числового преобразования. [source: /01_raw/whoajor/2026-08-30-full-snapshot/whoajor.sqlite.gz]

UNKNOWN: Индивидуальные агрегаты игроков не доказывают сыгранность пятёрки; контракт снимка не содержит отдельного измерения командной когезии. [source: /01_raw/whoajor/2026-08-30-full-snapshot/contract.json]

## Расхождения источника

FACT: Валидатор не зафиксировал source discrepancies. [source: /01_raw/whoajor/2026-08-30-full-snapshot/validation-report.json]
