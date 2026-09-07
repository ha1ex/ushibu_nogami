/*
 * Единая система координат визуалов Anubis.
 * u/v — нормализованные координаты 0…1 относительно полного исходного файла.
 * Табличка может переезжать (tx/ty), но anchor u/v нельзя двигать ради композиции.
 * Для радаров используются только координаты относительно CSNADES-радара ниже.
 */
(function () {
  'use strict';

  var RADAR = {
    image: 'assets/anubis-radar-csnades-2026.webp',
    alt: 'радар Anubis с едиными коллаутами',
    source: 'CSNADES radar asset · снимок 07.09.2026',
    coordinateSystem: 'Нормализованные u/v относительно одного изображения радара CSNADES'
  };

  function point(id, label, u, v, tx, ty, tone) {
    return { id: id, label: label, u: u, v: v, tx: tx, ty: ty, tone: tone || 'neutral' };
  }

  function route(id, label, points, tone) {
    return { id: id, label: label, points: points, tone: tone || 't' };
  }

  window.ANUBIS_SCENES = {
    radar: RADAR,
    callouts: {
      kind: 'radar',
      title: 'Единый словарь',
      caption: 'Русские названия привязаны к одному радару; «коннектор» всегда уточняем префиксом A или B.',
      labels: [
        point('t-spawn', 'Респаун T', 0.52, 0.88, 0.63, 0.93, 't'),
        point('ct-spawn', 'Респаун CT', 0.59, 0.42, 0.72, 0.45, 'ct'),
        point('a-main', 'Мейн A', 0.82, 0.58, 0.88, 0.66, 't'),
        point('a-connector', 'Коннектор A', 0.68, 0.43, 0.84, 0.36, 'neutral'),
        point('a-heaven', 'Хевен A', 0.72, 0.24, 0.82, 0.17, 'ct'),
        point('water', 'Вода', 0.71, 0.58, 0.80, 0.75, 'ct'),
        point('bridge', 'Мост', 0.62, 0.51, 0.69, 0.55, 'neutral'),
        point('mid-doors', 'Двери мида', 0.56, 0.59, 0.46, 0.55, 'neutral'),
        point('drop', 'Спуск · 2026', 0.60, 0.48, 0.49, 0.48, 'signal'),
        point('b-main', 'Мейн B', 0.37, 0.62, 0.22, 0.69, 't'),
        point('b-connector', 'Коннектор B', 0.52, 0.38, 0.29, 0.46, 'neutral'),
        point('ebox', 'Е-бокс', 0.49, 0.33, 0.32, 0.35, 'neutral'),
        point('back-b', 'Дальний B', 0.46, 0.24, 0.25, 0.21, 'ct'),
        point('pillar', 'Колонна', 0.38, 0.31, 0.18, 0.30, 'neutral')
      ]
    },
    ctDefault: {
      kind: 'radar',
      title: 'Дефолт CT · 2 / 1 / 2',
      caption: 'Тренерское решение: два A, один Mid/Water, два B. Ротация — только от подтверждённого инфо.',
      labels: [
        point('ct-a', 'A · 2', 0.75, 0.28, 0.84, 0.24, 'ct'),
        point('ct-mid', 'Мид · 1', 0.59, 0.54, 0.68, 0.63, 'ct'),
        point('ct-b', 'B · 2', 0.40, 0.31, 0.19, 0.25, 'ct')
      ],
      pins: [
        { n: '1', u: 0.72, v: 0.23, label: 'Хевен' },
        { n: '2', u: 0.77, v: 0.31, label: 'Опорник A' },
        { n: '3', u: 0.59, v: 0.54, label: 'Инфо мид' },
        { n: '4', u: 0.39, v: 0.30, label: 'Опорник B' },
        { n: '5', u: 0.46, v: 0.37, label: 'Е-бокс' }
      ]
    },
    tDefault: {
      kind: 'radar',
      title: 'Дефолт T · 2 / 2 / 1',
      caption: 'Тренерское решение: две пары собирают инфо, пятый держит B Main. До команды — не форсить контакт.',
      labels: [
        point('t-a', 'Мейн A · 2', 0.80, 0.58, 0.86, 0.69, 't'),
        point('t-mid', 'Мид · 1', 0.59, 0.58, 0.62, 0.75, 't'),
        point('t-water', 'Вода · 1', 0.70, 0.58, 0.80, 0.77, 't'),
        point('t-b', 'Мейн B · 1', 0.36, 0.61, 0.18, 0.70, 't')
      ],
      routes: [
        route('t-a-route', '1–2 · информация A', [[0.52, 0.88], [0.67, 0.77], [0.81, 0.59]], 't'),
        route('t-mid-route', '3–4 · Mid → Water', [[0.52, 0.88], [0.57, 0.71], [0.59, 0.59], [0.69, 0.57]], 't'),
        route('t-b-route', '5 · B Main', [[0.52, 0.88], [0.42, 0.76], [0.36, 0.62]], 't')
      ],
      pins: [
        { n: '1', u: 0.71, v: 0.72, label: 'Энтри A' },
        { n: '2', u: 0.80, v: 0.59, label: 'Размен A' },
        { n: '3', u: 0.57, v: 0.66, label: 'Инфо мид' },
        { n: '4', u: 0.68, v: 0.57, label: 'Вода' },
        { n: '5', u: 0.37, v: 0.63, label: 'Инфо B' }
      ]
    },
    midWater: {
      kind: 'radar',
      title: 'Мид → мост → вода',
      caption: 'Две точки решения: после первого инфо и после подтверждения CT-реакции.',
      labels: [
        point('mid-info', '1 · инфо у дверей', 0.57, 0.58, 0.42, 0.59, 't'),
        point('bridge-decision', '2 · мост: решение', 0.62, 0.51, 0.61, 0.42, 'signal'),
        point('water-a', 'Ветка A через воду', 0.70, 0.58, 0.78, 0.70, 't'),
        point('mid-b', 'Ветка B через Е-бокс', 0.50, 0.37, 0.32, 0.43, 't')
      ],
      routes: [
        route('mid-route', '1 · получить инфо', [[0.52, 0.88], [0.56, 0.70], [0.57, 0.58]], 't'),
        route('water-route', '2a · Water → A', [[0.57, 0.58], [0.62, 0.51], [0.70, 0.58], [0.75, 0.35]], 't'),
        route('ebox-route', '2b · E-box → B', [[0.57, 0.58], [0.54, 0.47], [0.50, 0.37], [0.41, 0.31]], 't')
      ],
      pins: [
        { n: '1', u: 0.57, v: 0.66, label: 'Инфо мид' },
        { n: '2', u: 0.62, v: 0.51, label: 'Мост' },
        { n: '3', u: 0.70, v: 0.58, label: 'Вода → A' },
        { n: '4', u: 0.50, v: 0.37, label: 'Е-бокс → B' }
      ]
    },
    aExecute: {
      kind: 'radar',
      title: 'Выход A · мейн + вода',
      caption: 'Тренерское решение: 3 Main + 2 Water/A Connector. Все входы — по одному GO.',
      labels: [
        point('a-go', 'ВХОД · синхронно', 0.75, 0.34, 0.85, 0.36, 'signal'),
        point('a-plant', 'Бомба · плент', 0.76, 0.30, 0.84, 0.30, 't'),
        point('a-stop', 'СТОП: нет воды / гранат', 0.69, 0.56, 0.73, 0.71, 'signal'),
        point('a-success', 'УСПЕХ: сайт + отсечён CT', 0.68, 0.42, 0.80, 0.46, 'ct')
      ],
      routes: [
        route('a-main-1', '1–3 · Main', [[0.52, 0.88], [0.70, 0.75], [0.82, 0.58], [0.76, 0.33]], 't'),
        route('a-water-2', '4–5 · Water', [[0.52, 0.88], [0.57, 0.68], [0.62, 0.51], [0.70, 0.58], [0.75, 0.35]], 't')
      ],
      pins: [
        { n: '1', u: 0.78, v: 0.50, label: 'Энтри', lu: 0.88, lv: 0.48, anchor: 'start' },
        { n: '2', u: 0.80, v: 0.55, label: 'Размен', lu: 0.89, lv: 0.57, anchor: 'start' },
        { n: '3', u: 0.76, v: 0.40, label: 'Бомба', lu: 0.85, lv: 0.39, anchor: 'start' },
        { n: '4', u: 0.71, v: 0.53, label: 'Гранаты', lu: 0.61, lv: 0.51, anchor: 'end' },
        { n: '5', u: 0.69, v: 0.58, label: 'Фланг / инфо', lu: 0.57, lv: 0.62, anchor: 'end' }
      ]
    },
    bExecute: {
      kind: 'radar',
      title: 'Выход B · канал + мейн B',
      caption: 'Тренерское решение: 2 Canal + 3 B Main. Вход начинается только после готовой utility.',
      labels: [
        point('b-go', 'ВХОД · гранаты готовы', 0.41, 0.33, 0.17, 0.40, 'signal'),
        point('b-pillar', 'Колонна · выжечь', 0.38, 0.31, 0.17, 0.29, 't'),
        point('b-plant', 'Бомба · плент', 0.43, 0.31, 0.27, 0.20, 't'),
        point('b-stop', 'СТОП: Е-бокс открыт', 0.49, 0.35, 0.67, 0.52, 'signal'),
        point('b-success', 'УСПЕХ: сайт + дальний B', 0.46, 0.24, 0.28, 0.14, 'ct')
      ],
      routes: [
        route('b-main-1', '1–3 · B Main', [[0.52, 0.88], [0.42, 0.74], [0.36, 0.62], [0.40, 0.34]], 't'),
        route('b-canal-2', '4–5 · Canal / E-box', [[0.52, 0.88], [0.56, 0.68], [0.54, 0.47], [0.49, 0.36], [0.42, 0.30]], 't')
      ],
      pins: [
        { n: '1', u: 0.36, v: 0.53, label: 'Энтри', lu: 0.25, lv: 0.50, anchor: 'end' },
        { n: '2', u: 0.38, v: 0.57, label: 'Размен', lu: 0.25, lv: 0.61, anchor: 'end' },
        { n: '3', u: 0.41, v: 0.39, label: 'Бомба', lu: 0.29, lv: 0.37, anchor: 'end' },
        { n: '4', u: 0.48, v: 0.42, label: 'Гранаты', lu: 0.59, lv: 0.45, anchor: 'start' },
        { n: '5', u: 0.50, v: 0.36, label: 'Фланг / инфо', lu: 0.63, lv: 0.33, anchor: 'start' }
      ]
    },
    ctReaction: {
      kind: 'radar',
      title: 'CT: потеряли Mid / Water',
      caption: 'Не отбиваем по одному. Mid первым сообщает, якорь остаётся, ретейк только втроём и с utility.',
      labels: [
        point('ct-lost', 'ПОТЕРЯН · мид', 0.61, 0.54, 0.67, 0.67, 'signal'),
        point('ct-stop', 'СТОП · A не бросать', 0.72, 0.34, 0.82, 0.42, 'signal'),
        point('ct-retake-a', 'РЕТЕЙК A · 3+', 0.74, 0.29, 0.85, 0.26, 'ct'),
        point('ct-reaction-b', 'опорник B держит', 0.40, 0.31, 0.19, 0.35, 'ct')
      ],
      routes: [
        route('ct-fall-back', '1 · уйти живым', [[0.61, 0.54], [0.60, 0.43]], 'ct'),
        route('ct-retake-a', '2 · собраться на A', [[0.60, 0.43], [0.68, 0.38], [0.74, 0.29]], 'ct')
      ],
      pins: [
        { n: '1', u: 0.60, v: 0.43, label: 'Отход' },
        { n: '2', u: 0.68, v: 0.38, label: 'Сбор A' }
      ]
    },
    nadeBoard: {
      kind: 'radar',
      title: 'Карточки гранат: только кандидаты',
      caption: 'Ссылка подтверждает опубликованный lineup; живой бросок в текущем билде ещё не записан.',
      labels: [
        point('nade-water', 'Вода', 0.72, 0.51, 0.79, 0.64, 't'),
        point('nade-mid', 'Верх мида', 0.55, 0.68, 0.42, 0.71, 't'),
        point('nade-ebox', 'Е-бокс', 0.49, 0.33, 0.28, 0.42, 't')
      ]
    },
    photos: {
      water: {
        kind: 'photo',
        image: 'assets/anubis-thumb-1.png',
        alt: 'Anubis Water и Bridge: карта с указателями на воду и арки',
        source: 'Valve-depot map icon extract via MurkyYT · снимок 07.09.2026',
        coordinateSystem: 'Нормализованные u/v относительно полного 16:9 кадра Water',
        labels: [
          point('photo-water', 'Вода', 0.54, 0.82, 0.72, 0.77, 'ct'),
          point('photo-bridge', 'Мост', 0.56, 0.72, 0.74, 0.58, 'neutral'),
          point('photo-arches', 'Арки', 0.59, 0.49, 0.73, 0.39, 'neutral')
        ]
      },
      a: {
        kind: 'photo',
        image: 'assets/anubis-thumb-2.png',
        alt: 'Anubis A Site: видимый A Site и Fountain',
        source: 'Valve-depot map icon extract via MurkyYT · снимок 07.09.2026',
        coordinateSystem: 'Нормализованные u/v относительно полного 16:9 кадра A Site',
        labels: [
          point('photo-a-site', 'Сайт A', 0.88, 0.53, 0.79, 0.66, 't'),
          point('photo-fountain', 'Фонтан', 0.55, 0.70, 0.69, 0.80, 'neutral')
        ]
      },
      b: {
        kind: 'photo',
        image: 'assets/anubis-thumb-3.png',
        alt: 'Anubis B Site: видимый B Site и центральная Pillar',
        source: 'Valve-depot map icon extract via MurkyYT · снимок 07.09.2026',
        coordinateSystem: 'Нормализованные u/v относительно полного 16:9 кадра B Site',
        labels: [
          point('photo-b-site', 'Сайт B', 0.52, 0.56, 0.67, 0.64, 't'),
          point('photo-pillar', 'Колонна', 0.55, 0.32, 0.69, 0.22, 'neutral')
        ]
      },
      doors: {
        kind: 'photo',
        image: 'assets/anubis-thumb-4.png',
        alt: 'Anubis: дверь и коридор как ориентир для прогонки коллаутов',
        source: 'Valve-depot map icon extract via MurkyYT · снимок 07.09.2026',
        coordinateSystem: 'Нормализованные u/v относительно полного 16:9 кадра Door / Corridor',
        labels: [
          point('photo-door', 'Дверь', 0.16, 0.47, 0.28, 0.36, 'neutral'),
          point('photo-corridor', 'Коридор', 0.70, 0.55, 0.78, 0.43, 'neutral')
        ]
      }
    }
  };
})();
