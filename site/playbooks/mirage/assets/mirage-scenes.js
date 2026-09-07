/*
 * Mirage: единая нормализованная система координат.
 * Исходные u/v и lu/lv автоматически калибруются относительно полного
 * clean game radar 1374×1196. Якоря не сдвигаются ради композиции.
 */
(function () {
  'use strict';

  var RADAR = {
    image: 'assets/mirage-game-radar.webp',
    alt: 'Чистый игровой радар Mirage с русскими командными выносками',
    source: 'CSNADES.gg · clean game radar · снимок 07.09.2026',
    coordinateSystem: 'u/v 0…1 относительно полного файла 1374×1196'
  };

  /*
   * Матрица получена сопоставлением геометрии исходного callouts-файла
   * и clean game radar. Все координаты ниже калибруются в новую систему.
   */
  function calibrated(u, v) {
    var divisor = 0.00111398411 * u - 0.00244915965 * v + 1;
    return [
      (1.06024552 * u - 0.000950464505 * v - 0.0299779975) / divisor,
      (-0.000289797135 * u + 1.14708987 * v - 0.0263457415) / divisor
    ];
  }

  function point(id, label, u, v, tx, ty, tone) {
    var anchor = calibrated(u, v);
    var plaque = calibrated(tx, ty);
    return { id: id, label: label, u: anchor[0], v: anchor[1], tx: plaque[0], ty: plaque[1], tone: tone || 'neutral' };
  }

  function route(id, points, tone) {
    return { id: id, points: points.map(function (p) { return calibrated(p[0], p[1]); }), tone: tone || 't' };
  }

  function pin(n, u, v, label, lu, lv, anchor, player) {
    var location = calibrated(u, v);
    var plaque = calibrated(lu, lv);
    return { n: n, u: location[0], v: location[1], label: label, lu: plaque[0], lv: plaque[1], anchor: anchor, player: player };
  }

  window.MIRAGE_SCENES = {
    radar: RADAR,
    callouts: {
      labels: [
        point('t-spawn', 'Респаун T', 0.909, 0.296, 0.856, 0.254, 't'),
        point('ct-spawn', 'Респаун CT', 0.222, 0.688, 0.137, 0.728, 'ct'),
        point('a-ramp', 'Яма A', 0.735, 0.640, 0.850, 0.627, 't'),
        point('tetris', 'Тетрис', 0.626, 0.612, 0.703, 0.574, 'neutral'),
        point('palace', 'Ковры A', 0.674, 0.802, 0.797, 0.839, 't'),
        point('a-site', 'Сайт A', 0.529, 0.770, 0.465, 0.715, 'neutral'),
        point('a-default', 'Дефолт A', 0.568, 0.748, 0.675, 0.727, 'neutral'),
        point('ticket', 'Сити', 0.410, 0.845, 0.309, 0.883, 'ct'),
        point('jungle', 'Джангл', 0.370, 0.585, 0.274, 0.550, 'ct'),
        point('connector', 'Коннектор', 0.485, 0.510, 0.557, 0.475, 'neutral'),
        point('mid-window', 'Окно', 0.381, 0.405, 0.270, 0.420, 'ct'),
        point('top-mid', 'Верх мида', 0.688, 0.351, 0.793, 0.361, 't'),
        point('short', 'Шорт', 0.413, 0.212, 0.518, 0.180, 'neutral'),
        point('b-apts', 'Ковры B', 0.286, 0.086, 0.322, 0.040, 't'),
        point('van', 'Машина', 0.128, 0.096, 0.060, 0.068, 'ct'),
        point('bench-b', 'Скамейка', 0.076, 0.183, 0.055, 0.235, 'ct'),
        point('b-site', 'Сайт B', 0.184, 0.198, 0.094, 0.156, 'neutral'),
        point('market', 'Кухня', 0.171, 0.382, 0.082, 0.417, 'ct')
      ]
    },
    tDefault: {
      labels: [
        point('t-a', 'Яма A · 2', 0.752, 0.637, 0.853, 0.603, 't'),
        point('t-mid', 'Верх мида · 2', 0.690, 0.355, 0.800, 0.390, 't'),
        point('t-b', 'Ковры B · 1', 0.475, 0.095, 0.575, 0.058, 't')
      ],
      routes: [
        route('t-route-a', [[0.909, 0.296], [0.830, 0.420], [0.752, 0.637]], 't'),
        route('t-route-mid', [[0.909, 0.296], [0.790, 0.325], [0.690, 0.355]], 't'),
        route('t-route-b', [[0.909, 0.296], [0.730, 0.130], [0.475, 0.095]], 't')
      ]
    },
    midControl: {
      labels: [
        point('mid-window', 'Окно · закрыть', 0.381, 0.405, 0.265, 0.430, 'ct'),
        point('mid-connector', 'Коннектор · проверить', 0.485, 0.510, 0.586, 0.528, 'signal'),
        point('mid-short', 'Шорт · второй угол', 0.414, 0.212, 0.528, 0.184, 't')
      ],
      routes: [
        route('mid-main', [[0.909, 0.296], [0.785, 0.326], [0.690, 0.355], [0.540, 0.395]], 't'),
        route('mid-short', [[0.540, 0.395], [0.455, 0.300], [0.414, 0.212]], 't'),
        route('mid-connector', [[0.540, 0.395], [0.485, 0.510]], 't')
      ]
    },
    aExecute: {
      labels: [
        point('a-jungle', 'Джангл · смок', 0.370, 0.585, 0.257, 0.548, 'signal'),
        point('a-stairs', 'Лестница · смок', 0.525, 0.610, 0.450, 0.658, 'signal'),
        point('a-ticket', 'Сити · смок', 0.410, 0.845, 0.315, 0.883, 'signal'),
        point('a-plant', 'Плент · дефолт A', 0.568, 0.748, 0.680, 0.725, 't')
      ],
      routes: [
        route('a-ramp', [[0.830, 0.420], [0.752, 0.637], [0.625, 0.650], [0.560, 0.735]], 't'),
        route('a-palace', [[0.790, 0.505], [0.720, 0.690], [0.675, 0.802], [0.575, 0.760]], 't')
      ],
      pins: [
        pin('1', 0.720, 0.638, 'L!S · вход', 0.830, 0.605, 'start', 'L!S'),
        pin('2', 0.665, 0.655, 'D4ba · размен', 0.800, 0.672, 'start', 'D4ba'),
        pin('3', 0.610, 0.725, 'd0lfero · бомба', 0.745, 0.760, 'start', 'd0lfero'),
        pin('4', 0.485, 0.510, 'middle · коннектор', 0.600, 0.490, 'start', 'middle'),
        pin('5', 0.535, 0.595, 'Reconnecting · гранаты', 0.430, 0.555, 'end', 'Reconnecting')
      ]
    },
    bExecute: {
      labels: [
        point('b-market-window', 'Окно кухни · смок', 0.208, 0.339, 0.120, 0.300, 'signal'),
        point('b-bench', 'Скамейка · смок', 0.076, 0.183, 0.050, 0.232, 'signal'),
        point('b-arch', 'Правый проход · смок', 0.290, 0.188, 0.410, 0.145, 'signal'),
        point('b-plant', 'Плент · дефолт B', 0.184, 0.198, 0.113, 0.154, 't')
      ],
      routes: [
        route('b-apts', [[0.909, 0.296], [0.735, 0.130], [0.475, 0.095], [0.285, 0.088], [0.185, 0.200]], 't'),
        route('b-short', [[0.690, 0.355], [0.540, 0.395], [0.414, 0.212], [0.240, 0.190]], 't')
      ],
      pins: [
        pin('1', 0.285, 0.103, 'L!S · вход', 0.410, 0.062, 'start', 'L!S'),
        pin('2', 0.245, 0.125, 'D4ba · размен', 0.390, 0.125, 'start', 'D4ba'),
        pin('3', 0.205, 0.190, 'd0lfero · бомба', 0.340, 0.205, 'start', 'd0lfero'),
        pin('4', 0.410, 0.205, 'middle · шорт', 0.535, 0.245, 'start', 'middle'),
        pin('5', 0.465, 0.122, 'Reconnecting · гранаты', 0.590, 0.105, 'start', 'Reconnecting')
      ]
    },
    ctDefault: {
      labels: [
        point('ct-a', 'A · 2', 0.525, 0.730, 0.625, 0.700, 'ct'),
        point('ct-mid', 'Мид · 1', 0.330, 0.455, 0.238, 0.480, 'ct'),
        point('ct-b', 'B · 2', 0.175, 0.220, 0.080, 0.255, 'ct')
      ],
      pins: [
        pin('1', 0.410, 0.835, 'L!S · сити', 0.295, 0.880, 'end', 'L!S'),
        pin('2', 0.525, 0.720, 'D4ba · A', 0.655, 0.705, 'start', 'D4ba'),
        pin('3', 0.381, 0.405, 'middle · окно', 0.255, 0.430, 'end', 'middle'),
        pin('4', 0.165, 0.220, 'd0lfero · B', 0.060, 0.165, 'end', 'd0lfero'),
        pin('5', 0.315, 0.230, 'Reconnecting · шорт', 0.445, 0.240, 'start', 'Reconnecting')
      ],
      pinTone: 'ct'
    },
    ctReactionA: {
      labels: [
        point('a-contact', 'КОНТАКТ · яма / ковры', 0.650, 0.660, 0.785, 0.625, 'signal'),
        point('a-anchor', 'A остаётся живым', 0.525, 0.730, 0.420, 0.690, 'ct'),
        point('a-rotate', 'Ротация · окно → джангл', 0.330, 0.455, 0.230, 0.510, 'ct'),
        point('b-hold', 'B держит до подтверждения', 0.175, 0.220, 0.080, 0.275, 'ct')
      ],
      routes: [
        route('ct-a-rotate', [[0.255, 0.365], [0.330, 0.455], [0.370, 0.585], [0.525, 0.730]], 'ct'),
        route('ct-b-short', [[0.315, 0.230], [0.410, 0.340], [0.370, 0.585]], 'ct')
      ]
    },
    ctReactionB: {
      labels: [
        point('b-contact', 'КОНТАКТ · ковры B', 0.285, 0.100, 0.420, 0.065, 'signal'),
        point('b-anchor', 'B якорь · задержка', 0.175, 0.220, 0.078, 0.260, 'ct'),
        point('b-rotate', 'Ротация · шорт / кухня', 0.330, 0.455, 0.455, 0.430, 'ct'),
        point('a-hold', 'A не бросать по шуму', 0.525, 0.730, 0.650, 0.705, 'ct')
      ],
      routes: [
        route('ct-b-short', [[0.330, 0.455], [0.410, 0.330], [0.414, 0.212], [0.250, 0.200]], 'ct'),
        route('ct-b-market', [[0.410, 0.835], [0.325, 0.650], [0.210, 0.430], [0.171, 0.382]], 'ct')
      ]
    },
    retakeA: {
      labels: [
        point('ra-ticket', 'Сбор · сити', 0.410, 0.845, 0.305, 0.885, 'ct'),
        point('ra-jungle', 'Второй вход · джангл', 0.370, 0.585, 0.260, 0.545, 'ct'),
        point('ra-site', 'Фокус · дефолт A', 0.568, 0.748, 0.680, 0.720, 'signal')
      ],
      routes: [
        route('retake-a-ticket', [[0.410, 0.845], [0.500, 0.800], [0.568, 0.748]], 'ct'),
        route('retake-a-jungle', [[0.370, 0.585], [0.455, 0.650], [0.568, 0.748]], 'ct')
      ]
    },
    retakeB: {
      labels: [
        point('rb-market', 'Сбор · кухня', 0.171, 0.382, 0.075, 0.420, 'ct'),
        point('rb-short', 'Второй вход · шорт', 0.414, 0.212, 0.535, 0.178, 'ct'),
        point('rb-site', 'Фокус · дефолт B', 0.184, 0.198, 0.095, 0.155, 'signal')
      ],
      routes: [
        route('retake-b-market', [[0.171, 0.382], [0.200, 0.300], [0.184, 0.198]], 'ct'),
        route('retake-b-short', [[0.414, 0.212], [0.300, 0.195], [0.184, 0.198]], 'ct')
      ]
    }
  };
})();
