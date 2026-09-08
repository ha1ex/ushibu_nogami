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
        point('t-spawn', 'Респаун T', 0.440, 0.932, 0.570, 0.947, 't'),
        point('ct-spawn', 'Респаун CT', 0.399, 0.207, 0.270, 0.160, 'ct'),
        point('a-main', 'Мейн A', 0.809, 0.426, 0.885, 0.465, 't'),
        point('a-connector', 'Коннектор A', 0.602, 0.377, 0.705, 0.405, 'neutral'),
        point('a-heaven', 'Хевен A', 0.674, 0.228, 0.740, 0.165, 'ct'),
        point('water', 'Вода', 0.681, 0.494, 0.790, 0.565, 'ct'),
        point('bridge', 'Мост', 0.469, 0.596, 0.565, 0.650, 'neutral'),
        point('mid-doors', 'Двери мида', 0.524, 0.499, 0.440, 0.455, 'neutral'),
        point('drop', 'Спуск · 2026', 0.719, 0.531, 0.815, 0.620, 'signal'),
        point('b-main', 'Мейн B', 0.244, 0.570, 0.135, 0.620, 't'),
        point('b-connector', 'Коннектор B', 0.467, 0.327, 0.365, 0.305, 'neutral'),
        point('ebox', 'Е-бокс', 0.349, 0.588, 0.245, 0.665, 'neutral'),
        point('back-b', 'Дальний B', 0.359, 0.499, 0.240, 0.455, 'ct'),
        point('pillar', 'Колонна', 0.264, 0.559, 0.145, 0.530, 'neutral')
      ]
    },
    ctDefault: {
      kind: 'radar',
      title: 'Дефолт CT · 2 / 1 / 2',
      caption: 'Тренерское решение: два A, один Mid/Water, два B. Ротация — только от подтверждённого инфо.',
      labels: [
        point('ct-a', 'A · 2', 0.718, 0.263, 0.835, 0.245, 'ct'),
        point('ct-mid', 'Мид · 1', 0.524, 0.499, 0.620, 0.545, 'ct'),
        point('ct-b', 'B · 2', 0.285, 0.503, 0.145, 0.450, 'ct')
      ],
      pins: [
        { n: '1', u: 0.674, v: 0.228, label: 'L!S · хевен', lu: 0.805, lv: 0.175, anchor: 'start', player: 'L!S' },
        { n: '2', u: 0.718, v: 0.285, label: 'D4ba · капитан / A', lu: 0.770, lv: 0.335, anchor: 'start', player: 'D4ba' },
        { n: '3', u: 0.524, v: 0.499, label: 'middle · инфо мид', lu: 0.435, lv: 0.455, anchor: 'end', player: 'middle' },
        { n: '4', u: 0.285, v: 0.503, label: 'd0lfero · опорник B', lu: 0.180, lv: 0.580, anchor: 'end', player: 'd0lfero' },
        { n: '5', u: 0.349, v: 0.588, label: 'Reconnecting · Е-бокс', lu: 0.220, lv: 0.650, anchor: 'end', player: 'Reconnecting' }
      ]
    },
    tDefault: {
      kind: 'radar',
      title: 'Дефолт T · 2 / 2 / 1',
      caption: 'Тренерское решение: две пары собирают инфо, пятый держит B Main. До команды — не форсить контакт.',
      labels: [
        point('t-a', 'Мейн A · 2', 0.809, 0.426, 0.875, 0.470, 't'),
        point('t-mid', 'Мид · 1', 0.524, 0.499, 0.565, 0.565, 't'),
        point('t-water', 'Вода · 1', 0.681, 0.494, 0.770, 0.555, 't'),
        point('t-b', 'Мейн B · 1', 0.244, 0.570, 0.125, 0.615, 't')
      ],
      routes: [
        route('t-a-route', '1–2 · информация A', [[0.440, 0.932], [0.585, 0.755], [0.690, 0.610], [0.809, 0.426]], 't'),
        route('t-mid-route', '3–4 · Mid → Water', [[0.440, 0.932], [0.440, 0.690], [0.469, 0.596], [0.524, 0.499], [0.681, 0.494]], 't'),
        route('t-b-route', '5 · B Main', [[0.440, 0.932], [0.310, 0.765], [0.245, 0.650], [0.244, 0.570]], 't')
      ],
      pins: [
        { n: '1', u: 0.760, v: 0.470, label: 'L!S · энтри A', lu: 0.865, lv: 0.405, anchor: 'start', player: 'L!S' },
        { n: '2', u: 0.809, v: 0.426, label: 'D4ba · размен A', lu: 0.895, lv: 0.505, anchor: 'start', player: 'D4ba' },
        { n: '3', u: 0.524, v: 0.525, label: 'middle · инфо мид', lu: 0.425, lv: 0.475, anchor: 'end', player: 'middle' },
        { n: '4', u: 0.681, v: 0.494, label: 'Reconnecting · вода', lu: 0.760, lv: 0.620, anchor: 'start', player: 'Reconnecting' },
        { n: '5', u: 0.244, v: 0.570, label: 'd0lfero · бомба / B', lu: 0.120, lv: 0.650, anchor: 'end', player: 'd0lfero' }
      ]
    },
    midWater: {
      kind: 'radar',
      title: 'Мид → мост → вода',
      caption: 'Две точки решения: после первого инфо и после подтверждения CT-реакции.',
      labels: [
        point('mid-info', '1 · инфо у дверей', 0.524, 0.499, 0.405, 0.480, 't'),
        point('bridge-decision', '2 · мост: решение', 0.469, 0.596, 0.560, 0.665, 'signal'),
        point('water-a', 'Ветка A через воду', 0.681, 0.494, 0.790, 0.560, 't'),
        point('mid-b', 'Ветка B через Е-бокс', 0.349, 0.588, 0.215, 0.635, 't')
      ],
      routes: [
        route('mid-route', '1 · получить инфо', [[0.440, 0.932], [0.440, 0.690], [0.469, 0.596], [0.524, 0.499]], 't'),
        route('water-route', '2a · Water → A', [[0.524, 0.499], [0.600, 0.520], [0.681, 0.494], [0.720, 0.360], [0.718, 0.263]], 't'),
        route('ebox-route', '2b · E-box → B', [[0.524, 0.499], [0.469, 0.596], [0.420, 0.610], [0.349, 0.588], [0.285, 0.503]], 't')
      ],
      pins: [
        { n: '1', u: 0.524, v: 0.525, label: 'middle · инфо', lu: 0.415, lv: 0.520, anchor: 'end', player: 'middle' },
        { n: '2', u: 0.469, v: 0.596, label: 'D4ba · решение', lu: 0.520, lv: 0.710, anchor: 'start', player: 'D4ba' },
        { n: '3', u: 0.681, v: 0.494, label: 'L!S · вода → A', lu: 0.800, lv: 0.475, anchor: 'start', player: 'L!S' },
        { n: '4', u: 0.349, v: 0.588, label: 'Reconnecting · Е-бокс', lu: 0.210, lv: 0.565, anchor: 'end', player: 'Reconnecting' }
      ]
    },
    aExecute: {
      kind: 'radar',
      title: 'Выход A · мейн + вода',
      caption: 'Тренерское решение: 3 Main + 2 Water/A Connector. Все входы — по одному GO.',
      labels: [
        point('a-go', 'ВХОД · синхронно', 0.790, 0.337, 0.875, 0.460, 'signal'),
        point('a-plant', 'Бомба · плент', 0.718, 0.263, 0.835, 0.255, 't'),
        point('a-stop', 'СТОП: нет воды / гранат', 0.681, 0.494, 0.770, 0.600, 'signal'),
        point('a-success', 'УСПЕХ: сайт + отсечён CT', 0.735, 0.285, 0.620, 0.360, 'ct')
      ],
      routes: [
        route('a-main-1', '1–3 · Main', [[0.440, 0.932], [0.585, 0.755], [0.690, 0.610], [0.809, 0.426], [0.790, 0.337], [0.718, 0.263]], 't'),
        route('a-water-2', '4–5 · Water', [[0.440, 0.932], [0.440, 0.690], [0.469, 0.596], [0.524, 0.499], [0.681, 0.494], [0.720, 0.360], [0.718, 0.263]], 't')
      ],
      pins: [
        { n: '1', u: 0.790, v: 0.360, label: 'L!S · энтри', lu: 0.895, lv: 0.390, anchor: 'start', player: 'L!S' },
        { n: '2', u: 0.765, v: 0.405, label: 'D4ba · капитан / размен', lu: 0.875, lv: 0.500, anchor: 'start', player: 'D4ba' },
        { n: '3', u: 0.735, v: 0.310, label: 'd0lfero · бомба', lu: 0.815, lv: 0.205, anchor: 'start', player: 'd0lfero' },
        { n: '4', u: 0.681, v: 0.470, label: 'Reconnecting · гранаты', lu: 0.590, lv: 0.430, anchor: 'end', player: 'Reconnecting' },
        { n: '5', u: 0.650, v: 0.520, label: 'middle · фланг / инфо', lu: 0.535, lv: 0.560, anchor: 'end', player: 'middle' }
      ]
    },
    bExecute: {
      kind: 'radar',
      title: 'Выход B · канал + мейн B',
      caption: 'Тренерское решение: 2 Canal + 3 B Main. Вход начинается только после готовой utility.',
      labels: [
        point('b-go', 'ВХОД · гранаты готовы', 0.285, 0.515, 0.135, 0.440, 'signal'),
        point('b-pillar', 'Колонна · выжечь', 0.264, 0.559, 0.125, 0.555, 't'),
        point('b-plant', 'Бомба · плент', 0.285, 0.503, 0.210, 0.370, 't'),
        point('b-stop', 'СТОП: Е-бокс открыт', 0.349, 0.588, 0.495, 0.650, 'signal'),
        point('b-success', 'УСПЕХ: сайт + дальний B', 0.359, 0.499, 0.455, 0.405, 'ct')
      ],
      routes: [
        route('b-main-1', '1–3 · B Main', [[0.440, 0.932], [0.310, 0.765], [0.245, 0.650], [0.244, 0.570], [0.285, 0.503]], 't'),
        route('b-canal-2', '4–5 · Canal / E-box', [[0.440, 0.932], [0.440, 0.690], [0.469, 0.596], [0.545, 0.610], [0.420, 0.610], [0.349, 0.588], [0.285, 0.503]], 't')
      ],
      pins: [
        { n: '1', u: 0.244, v: 0.570, label: 'L!S · энтри', lu: 0.120, lv: 0.650, anchor: 'end', player: 'L!S' },
        { n: '2', u: 0.270, v: 0.540, label: 'D4ba · капитан / размен', lu: 0.400, lv: 0.540, anchor: 'start', player: 'D4ba' },
        { n: '3', u: 0.285, v: 0.503, label: 'd0lfero · бомба', lu: 0.400, lv: 0.460, anchor: 'start', player: 'd0lfero' },
        { n: '4', u: 0.349, v: 0.588, label: 'Reconnecting · гранаты', lu: 0.470, lv: 0.720, anchor: 'start', player: 'Reconnecting' },
        { n: '5', u: 0.420, v: 0.610, label: 'middle · фланг / инфо', lu: 0.550, lv: 0.575, anchor: 'start', player: 'middle' }
      ]
    },
    ctReaction: {
      kind: 'radar',
      title: 'CT: потеряли Mid / Water',
      caption: 'Не отбиваем по одному. Mid первым сообщает, якорь остаётся, ретейк только втроём и с utility.',
      labels: [
        point('ct-lost', 'ПОТЕРЯН · мид', 0.524, 0.499, 0.610, 0.575, 'signal'),
        point('ct-stop', 'СТОП · A не бросать', 0.718, 0.300, 0.835, 0.365, 'signal'),
        point('ct-retake-a', 'РЕТЕЙК A · 3+', 0.718, 0.263, 0.840, 0.235, 'ct'),
        point('ct-reaction-b', 'опорник B держит', 0.285, 0.503, 0.145, 0.455, 'ct')
      ],
      routes: [
        route('ct-fall-back', '1 · уйти живым', [[0.524, 0.499], [0.555, 0.430], [0.602, 0.377]], 'ct'),
        route('ct-retake-a', '2 · собраться на A', [[0.602, 0.377], [0.660, 0.320], [0.718, 0.263]], 'ct')
      ],
      pins: [
        { n: '1', u: 0.555, v: 0.430, label: 'middle · отход', lu: 0.455, lv: 0.395, anchor: 'end', player: 'middle' },
        { n: '2', u: 0.660, v: 0.320, label: 'D4ba · сбор A', lu: 0.770, lv: 0.305, anchor: 'start', player: 'D4ba' }
      ]
    },
    nadeBoard: {
      kind: 'radar',
      title: 'Карточки гранат: только кандидаты',
      caption: 'Ссылка подтверждает опубликованный lineup; живой бросок в текущем билде ещё не записан.',
      labels: [
        point('nade-water', 'Вода', 0.681, 0.494, 0.790, 0.555, 't'),
        point('nade-mid', 'Верх мида', 0.440, 0.690, 0.325, 0.735, 't'),
        point('nade-ebox', 'Е-бокс', 0.349, 0.588, 0.235, 0.630, 't')
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
          point('photo-water', 'Вода', 0.56, 0.86, 0.73, 0.80, 'ct'),
          point('photo-bridge', 'Мост', 0.60, 0.72, 0.76, 0.66, 'neutral'),
          point('photo-arches', 'Арки', 0.63, 0.49, 0.76, 0.40, 'neutral')
        ]
      },
      a: {
        kind: 'photo',
        image: 'assets/anubis-thumb-2.png',
        alt: 'Anubis A Site: видимый A Site и Fountain',
        source: 'Valve-depot map icon extract via MurkyYT · снимок 07.09.2026',
        coordinateSystem: 'Нормализованные u/v относительно полного 16:9 кадра A Site',
        labels: [
          point('photo-a-site', 'Сайт A', 0.78, 0.53, 0.87, 0.62, 't'),
          point('photo-fountain', 'Фонтан', 0.60, 0.70, 0.70, 0.82, 'neutral')
        ]
      },
      b: {
        kind: 'photo',
        image: 'assets/anubis-thumb-3.png',
        alt: 'Anubis B Site: видимый B Site и центральная Pillar',
        source: 'Valve-depot map icon extract via MurkyYT · снимок 07.09.2026',
        coordinateSystem: 'Нормализованные u/v относительно полного 16:9 кадра B Site',
        labels: [
          point('photo-b-site', 'Сайт B', 0.48, 0.55, 0.64, 0.65, 't'),
          point('photo-pillar', 'Колонна', 0.52, 0.28, 0.68, 0.20, 'neutral')
        ]
      },
      doors: {
        kind: 'photo',
        image: 'assets/anubis-thumb-4.png',
        alt: 'Anubis: дверь и коридор как ориентир для прогонки коллаутов',
        source: 'Valve-depot map icon extract via MurkyYT · снимок 07.09.2026',
        coordinateSystem: 'Нормализованные u/v относительно полного 16:9 кадра Door / Corridor',
        labels: [
          point('photo-door', 'Дверь', 0.29, 0.47, 0.18, 0.37, 'neutral'),
          point('photo-corridor', 'Коридор', 0.71, 0.50, 0.82, 0.40, 'neutral')
        ]
      }
    }
  };
})();
