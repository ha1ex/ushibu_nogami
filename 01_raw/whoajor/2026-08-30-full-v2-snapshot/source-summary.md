---
type: source-summary
title: "Полный снимок stats.whoajor.com — 2026-08-30-full-v2-snapshot"
date: 2026-08-30
raw: "/01_raw/whoajor/2026-08-30-full-v2-snapshot"
source: "https://stats.whoajor.com"
confidence: high
tags: [whoajor, cs2, full-snapshot]
---

# Полный снимок stats.whoajor.com — 2026-08-30-full-v2-snapshot

## Provenance и полнота

FACT: Снимок содержит ровно 864 HTTP-ответов, 368 матчей, 368 карточек матчей, 81 игроков, 39 видов оружия, 1 тегов, 20 игроков trends и 2987 строк матчей trends. [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/validation-report.json]

FACT: Точный временной диапазон источника: `2023-11-16T19:08:00` — `2026-08-27T20:04:00`. [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/responses/2a8d5ff40f455a640c8e606b768a05af5ab3fecad5db12980c34e2a09389705b.json]

FACT: Валидатор подтвердил статус `complete`; root hash: `84a051d7989725f22fd8bc37969f9308b2282edcdc61bf6b3477a021d8c71ee2`. [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/validation-report.json]

FACT: Нормализованная SQLite сохранила те же exact counts; data fingerprint SQLite: `5a0e563128ab92cc2bad823852850c2fd3668155120f216a0116694b4de578a7`; SHA-256 распакованной SQLite: `0cc8105931ef2491c29504eb5b0ef115d77090def76bd0adcf1b3ab5fff2d4a1`; SHA-256 файла whoajor.sqlite.gz: `917af8cec282dc68fa00ffbcbd2117b0b4587c02da0313ebe8359f7fca8b1234`. [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/whoajor.sqlite.gz]

FACT: Канонический raw evidence — manifest и content-addressed сохранённые JSON-тела HTTP-ответов в каталоге `/01_raw/whoajor/2026-08-30-full-v2-snapshot`. [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/manifest.json]

INFERENCE: Совпадение counts в независимом validation report и SQLite позволяет использовать базу как производное представление raw-снимка, но не заменяет raw evidence. [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/validation-report.json] [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/whoajor.sqlite.gz]

## Методологические ограничения

FACT: SteamID хранится в SQLite только как TEXT, без числового преобразования. [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/whoajor.sqlite.gz]

UNKNOWN: Индивидуальные агрегаты игроков не доказывают сыгранность пятёрки; контракт снимка не содержит отдельного измерения командной когезии. [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/contract.json]

## Расхождения источника

FACT: Валидатор не зафиксировал source discrepancies. [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/validation-report.json]
