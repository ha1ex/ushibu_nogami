# Аудит визуальных подписей · Anubis

Дата UI-проверки: 07.09.2026. Это реестр результатов ручного просмотра фактически отрендеренной презентации и сохранённых скриншотов, а не предположение по макету.

**Граница этого QA.** Статус **«принято UI»** означает, что подпись, маршрут, ссылка или кадр читались в браузере на 1600×900, 1366×768 и 1280×720 и были вручную сверены со скриншотами. Это **не** live-проверка геометрии карты, коллизий, стартовых позиций, прицелов или траекторий гранат в CS2. Пути в последней колонке указаны относительно `site/`.

## Правило подписи

Каждая подпись на тактическом радаре или кадре должна отвечать одновременно четырём условиям:

1. Линия-выноска заканчивается на самом объекте, а не в приблизительном секторе.
2. Табличка с текстом не закрывает маршрут, угол, вход, прицел или другую значимую подпись.
3. Координаты якоря хранятся нормализованно относительно **того же** исходного изображения (`u`, `v` от 0 до 1); при изменении размера сохраняется пропорция, без обрезания `cover`.
4. Рядом с визуалом или в титрах есть источник конкретного радара/кадра. Для всех радарных строк этой версии единственный источник координат — CSNADES-радар; не переносить на него точки из Valve-depot набора без отдельной калибровки.

Статус «принято UI» ставится только после проверки на 1600×900, 1366×768 и 1280×720 и просмотра сохранённого скриншота. При любом пересечении текста, исчезнувшей стрелке или ложной привязке статус остаётся «нужна правка»; при этом даже принятый UI не подтверждает игровую геометрию.

## Радар: единый словарь

Источник для якорей: `assets/anubis-radar-csnades-2026.webp`; происхождение и границы достоверности — A-03 в `SOURCE_LEDGER.md`. Это единая координатная база презентации, но не подтверждение live-проверки текущего билда. Позиция таблички может быть вынесена в свободную область, но её лидер всегда должен заканчиваться на указанной точке.

| Визуал / подпись | Точный якорь, к которому приходит линия | Исходное изображение | 1600×900 | 1366×768 | 1280×720 | Скриншот / итог |
| --- | --- | --- | --- | --- | --- | --- |
| Радар «единый словарь» · `T Spawn` | Маркер стороны T на нижней части радара | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-03-1600x900.png`; `.context/anubis-qa/slide-03-1366x768.png`; `.context/anubis-qa/slide-03-1280x720.png` · принято UI |
| Радар «единый словарь» · `CT Spawn` | Маркер стороны CT в верхней части радара | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-03-1600x900.png`; `.context/anubis-qa/slide-03-1366x768.png`; `.context/anubis-qa/slide-03-1280x720.png` · принято UI |
| Радар «единый словарь» · `A Main` | Входящий коридор перед A, не сама площадка A | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-03-1600x900.png`; `.context/anubis-qa/slide-03-1366x768.png`; `.context/anubis-qa/slide-03-1280x720.png` · принято UI |
| Радар «единый словарь» · `A Connector` | Соединение между A и центральной частью карты | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-03-1600x900.png`; `.context/anubis-qa/slide-03-1366x768.png`; `.context/anubis-qa/slide-03-1280x720.png` · принято UI |
| Радар «единый словарь» · `A Heaven` | Верхняя CT-позиция над A | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-03-1600x900.png`; `.context/anubis-qa/slide-03-1366x768.png`; `.context/anubis-qa/slide-03-1280x720.png` · принято UI |
| Радар «единый словарь» · `Water` | Участок Water, а не соседний Bridge | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-03-1600x900.png`; `.context/anubis-qa/slide-03-1366x768.png`; `.context/anubis-qa/slide-03-1280x720.png` · принято UI |
| Радар «единый словарь» · `Bridge` | Переход Bridge рядом с Water/Mid | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-03-1600x900.png`; `.context/anubis-qa/slide-03-1366x768.png`; `.context/anubis-qa/slide-03-1280x720.png` · принято UI |
| Радар «единый словарь» · `Mid Doors` | Двери Mid после изменений 2026 | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-03-1600x900.png`; `.context/anubis-qa/slide-03-1366x768.png`; `.context/anubis-qa/slide-03-1280x720.png` · принято UI |
| Радар «единый словарь» · `Drop` | Новый выход Drop рядом с Mid Doors | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-03-1600x900.png`; `.context/anubis-qa/slide-03-1366x768.png`; `.context/anubis-qa/slide-03-1280x720.png` · принято UI |
| Радар «единый словарь» · `B Main` | T-вход на B, не Canal | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-03-1600x900.png`; `.context/anubis-qa/slide-03-1366x768.png`; `.context/anubis-qa/slide-03-1280x720.png` · принято UI |
| Радар «единый словарь» · `B Connector` | Отдельная B-связка; не подменять E-box | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-03-1600x900.png`; `.context/anubis-qa/slide-03-1366x768.png`; `.context/anubis-qa/slide-03-1280x720.png` · принято UI |
| Радар «единый словарь» · `E-box` | Отдельная точка E-box, не B Connector | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-03-1600x900.png`; `.context/anubis-qa/slide-03-1366x768.png`; `.context/anubis-qa/slide-03-1280x720.png` · принято UI |
| Радар «единый словарь» · `Back B` | Задняя часть B за сайтом | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-03-1600x900.png`; `.context/anubis-qa/slide-03-1366x768.png`; `.context/anubis-qa/slide-03-1280x720.png` · принято UI |
| Радар «единый словарь» · `Pillar` | Колонна на B-site | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-03-1600x900.png`; `.context/anubis-qa/slide-03-1366x768.png`; `.context/anubis-qa/slide-03-1280x720.png` · принято UI |

## Тактические маршруты и зоны

Источник для якорей: тот же `anubis-radar-csnades-2026.webp`, что и в разделе словаря. Номера действий должны иметь один порядок чтения: `1 → 2 → 3 …`; стрелка имеет наконечник и не прячется под плашкой.

| Визуал / подпись | Точный якорь, к которому приходит линия или стрелка | Исходное изображение | 1600×900 | 1366×768 | 1280×720 | Скриншот / итог |
| --- | --- | --- | --- | --- | --- | --- |
| CT default · `A: 2` | Две CT-зоны защиты A, а не весь левый сектор карты | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-06-1600x900.png`; `.context/anubis-qa/slide-06-1366x768.png`; `.context/anubis-qa/slide-06-1280x720.png` · принято UI |
| CT default · `Mid: 1` | Контроль Mid/Water с явно показанной точкой информации | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-06-1600x900.png`; `.context/anubis-qa/slide-06-1366x768.png`; `.context/anubis-qa/slide-06-1280x720.png` · принято UI |
| CT default · `B: 2` | Две CT-зоны B, включая B Main/Canal реакцию | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-06-1600x900.png`; `.context/anubis-qa/slide-06-1366x768.png`; `.context/anubis-qa/slide-06-1280x720.png` · принято UI |
| T default · `1–5` | Пять стартовых позиций/направлений T с читаемой последовательностью | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-08-1600x900.png`; `.context/anubis-qa/slide-08-1366x768.png`; `.context/anubis-qa/slide-08-1280x720.png` · принято UI |
| Mid / Water · `Инфо` | Water или Mid Doors — конкретная точка первого контакта | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-10-1600x900.png`; `.context/anubis-qa/slide-10-1366x768.png`; `.context/anubis-qa/slide-10-1280x720.png` · принято UI |
| Mid / Water · `Решение 1` | Развилка в районе Mid/Bridge, не текстовый блок вне карты | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-10-1600x900.png`; `.context/anubis-qa/slide-10-1366x768.png`; `.context/anubis-qa/slide-10-1280x720.png` · принято UI |
| Mid / Water · `Решение 2` | Подтверждённый переход в A или B ветку | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-10-1600x900.png`; `.context/anubis-qa/slide-10-1366x768.png`; `.context/anubis-qa/slide-10-1280x720.png` · принято UI |
| A execute · `1–5` | A Main, Water/A Connector, вход и post-plant — каждая стрелка на своём объекте | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-13-1600x900.png`; `.context/anubis-qa/slide-13-1366x768.png`; `.context/anubis-qa/slide-13-1280x720.png` · принято UI |
| B execute · `1–5` | B Main, Canal, B Connector, E-box, Back B и Pillar — без подмены одной точки другой | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-16-1600x900.png`; `.context/anubis-qa/slide-16-1366x768.png`; `.context/anubis-qa/slide-16-1280x720.png` · принято UI |
| CT reaction · `STOP` | Точка остановки лишней ротации, привязанная к зоне информации | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-18-1600x900.png`; `.context/anubis-qa/slide-18-1366x768.png`; `.context/anubis-qa/slide-18-1280x720.png` · принято UI |
| CT reaction · `SUCCESS` | Контроль/ретейк-цель после подтверждения, не абстрактный сектор | `anubis-radar-csnades-2026.webp` | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-18-1600x900.png`; `.context/anubis-qa/slide-18-1366x768.png`; `.context/anubis-qa/slide-18-1280x720.png` · принято UI |

## Кадры карты и карточки гранат

Для кадра карты в колонке «якорь» проверяется именно видимый объект. Изображение отображается целиком (`contain`), поэтому координаты считаются относительно полного 16:9-кадра, а не обрезанной области. Для каждой гранаты в локальных `assets/nades/` уже есть кадр старта (`*-lineup.webp`) и крупный исходный кадр прицела/результата (`*-thumbnail.webp`); они остаются визуальными ориентирами и «кандидатами», пока нет live-прогона. Полный перечень файлов — в `NADES_SOURCE_ASSETS.md`.

| Визуал / подпись | Точный якорь, к которому приходит линия или ссылка | Исходное изображение / источник | 1600×900 | 1366×768 | 1280×720 | Скриншот / итог |
| --- | --- | --- | --- | --- | --- | --- |
| Кадр Water · `Water` | Видимая водная/нижняя дорожка на кадре, не декоративная арка | `anubis-thumb-1.png` (A-04) | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-11-1600x900.png`; `.context/anubis-qa/slide-11-1366x768.png`; `.context/anubis-qa/slide-11-1280x720.png` · принято UI |
| Кадр Water · `Bridge` | Видимая конструкция перехода Bridge на том же кадре | `anubis-thumb-1.png` (A-04) | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-11-1600x900.png`; `.context/anubis-qa/slide-11-1366x768.png`; `.context/anubis-qa/slide-11-1280x720.png` · принято UI |
| Кадр Water · `Arches` | Видимые арки на том же кадре, отдельно от Bridge | `anubis-thumb-1.png` (A-04) | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-11-1600x900.png`; `.context/anubis-qa/slide-11-1366x768.png`; `.context/anubis-qa/slide-11-1280x720.png` · принято UI |
| Кадр A · `A Site` | Красная маркировка/видимая площадка A | `anubis-thumb-2.png` (A-04) | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-12-1600x900.png`; `.context/anubis-qa/slide-12-1366x768.png`; `.context/anubis-qa/slide-12-1280x720.png` · принято UI |
| Кадр A · `Fountain` | Видимый объект Fountain; отдельная подпись без добавления общего `cover` | `anubis-thumb-2.png` (A-04) | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-12-1600x900.png`; `.context/anubis-qa/slide-12-1366x768.png`; `.context/anubis-qa/slide-12-1280x720.png` · принято UI |
| Кадр Door / Corridor · `Door` | Видимая дверь на левом краю кадра | `anubis-thumb-4.png` (A-04) | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-04-1600x900.png`; `.context/anubis-qa/slide-04-1366x768.png`; `.context/anubis-qa/slide-04-1280x720.png` · принято UI |
| Кадр Door / Corridor · `Corridor` | Видимый коридор на правой части кадра, отдельно от Door | `anubis-thumb-4.png` (A-04) | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-04-1600x900.png`; `.context/anubis-qa/slide-04-1366x768.png`; `.context/anubis-qa/slide-04-1280x720.png` · принято UI |
| Кадр B · `B Site` | Красная маркировка/видимая площадка B | `anubis-thumb-3.png` (A-04) | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-15-1600x900.png`; `.context/anubis-qa/slide-15-1366x768.png`; `.context/anubis-qa/slide-15-1280x720.png`; `.context/anubis-qa/slide-17-1600x900.png`; `.context/anubis-qa/slide-17-1366x768.png`; `.context/anubis-qa/slide-17-1280x720.png` · принято UI |
| Кадр B · `Pillar` | Видимая колонна B; не ставить по памяти, если объект не различим | `anubis-thumb-3.png` (A-04) | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-15-1600x900.png`; `.context/anubis-qa/slide-15-1366x768.png`; `.context/anubis-qa/slide-15-1280x720.png`; `.context/anubis-qa/slide-17-1600x900.png`; `.context/anubis-qa/slide-17-1366x768.png`; `.context/anubis-qa/slide-17-1280x720.png` · принято UI |
| Карточка N-01 | Ссылка «открыть lineup» ведёт на `heaven-from-water-b`; статус «кандидат» виден | N-01 | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-20-1600x900.png`; `.context/anubis-qa/slide-20-1366x768.png`; `.context/anubis-qa/slide-20-1280x720.png` · принято UI |
| Карточка N-02 | Ссылка ведёт на `platform-from-water`; статус «кандидат» виден | N-02 | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-20-1600x900.png`; `.context/anubis-qa/slide-20-1366x768.png`; `.context/anubis-qa/slide-20-1280x720.png` · принято UI |
| Карточка N-03 | Ссылка ведёт на `top-mid-from-t-spawn-b`; статус «кандидат» виден | N-03 | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-20-1600x900.png`; `.context/anubis-qa/slide-20-1366x768.png`; `.context/anubis-qa/slide-20-1280x720.png` · принято UI |
| Карточка N-04 | Ссылка ведёт на `ebox-from-ruins-b`; рядом есть предупреждение о V-01/V-02 | N-04 | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-20-1600x900.png`; `.context/anubis-qa/slide-20-1366x768.png`; `.context/anubis-qa/slide-20-1280x720.png` · принято UI |
| Карточка N-05 | Ссылка ведёт на `back-site-from-ruins-b`; статус «кандидат» виден | N-05 | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-21-1600x900.png`; `.context/anubis-qa/slide-21-1366x768.png`; `.context/anubis-qa/slide-21-1280x720.png` · принято UI |
| Карточка N-06 | Ссылка ведёт на `b-pillar-from-ruins-b`; статус «кандидат» виден | N-06 | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-21-1600x900.png`; `.context/anubis-qa/slide-21-1366x768.png`; `.context/anubis-qa/slide-21-1280x720.png` · принято UI |
| Карточка N-07 | Ссылка ведёт на `backsite-from-ebox-b`; дата/статус не заменяют live-проверку | N-07 | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-21-1600x900.png`; `.context/anubis-qa/slide-21-1366x768.png`; `.context/anubis-qa/slide-21-1280x720.png` · принято UI |
| Карточка N-08 | Ссылка ведёт на `water-from-heaven`; статус «кандидат» виден | N-08 | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-21-1600x900.png`; `.context/anubis-qa/slide-21-1366x768.png`; `.context/anubis-qa/slide-21-1280x720.png` · принято UI |
| Карточка N-09 | Ссылка ведёт на `b-main-from-ct-spawn`; статус «кандидат» виден | N-09 | принято UI | принято UI | принято UI | `.context/anubis-qa/slide-21-1600x900.png`; `.context/anubis-qa/slide-21-1600x900-bottom.png`; `.context/anubis-qa/slide-21-1366x768.png`; `.context/anubis-qa/slide-21-1366x768-bottom.png`; `.context/anubis-qa/slide-21-1280x720.png`; `.context/anubis-qa/slide-21-1280x720-bottom.png` · принято UI; это UI-аудит, не live-проверка траектории |
| Карточка N-10 | Ссылка ведёт на `bridge-from-ct-spawn`; статус «кандидат» виден | N-10 | принято UI | принято UI | принято UI | Локальные кадры `n10-lineup.webp` и `n10-thumbnail.webp`; это UI-аудит, не live-проверка траектории |

## Протокол финальной ручной проверки

1. Открыть каждый визуальный слайд в полноэкранном и обычном режиме на 1600×900, 1366×768 и 1280×720.
2. Для каждой строки включить направляющую: визуально проследить линию от таблички до указанного якоря, затем сравнить с источником из колонки «Исходное изображение».
3. Проверить, что на всех трёх размерах плашка не перекрывает путь, номер действия, наконечник стрелки или важную область карты; при необходимости двигать только плашку, не точку якоря.
4. Сохранить скриншот с именем `slide-<номер>-<разрешение>.png`, вписать путь в последнюю колонку и поставить «принято UI» либо «нужна правка». «Принято UI» не заменяет запуск карты и бросок гранаты в CS2.
5. Отдельно открыть каждую ссылку N-01…N-10: проверить HTTP-ответ, название страницы и видимый статус «кандидат» в самой презентации. Это проверяет ссылку, но не заменяет бросок в текущей игре.

## Запрещённые упрощения

- Не писать «Connector» без A/B/E-box контекста, если на слайде есть две возможные зоны.
- Не двигать якорь ради красивой композиции: двигается только текстовая плашка и линия.
- Не ставить подпись `Pillar`, `Heaven`, `Drop` или `Bridge` на невидимый/неотличимый объект на фото.
- Не маркировать карточку гранаты как проверенную, пока нет дата- и билд-фиксированного прогона.
