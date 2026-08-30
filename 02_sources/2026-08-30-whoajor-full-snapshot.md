---
type: source-summary
status: processed
title: "Полный снимок stats.whoajor.com v2 — 2026-08-30"
date: 2026-08-30
raw: /01_raw/whoajor/2026-08-30-full-v2-snapshot
source: https://stats.whoajor.com/
confidence: high
tags: [cs2, whoajor, stats, full-snapshot, sqlite]
related:
  - /00_context/product.md
  - /02_sources/2026-08-30-whoajor-spa-surface-audit.md
  - /03_wiki/metric-equivalent-team-matches.md
  - /05_decisions/whoajor-collection-scope.md
---

# Полный снимок stats.whoajor.com v2 — 2026-08-30

FACT: `2026-08-30-full-v2-snapshot` — канонический полный GET-снимок публичной статистики Whoajor
относительно зафиксированной публичной SPA: 16 GET-семейств CONTRACT v1.1, включая `/api/trends`.
Каноническое evidence — manifest и content-addressed сохранённые JSON-тела HTTP-ответов; SQLite —
проверенное производное представление. [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/manifest.json]
[source: /02_sources/2026-08-30-whoajor-spa-surface-audit.md] [conf: high]

FACT: Предшествующий `2026-08-30-full-snapshot` на CONTRACT v1.0 содержит 863 запроса, покрывает
15 семейств и не содержит `/api/trends`. [source: /01_raw/whoajor/2026-08-30-full-snapshot/manifest.json]
[source: /02_sources/2026-08-30-whoajor-spa-surface-audit.md] [conf: high]

INFERENCE: Поэтому v1 сохранён только как superseded historical snapshot, а каноническим для
аналитики является v2. [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/manifest.json]
[source: /02_sources/2026-08-30-whoajor-spa-surface-audit.md] [conf: high]

RISK: Сохранённые JSON-тела исторического v1 нельзя использовать как доказательство byte-exact
копии исходных HTTP-байтов. [source: /01_raw/whoajor/2026-08-30-full-snapshot/manifest.json] [conf: high]

## Объём и provenance

- FACT: Сбор `2026-08-30-full-v2` шёл с `2026-08-30T07:40:12.050Z` до
  `2026-08-30T11:06:11.417Z` и сохранил 864 GET-ответа с content-addressed JSON-телами.
  [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/manifest.json]
- FACT: Снимок охватывает 368 матчей и все 368 карточек матчей, 81 игрока, 39 видов оружия,
  один тег, 20 игроков trends и 2 987 строк матчей trends; в метаданных представлены 46 карт.
  [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/validation-report.json]
  [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/data-profile.json]
- FACT: Диапазон матчей — от `2023-11-16T19:08:00` до `2026-08-27T20:04:00`; 222 матча отмечены
  источником как стандартные и 146 как community.
  [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/responses/2a8d5ff40f455a640c8e606b768a05af5ab3fecad5db12980c34e2a09389705b.json]
- FACT: Root hash снимка — `84a051d7989725f22fd8bc37969f9308b2282edcdc61bf6b3477a021d8c71ee2`;
  версия контракта — `1.1.0`. [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/manifest.json]
- FACT: В карточках матчей находятся 7 903 раунда, и заявленное каждым матчем число раундов
  совпало с фактическим: `roundsDeclared = roundsActual = 7 903`, расхождений по матчам — 0.
  [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/data-profile.json]

## Нормализованная SQLite

- FACT: SQLite содержит 29 обязательных STRICT-таблиц; `PRAGMA integrity_check` вернул `ok`,
  `PRAGMA foreign_key_check` не нашёл нарушений, а проверка grain/primary key не нашла пустых,
  NULL или дублирующихся ключей. [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/data-profile.json]
- FACT: В базе 368 строк матчей, 3 819 игроков в матчах, 7 903 раунда, 76 516 player-round,
  76 516 записей ростеров раундов, 29 887 связей «игрок × оружие × матч», 9 629 клатч-событий,
  20 строк игроков trends и 2 987 строк матчей trends.
  [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/data-profile.json]
- FACT: Независимые cross-count проверки дали 368 detail-запросов, 368 матчей с деталями,
  0 несовпадений ID карточки с ID матча и 0 расхождений числа раундов.
  [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/data-profile.json]
- FACT: Data fingerprint SQLite — `5a0e563128ab92cc2bad823852850c2fd3668155120f216a0116694b4de578a7`;
  SHA-256 распакованной базы — `0cc8105931ef2491c29504eb5b0ef115d77090def76bd0adcf1b3ab5fff2d4a1`,
  SHA-256 `whoajor.sqlite.gz` — `917af8cec282dc68fa00ffbcbd2117b0b4587c02da0313ebe8359f7fca8b1234`.
  [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/data-profile.json]
  [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/whoajor.sqlite.gz]

### Row counts всех таблиц

FACT: Профиль подтвердил exact row count и заявленный grain всех 29 таблиц; дубликатов по primary
key нет. [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/data-profile.json]

| Таблица | Строк | Grain |
|---|---:|---|
| `draft_config` | 1 | snapshot + version |
| `draft_igls` | 5 | snapshot + version + IGL key |
| `draft_players` | 30 | snapshot + version + SteamID |
| `leaderboard_snapshots` | 162 | snapshot + query + SteamID |
| `match_player_weapons` | 29 887 | match + SteamID + weapon |
| `match_players` | 3 819 | match + SteamID |
| `match_rounds` | 7 903 | match + round |
| `match_tags` | 93 | match + tag |
| `matches` | 368 | match |
| `meta_maps` | 46 | snapshot + map |
| `player_aliases` | 5 612 | snapshot + SteamID + alias + source fingerprint |
| `player_clutches` | 9 629 | match + SteamID + clutch index |
| `player_map_snapshots` | 965 | snapshot + query + SteamID + map |
| `player_match_stats` | 3 583 | snapshot + query + SteamID + match |
| `player_rounds` | 76 516 | match + SteamID + round |
| `player_side_stats` | 7 638 | match + SteamID + side |
| `player_weapon_daily_stats` | 13 035 | snapshot + query + SteamID + weapon + day |
| `player_weapon_stats` | 3 202 | snapshot + query + SteamID + weapon |
| `players` | 81 | SteamID |
| `requests` | 864 | snapshot + request + observation role |
| `round_rosters` | 76 516 | match + round + side + SteamID |
| `snapshots` | 1 | snapshot |
| `source_discrepancies` | 0 | snapshot + discrepancy index |
| `tags` | 1 | snapshot + tag |
| `trend_matches` | 2 987 | snapshot + query + player index + match index |
| `trend_players` | 20 | snapshot + query + player index |
| `weapon_daily_stats` | 13 035 | snapshot + query + weapon + SteamID + day |
| `weapon_splits` | 1 601 | snapshot + SteamID + weapon |
| `weapons` | 39 | weapon |

## Проверка качества

- FACT: Независимый валидатор завершился со статусом `complete`: 0 ошибок и 0 source discrepancies.
  [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/validation-report.json]
- FACT: Валидатор зафиксировал 614 предупреждений: 613 — структурно дедуплицированные поля сверх
  минимальной схемы контракта, ещё одно — известное различие имён полей между индексом матчей
  (`snake_case`) и карточкой матча (`camelCase`).
  [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/validation-report.json]
- FACT: Профиль не выявил malformed JSON, недопустимых SteamID/дат, будущих дат, отрицательных или
  дробных count-метрик и невозможных percentage/count значений; blocking checks — 0.
  [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/data-profile.json]
- FACT: Live-перепроверка взяла детерминированную выборку 30 из 862 кандидатов при 488 сущностях,
  покрыла все 16 семейств endpoint, первую и последнюю страницы матчей, старейшую и новейшую карточки
  матча; все 30 канонических SHA-256 совпали, mismatches — 0.
  [source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/sampling-report.json]

## Как использовать и чего снимок не доказывает

INFERENCE: SQLite подходит для воспроизводимых запросов по матчам, раундам, игрокам, trends и
оружию, поскольку её полнота сверена с manifest, целостность схемы проверена, а fingerprint и SHA-256
зафиксированы; при споре первичным evidence остаются сохранённые JSON-тела HTTP-ответов.
[source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/manifest.json]
[source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/data-profile.json]

UNKNOWN: Наличие match/round/player/trends-строк не измеряет сыгранность конкретной пятёрки и не
превращает индивидуальные агрегаты в доказательство того, «как играет команда»: в CONTRACT v1.1 нет
отдельной сущности команды или метрики cohesion. Закрыл бы пробел отдельный расчёт совместных составов
по match/round rosters плюс разбор матчей или праков этой пятёрки.
[source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/contract.json]
[source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/data-profile.json]

UNKNOWN: Демо-файлы, координаты игроков и тактические маршруты в контракт сбора не входят; для
позиционного скаутинга нужен отдельный источник.
[source: /01_raw/whoajor/2026-08-30-full-v2-snapshot/contract.json]
