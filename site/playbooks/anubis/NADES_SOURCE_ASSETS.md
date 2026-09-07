# Кадры гранат Anubis — первоисточник и локальные файлы

Дата сохранения: 7 сентября 2026. Все 18 файлов в `assets/nades/` — локальные копии изображений из соответствующих карточек CSNADES. Они нужны колоде как наглядный ориентир и не загружаются с внешнего сайта во время показа.

## Как читать пару кадров

- `*-lineup.webp` — исходный широкий кадр позиции (`2560×1440`): ориентир, где стоять перед броском.
- `*-thumbnail.webp` — постер исходного ролика (`1280×720`): в карточках CSNADES он показывает результат и/или выделенную точку прицела. Его используют как крупный ориентир прицела, а не как доказательство игровой геометрии.

У каждой строки ниже два точных URL исходных файлов: добавьте к указанному `Asset ID` суффикс `/thumbnail.webp` или `/lineup.webp` после `https://assets.csnades.gg/nades/`.

| № | Учебная граната | Исходная карточка | Asset ID | Локальная пара |
| --- | --- | --- | --- | --- |
| N1 | Smoke: Heaven ← Water | [CSNADES](https://csnades.gg/anubis/smokes/heaven-from-water-b) | `anubis-smoke-JbhR4dxPHd` | `assets/nades/n01-lineup.webp` (позиция); `assets/nades/n01-thumbnail.webp` (прицел/результат) |
| N2 | Smoke: Platform ← Water | [CSNADES](https://csnades.gg/anubis/smokes/platform-from-water) | `anubis-smoke-9m7ZJDVzDW` | `assets/nades/n02-lineup.webp` (позиция); `assets/nades/n02-thumbnail.webp` (прицел/результат) |
| N3 | Smoke: Top Mid ← T Spawn B | [CSNADES](https://csnades.gg/anubis/smokes/top-mid-from-t-spawn-b) | `anubis-smoke-T1HaCXURLB` | `assets/nades/n03-lineup.webp` (позиция); `assets/nades/n03-thumbnail.webp` (прицел/результат) |
| N4 | Smoke: E-box ← Ruins B | [CSNADES](https://csnades.gg/anubis/smokes/ebox-from-ruins-b) | `anubis-smoke-OQStoSa2V5` | `assets/nades/n04-lineup.webp` (позиция); `assets/nades/n04-thumbnail.webp` (прицел/результат) |
| N5 | Smoke: Back Site ← Ruins B | [CSNADES](https://csnades.gg/anubis/smokes/back-site-from-ruins-b) | `anubis-smoke-fNvvDhRVVZ` | `assets/nades/n05-lineup.webp` (позиция); `assets/nades/n05-thumbnail.webp` (прицел/результат) |
| N6 | Molotov: B Pillar ← Ruins B | [CSNADES](https://csnades.gg/anubis/molotovs/b-pillar-from-ruins-b) | `anubis-molotov-Q7MyO6eFxS` | `assets/nades/n06-lineup.webp` (позиция); `assets/nades/n06-thumbnail.webp` (прицел/результат) |
| N7 | Molotov: Backsite ← E-box B | [CSNADES](https://csnades.gg/anubis/molotovs/backsite-from-ebox-b) | `anubis-molotov-cGhLlwmD3e` | `assets/nades/n07-lineup.webp` (позиция); `assets/nades/n07-thumbnail.webp` (прицел/результат) |
| N8 | Flash: Water ← Heaven | [CSNADES](https://csnades.gg/anubis/flashbangs/water-from-heaven) | `anubis-flashbang-YH8UBgnccd` | `assets/nades/n08-lineup.webp` (позиция); `assets/nades/n08-thumbnail.webp` (прицел/результат) |
| N9 | Smoke: B Main ← CT Spawn | [CSNADES](https://csnades.gg/anubis/smokes/b-main-from-ct-spawn) | `anubis-smoke-bfJHfp6fMc` | [lineup](https://assets.csnades.gg/nades/anubis-smoke-bfJHfp6fMc/lineup.webp) → `assets/nades/n09-lineup.webp`; [thumbnail](https://assets.csnades.gg/nades/anubis-smoke-bfJHfp6fMc/thumbnail.webp) → `assets/nades/n09-thumbnail.webp` |

Например, N1 взят ровно из `https://assets.csnades.gg/nades/anubis-smoke-JbhR4dxPHd/thumbnail.webp` и `https://assets.csnades.gg/nades/anubis-smoke-JbhR4dxPHd/lineup.webp`; остальные строки используют тот же путь с собственным `Asset ID`.

### Точные URL asset-пар

| № | Позиция (`lineup.webp`) | Прицел/результат (`thumbnail.webp`) |
| --- | --- | --- |
| N1 | [lineup](https://assets.csnades.gg/nades/anubis-smoke-JbhR4dxPHd/lineup.webp) | [thumbnail](https://assets.csnades.gg/nades/anubis-smoke-JbhR4dxPHd/thumbnail.webp) |
| N2 | [lineup](https://assets.csnades.gg/nades/anubis-smoke-9m7ZJDVzDW/lineup.webp) | [thumbnail](https://assets.csnades.gg/nades/anubis-smoke-9m7ZJDVzDW/thumbnail.webp) |
| N3 | [lineup](https://assets.csnades.gg/nades/anubis-smoke-T1HaCXURLB/lineup.webp) | [thumbnail](https://assets.csnades.gg/nades/anubis-smoke-T1HaCXURLB/thumbnail.webp) |
| N4 | [lineup](https://assets.csnades.gg/nades/anubis-smoke-OQStoSa2V5/lineup.webp) | [thumbnail](https://assets.csnades.gg/nades/anubis-smoke-OQStoSa2V5/thumbnail.webp) |
| N5 | [lineup](https://assets.csnades.gg/nades/anubis-smoke-fNvvDhRVVZ/lineup.webp) | [thumbnail](https://assets.csnades.gg/nades/anubis-smoke-fNvvDhRVVZ/thumbnail.webp) |
| N6 | [lineup](https://assets.csnades.gg/nades/anubis-molotov-Q7MyO6eFxS/lineup.webp) | [thumbnail](https://assets.csnades.gg/nades/anubis-molotov-Q7MyO6eFxS/thumbnail.webp) |
| N7 | [lineup](https://assets.csnades.gg/nades/anubis-molotov-cGhLlwmD3e/lineup.webp) | [thumbnail](https://assets.csnades.gg/nades/anubis-molotov-cGhLlwmD3e/thumbnail.webp) |
| N8 | [lineup](https://assets.csnades.gg/nades/anubis-flashbang-YH8UBgnccd/lineup.webp) | [thumbnail](https://assets.csnades.gg/nades/anubis-flashbang-YH8UBgnccd/thumbnail.webp) |
| N9 | [lineup](https://assets.csnades.gg/nades/anubis-smoke-bfJHfp6fMc/lineup.webp) | [thumbnail](https://assets.csnades.gg/nades/anubis-smoke-bfJHfp6fMc/thumbnail.webp) |
| N10 | [lineup](https://assets.csnades.gg/nades/anubis-smoke-y4RgwsxY6Q/lineup.webp) | [thumbnail](https://assets.csnades.gg/nades/anubis-smoke-y4RgwsxY6Q/thumbnail.webp) |

## Важное ограничение

Это документирование источника, а не локальная проверка в CS2. Нельзя считать кадры подтверждением актуальности траектории, коллизий, точки приземления или техники броска после обновлений игры. Перед командным применением каждую из N1–N10 нужно проверить на актуальной версии CS2 на локальном сервере/тренировке.
