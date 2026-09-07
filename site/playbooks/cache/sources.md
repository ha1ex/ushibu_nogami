# Cache deck — source ledger

Проверено: **7 сентября 2026 года**. Презентация относится только к официальной live-версии
`de_cache` для CS2. Старые lineups из CS:GO и workshop-версия FMPONE 2025 года не смешивались с
этим материалом.

## Версия и статус карты

- Valve, **Season 5, Armory, and More**, 8 июля 2026:
  <https://www.counter-strike.net/newsentry/701021228894257508>. Cache официально добавлена в
  Active Duty вместо Overpass.
- Valve, **Counter-Strike 2 Update**, 3 августа 2026:
  <https://steamcommunity.com/app/730/announcements>. Это последняя найденная отдельная правка
  Cache на дату проверки: gaps/collision/assets и удаление boost spot в Outside A.
- Valve, **The Return of Cache**, 28 апреля 2026:
  <https://steamcommunity.com/app/730/announcements/?l=english>. Первая официальная публикация
  текущей Valve-версии в Competitive, Casual, Deathmatch и Retakes.

Важно: на момент проверки навигация CSNADES относила Cache к `Reserve`, хотя Valve официально
перевела карту в Active Duty 8 июля. Для статуса карты используется только источник Valve.

## Карта, коллауты и тактическая сверка

- CSDB, **Cache Callouts & Map Guide**: <https://csdb.gg/maps/cache/>. Источник утверждает, что
  координаты callouts извлечены из игровых файлов; использован для перепроверки A Main, Squeaky,
  Forklift, Quad, Highway, Mid, Garage, Boost, White Box, Vents, B Main, Checkers, Heaven и Sun Room.
- CSNADES, **Cache callouts / radar**: <https://csnades.gg/cache/callouts>. Визуальная сверка
  геометрии и соседства зон.
- BO3.gg, **How to Play CT on Cache**, 3 августа 2026:
  <https://bo3.gg/articles/how-to-play-ct-on-cache-site-setups-mid-control-and-rotations-in-cs2>.
  Текущая CT-сверка для 2–1–2, Mid information, A crossfire и B Heaven/Checkers.
- Playnews, **The Cache 2026 Guide — changes up to the August 3 patch**:
  <https://www.playnews.gg/en/guides/counter-strike-2-the-cache-2026-guide-callouts-rework-and-changes-up-to-the-august-3-patch>.
  Независимая актуальная сверка Mid control, A Highway split, B Vents split и 2–1–2 CT setup.
- BO3.gg, **Cache Utility Guide**, 30 апреля 2026:
  <https://bo3.gg/articles/cs2-cache-utility-guide-flashes-molotovs-grenades>. Дополнительная
  сверка utility-first executes и CT delay.
- NartOutHere, **CS2 Cache Nades You NEED to Know in 2026**, 4 июля 2026:
  <https://www.youtube.com/watch?v=5gbIC3igve8>. Независимая видео-сверка текущих CS2-пакетов
  Mid, A и B; не использовалась как замена серверной проверке после патча 3 августа.

Тактические схемы в deck — командный протокол тренировки, собранный из общих принципов двух
актуальных источников выше. Это не утверждение, что конкретная профессиональная команда играет
ровно по этим таймингам.

## Utility library

CSNADES Cache существует и на дату проверки содержит **38 CS2 lineups**:
<https://csnades.gg/cache>. В deck используются прямые ссылки на десять конкретных карточек:

Для каждой карточки сохранён основной опубликованный thumbnail именно с её страницы. Соответствие
локального файла, страницы и оригинального CDN-кадра:

1. `assets/lineup-connector-from-t-spawn.webp` — <https://csnades.gg/cache/smokes/connector-from-t-spawn> — <https://assets.csnades.gg/nades/cache-smoke-IAUCaCQh6J/thumbnail.webp>
2. `assets/lineup-left-mid-from-garage.webp` — <https://csnades.gg/cache/smokes/left-mid-from-garage> — <https://assets.csnades.gg/nades/cache-smoke-Q2aaUdfSnO/thumbnail.webp>
3. `assets/lineup-right-mid-from-garage.webp` — <https://csnades.gg/cache/smokes/right-mid-from-garage> — <https://assets.csnades.gg/nades/cache-smoke-0CRKYU9cDw/thumbnail.webp>
4. `assets/lineup-sandbags-from-garage.webp` — <https://csnades.gg/cache/molotovs/sandbags-from-garage> — <https://assets.csnades.gg/nades/cache-molotov-iBbtpo1PH0/thumbnail.webp>
5. `assets/lineup-forklift-from-a-main.webp` — <https://csnades.gg/cache/molotovs/forklift-from-a-main> — <https://assets.csnades.gg/nades/cache-molotov-g13t86vkmg/thumbnail.webp>
6. `assets/lineup-forklift-from-outside-squeaky.webp` — <https://csnades.gg/cache/smokes/forklift-from-outside-squeaky> — <https://assets.csnades.gg/nades/cache-smoke-Bm0pxctIts/thumbnail.webp>
7. `assets/lineup-back-a-site-from-outside-squeaky.webp` — <https://csnades.gg/cache/smokes/back-a-site-from-outside-squeaky> — <https://assets.csnades.gg/nades/cache-smoke-mMK97AyqvZ/thumbnail.webp>
8. `assets/lineup-ct-from-sun-room.webp` — <https://csnades.gg/cache/smokes/ct-from-sun-room> — <https://assets.csnades.gg/nades/cache-smoke-ORDvnr5ctw/thumbnail.webp>
9. `assets/lineup-heaven-from-garbage.webp` — <https://csnades.gg/cache/smokes/heaven-from-garbage> — <https://assets.csnades.gg/nades/cache-smoke-brLnKq1v6O/thumbnail.webp>
10. `assets/lineup-headshot-from-sun-room.webp` — <https://csnades.gg/cache/molotovs/headshot-from-sun-room> — <https://assets.csnades.gg/nades/cache-molotov-T3MXIDeQHH/thumbnail.webp>

Ссылки и доступные метаданные карточек проверены, но в этой среде нет клиента CS2. Поэтому
физическая посадка после патча Valve 3 августа остаётся обязательным командным gate: stationary /
precise — **5/5** у владельца и backup; running / loose — **3/3** в игровом темпе. Поэтому N-01,
который CSNADES отмечает как running, унифицирован до **3/3**. До прохождения gate граната не
считается принятой в playbook.

## Локальный визуальный ассет и права

`assets/cache-radar.webp` и десять `assets/lineup-*.webp` — локальные копии радара и основных
кадров конкретных линеек, полученные с CDN CSNADES:
<https://assets.csnades.gg/cache_game_radar_78bfffc917.webp>. Она используется с явной атрибуцией
только как учебная карта для внутренних тактических комментариев; права остаются у владельца
источника. Для внешнего публичного распространения deck нужно отдельно подтвердить лицензию либо
заменить радар на разрешённый командный экспорт из текущей игры.
