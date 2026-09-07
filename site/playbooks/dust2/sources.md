# Dust 2 — журнал источников

Проверено: **7 сентября 2026 года**. Все ссылки ниже открывались как отдельные страницы CSNADES для Counter-Strike 2. Презентация не утверждает конкретный состав соревновательного маппула или патч карты. Тактические схемы описывают внутренний командный протокол L!S, а не универсальную «мету».

## Радар и справочная проверка

- [CSNADES: Dust 2](https://csnades.gg/dust2) — актуальная страница карты, категории гранат и радар. На момент проверки страница показывала 113 смоков, 19 молотовых, 29 флешек и 6 HE-гранат.
- [CSNADES: Ultimate Dust 2 Nade Guide](https://csnades.gg/guides/dust2) — проверка назначения базовых гранат для XBox, выходов A/B, мида и CT-защиты. Страница указывала обновление 26 февраля 2025 года.
- Локальный радар: `assets/dust2-radar-csnades.webp`, сохранён без перерисовки из `https://assets.csnades.gg/dust2_game_radar_1b998342f2.webp`.

Координаты коллаутов и ролевых пинов в `index.html` нормализованы в системе `0…1000` относительно этого локального радара. Они вручную сопоставлены с геометрией радара. Подписи вынесены за якоря, а каждая точка имеет отдельную линию-выноску.

## Десять тренировочных гранат

| № | Страница CSNADES | Метаданные, проверенные на странице | Локальные кадры |
|---|---|---|---|
| 01 | [XBox from T Spawn](https://csnades.gg/dust2/smokes/xbox-from-t-spawn) | T; прыжок + ЛКМ; с места; precise; обновлено 27.06.2024 | `n01-position.webp`, `n01-aim.webp` |
| 02 | [A Long from Outside Long](https://csnades.gg/dust2/flashbangs/a-long-from-outside-long) | T; прыжок + ЛКМ; с места; precise; обновлено 10.11.2023 | `n02-position.webp`, `n02-aim.webp` |
| 03 | [A Cross from Long Doors](https://csnades.gg/dust2/smokes/a-cross-from-long-doors-b) | T; прыжок + ЛКМ; с разбега; precise; критерий `3/3` из-за движущегося старта; обновлено 28.05.2024 | `n03-position.webp`, `n03-aim.webp` |
| 04 | [Car from Long Doors](https://csnades.gg/dust2/molotovs/car-from-long-doors) | T; прыжок + ЛКМ; с места; very precise; обновлено 18.01.2024 | `n04-position.webp`, `n04-aim.webp` |
| 05 | [B Window from Outside B Tunnels](https://csnades.gg/dust2/smokes/b-window-from-outside-b-tunnels) | T; прыжок + ЛКМ; с места; precise; обновлено 19.04.2026 | `n05-position.webp`, `n05-aim.webp` |
| 06 | [B Doors from Outside B Tunnels](https://csnades.gg/dust2/smokes/b-doors-from-outside-b-tunnels) | T; прыжок + ЛКМ; с места; precise; обновлено 02.11.2024 | `n06-position.webp`, `n06-aim.webp` |
| 07 | [B Site from Upper Tunnels](https://csnades.gg/dust2/flashbangs/b-site-from-upper-tunnels-b) | T; ЛКМ; с разбега; loose; обновлено 07.05.2024 | `n07-position.webp`, `n07-aim.webp` |
| 08 | [CT Spawn from XBox](https://csnades.gg/dust2/smokes/ct-spawn-from-xbox) | T; ЛКМ; с места; precise; обновлено 03.04.2024 | `n08-position.webp`, `n08-aim.webp` |
| 09 | [Bottom Mid from CT Mid](https://csnades.gg/dust2/smokes/bottom-mid-from-ct-mid) | CT; ЛКМ; с места; precise; обновлено 11.09.2024 | `n09-position.webp`, `n09-aim.webp` |
| 10 | [B Tunnels from CT Mid](https://csnades.gg/dust2/smokes/b-tunnels-from-ct-mid) | CT; прыжок + ЛКМ; шагом; precise; обновлено 06.06.2024 | `n10-position.webp`, `n10-aim.webp` |

### Как получены локальные кадры

Для каждой страницы использованы только принадлежащие этой записи CSNADES-медиа:

- `*-aim.webp` — оригинальный `lineup.webp` из `https://assets.csnades.gg/nades/<asset-id>/lineup.webp`; в презентации он подписан «Точка прицела»;
- `*-position.webp` — системное превью оригинального `lq.mp4` из `https://assets.csnades.gg/nades/<asset-id>/lq.mp4`; в презентации оно нейтрально подписано «Кадр видео».

CSNADES не отдаёт отдельную статичную фотографию только ног/угла позиции, а системный кадр видео различается между записями: часть показывает врезку позиции, часть — игровой кадр без неё. Поэтому презентация нигде не называет этот файл доказательством стартовой позиции. Синтетические или подменённые картинки не использовались. Физическое приземление гранат в текущей игровой сборке невозможно подтвердить без запущенного CS2. По этой причине презентация требует live-сдачу: точные броски — `5/5`, беговые/loose — `3/3`, отдельно владельцем и резервом.
