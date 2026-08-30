---
type: source-summary
status: processed
title: "Аудит публичного GET surface SPA stats.whoajor.com — 2026-08-30"
date: 2026-08-30
raw: /01_raw/whoajor/2026-08-30-spa-surface-audit
source: https://stats.whoajor.com/
confidence: high
tags: [cs2, whoajor, spa, api-contract, provenance]
related:
  - /02_sources/2026-08-30-whoajor-full-snapshot.md
  - /05_decisions/whoajor-collection-scope.md
---

# Аудит публичного GET surface SPA stats.whoajor.com — 2026-08-30

<!-- whoajor-spa-surface-audit-pin
{"assetRootHash":"475b268609a580444c0e4a40ee94111bde2ac5f9f2a28a63ddf10ffa9c919c0d","auditId":"2026-08-30-spa-surface-audit","capture":{"assetCount":7,"bodyReadMethod":"Response.arrayBuffer","requestCount":8,"uniqueResourceCount":7},"contract":{"sha256":"fa1e466dbe985e8acc0c26d2ac30d5edebe7af0842f4caa4a203c52248d9de7c","version":"1.1.0"},"report":{"bytes":21075,"path":"report.json","sha256":"89b54623ec52f8d8296456a622977c4eaa16260365582d79d1b30422e64a5f08"},"schemaVersion":1,"surface":{"apiOccurrences":3,"exclusions":2,"getCallSites":24,"getFamilies":16,"javascriptAssets":6}}
-->

FACT: Аудит сохраняет content-addressed HTML/JavaScript публичной SPA и доказывает соответствие
всех обнаруженных GET-шаблонов 16 семействам CONTRACT v1.1; он не повторяет массовый API-сбор.
[source: /01_raw/whoajor/2026-08-30-spa-surface-audit/manifest.json]
[source: /01_raw/whoajor/2026-08-30-spa-surface-audit/report.json] [conf: high]

## Сетевой scope и exact-byte evidence

- FACT: Выполнено 8 последовательных GET-наблюдений 7 уникальных ресурсов: корневая HTML-страница,
  6 same-origin JavaScript assets и один повторный GET корня для восстановления точного HTTP
  `content-type`; SHA-256 первого и повторного тела корня совпал. API, POST и cross-origin запросов
  во время аудита не было. [source: /01_raw/whoajor/2026-08-30-spa-surface-audit/manifest.json]
- FACT: Для запросов 1–7 использован UA
  `ushibu-nogami-whoajor-spa-audit/1.0 (+read-only-live-evidence)`, для root recovery — отдельный
  UA с суффиксом `(+read-only-live-evidence-header-recovery)`. Программные задержки перед запросами
  зафиксированы вектором `[0,0,0,250,250,250,250,0]` мс; ноль означает отсутствие отдельного sleep,
  а не нулевой интервал по часам. [source: /01_raw/whoajor/2026-08-30-spa-surface-audit/manifest.json]
- FACT: `assetRootHash=475b268609a580444c0e4a40ee94111bde2ac5f9f2a28a63ddf10ffa9c919c0d`;
  `reportSha256=89b54623ec52f8d8296456a622977c4eaa16260365582d79d1b30422e64a5f08`.
  Все 7 тел сверяются офлайн по URL, status `200`, content-type, числу байтов, SHA-256 и
  content-addressed имени blob.
  [source: /01_raw/whoajor/2026-08-30-spa-surface-audit/manifest.json] [conf: high]

FACT: Manifest фиксирует следующий полный уникальный asset inventory; суммарный размер decoded
response bodies — 1 362 716 байт.
[source: /01_raw/whoajor/2026-08-30-spa-surface-audit/manifest.json]

| URL | Content-Type | Байт | SHA-256 |
|---|---|---:|---|
| `/` | `text/html` | 773 | `dacb0f901c85d3980be9307b7868b30ed56b9af1380b8aac5c425e53944a8764` |
| `/assets/index-Dya4GurF.js` | `text/javascript` | 783 926 | `180e47da062e446da2772da8ee168f230c206664b9ed03bff1c38df8ca774fdb` |
| `/assets/TrendsPanel-CDQrfYCy.js` | `text/javascript` | 25 456 | `4b850d6e1447f51eb9f6f65796c36414d01426a9661566d3475360783dffafe8` |
| `/assets/index-DNXaRQwu.js` | `text/javascript` | 477 885 | `6402b0975c1610bcdb0f903ef364681ddfa474a7b595bdf129f89605f75ef6f5` |
| `/assets/installMarkLine-DLNQZJry.js` | `text/javascript` | 45 685 | `b3f2115dd1d01c5742009ff11ab2ffb9381a4cf0b6599fa475dd4171fa44c7e5` |
| `/assets/HBarChart-huUwdlgd.js` | `text/javascript` | 24 046 | `8bdc251743d148f47ff91bd45f33f27bda5e7bd97b5f2ff0f6d68d0d844968e7` |
| `/assets/PlayerTrends-Cp66_wMd.js` | `text/javascript` | 4 945 | `e179fce85869e2ebdd89601b8abbab088b5910d4f338232f6045cec0bc838ec8` |

## Полнота asset graph

- FACT: Корневой HTML подключает один same-origin module script; рекурсивное замыкание статических
  и динамических JS-import содержит 6 JavaScript assets и 14 направленных рёбер, все assets достижимы
  от корня, unresolved JavaScript references нет.
  [source: /01_raw/whoajor/2026-08-30-spa-surface-audit/manifest.json]
  [source: /01_raw/whoajor/2026-08-30-spa-surface-audit/report.json]
- FACT: Same-origin stylesheet исключён как неисполняемый asset; Cloudflare beacon не запрашивался,
  потому что он cross-origin и вне разрешённого same-origin scope. Оба исключения воспроизводятся
  непосредственно из exact HTML. [source: /01_raw/whoajor/2026-08-30-spa-surface-audit/manifest.json]

## GET surface и CONTRACT v1.1

- FACT: В JavaScript есть три буквальных `/api/` anchor: общий helper `dt(e)` с `fetch(url)` без
  `method` (default GET), `POST /api/matches/{matchId}/tags` и `POST /api/draft-config`.
  [source: /01_raw/whoajor/2026-08-30-spa-surface-audit/report.json]
- FACT: Общий GET-helper имеет 23 прямых `dt(...)` call site в основном модуле и один alias-call
  ``ht(`trends${vt({top:10})}`)`` в `TrendsPanel`: основной модуль экспортирует `dt as m`, а chunk
  импортирует `m as ht`. Верификатор независимо строит ограниченное замыкание named
  ESM export/import/re-export, сверяет все 24 balanced call site и делает offline gate красным при
  новом или неразмеченном alias-call даже без нового буквального `/api/`.
  [source: /01_raw/whoajor/2026-08-30-spa-surface-audit/report.json]

FACT: Все 24 GET call site отображены ровно на следующие 16 семейств CONTRACT v1.1; отсутствующих
семейств, лишних GET templates, неизвестных `/api/` anchor и unmapped call site — 0.
[source: /01_raw/whoajor/2026-08-30-spa-surface-audit/report.json] [conf: high]

| Family | Метод | Path template | Fixed query |
|---|---|---|---|
| `meta` | GET | `/api/meta` | — |
| `tags` | GET | `/api/tags` | — |
| `draftConfig` | GET | `/api/draft-config` | — |
| `trends` | GET | `/api/trends` | `top=10` в зафиксированной SPA |
| `matches` | GET | `/api/matches` | — |
| `matchDetail` | GET | `/api/matches/{matchId}` | — |
| `leaderboard` | GET | `/api/leaderboard` | — |
| `playerSummary` | GET | `/api/players/{steamid}/summary` | — |
| `playerMaps` | GET | `/api/players/{steamid}/maps` | — |
| `playerWeapons` | GET | `/api/players/{steamid}/weapons` | — |
| `playerWeaponsByDay` | GET | `/api/players/{steamid}/weapons` | `by=day` |
| `playerMatches` | GET | `/api/players/{steamid}/matches` | — |
| `weapons` | GET | `/api/weapons` | — |
| `weaponDetail` | GET | `/api/weapons/{weapon}` | — |
| `weaponDetailByDay` | GET | `/api/weapons/{weapon}` | `by=day` |
| `weaponSplits` | GET | `/api/weapon-splits` | — |

FACT: Два mutation endpoint явно исключены из GET-импорта: `POST /api/matches/{matchId}/tags`
и `POST /api/draft-config`; exact method evidence для обоих содержит `method:"POST"`.
[source: /01_raw/whoajor/2026-08-30-spa-surface-audit/report.json] [conf: high]

INFERENCE: Полноту full snapshot следует формулировать как полноту CONTRACT v1.1 относительно
публичного GET surface зафиксированной SPA только после покрытия всех 16 семейств: contract version
`1.1.0` и SHA-256 `fa1e466dbe985e8acc0c26d2ac30d5edebe7af0842f4caa4a203c52248d9de7c`
связаны с exact SPA evidence, а не только с вручную перечисленными endpoint'ами. Зафиксированная SPA
вызывает `trends` с `top=10` через query-builder alias `Ut → q → vt`; стратегия полного сбора может
использовать другое положительное `top`, но обязана покрыть все обнаруженные сущности.
[source: /01_raw/whoajor/2026-08-30-spa-surface-audit/report.json] [conf: high]

## Ограничения

- FACT: Blobs содержат точные decoded bytes, прочитанные через `Response.arrayBuffer()`; для root
  сервер сообщил `content-encoding: br`, но сжатые wire bytes не сохранялись.
  [source: /01_raw/whoajor/2026-08-30-spa-surface-audit/manifest.json]
- FACT: Точные HTTP timestamps первых семи запросов не сохранились; manifest явно маркирует времена
  завершения записи файлов как proxy. Точное время есть только у восьмого root recovery GET.
  [source: /01_raw/whoajor/2026-08-30-spa-surface-audit/manifest.json]
- UNKNOWN: Аудит не доказывает существование или отсутствие серверных GET routes, на которые
  зафиксированная SPA не ссылается. Закрыл бы пробел авторитетный server route inventory или OpenAPI
  от владельца сервиса. [source: /01_raw/whoajor/2026-08-30-spa-surface-audit/report.json]
- RISK: Новая публикация SPA может изменить surface после даты аудита; тогда CI проверит целостность
  исторического evidence, но новый CONTRACT потребует отдельного разрешённого аудита и version bump.
  [source: /01_raw/whoajor/2026-08-30-spa-surface-audit/manifest.json]
- RISK: Alias-анализ намеренно ограничен статическими named ESM import/export/re-export. Если будущая
  SPA перенесёт GET-helper через default/namespace import или вычисляемое присваивание, аудитору
  потребуется расширить verifier до публикации нового surface report.
  [source: /01_raw/whoajor/2026-08-30-spa-surface-audit/report.json]
