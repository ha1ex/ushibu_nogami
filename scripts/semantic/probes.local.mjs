// probes.local.mjs — PROJECT-OWNED golden-set проб для eval.mjs / search-quality-probes.mjs.
//
// Шаблон этот файл не поставляет: пробы описывают ЭТУ базу знаний (скаутинг CS2 для «Ушибу ногами»).
// Композитор probes.mjs подхватывает их автоматически, экспорт — LOCAL_PROBES.
//
// Схема пробы:
//   q            — запрос как от пользователя (естественный, не ключевые слова);
//   expect_file  — alt-подстрока пути релевантного файла (OR через |);
//   category     — группа в by_category отчёта eval.
//
// После добавления/удаления проб пересними baseline:
//   node scripts/semantic/eval.mjs --update-baseline

export const LOCAL_PROBES = [
  // --- вето и карты ---
  {
    q: 'какую карту пикать и какую банить в вето',
    expect_file: 'cs2-veto-strategy|map-pool-2026',
    category: 'Veto',
  },
  {
    q: 'на какой карте мы сильнее всех соперников',
    expect_file: 'map-pool-2026|cs2-veto-strategy',
    category: 'Veto',
  },
  {
    q: 'почему Dust 2 стоит забанить если команда за неё голосовала',
    expect_file: 'cs2-veto-strategy|contradictions|map-pool-2026',
    category: 'Veto',
  },
  {
    q: 'что тренировать в первую очередь по картам',
    expect_file: 'cs2-veto-strategy|map-pool-2026',
    category: 'Veto',
  },

  // --- диагностика своей команды ---
  {
    q: 'почему у нас проседает сторона атаки',
    expect_file: 'cs2-team-diagnostics|t-ct-split',
    category: 'Diagnostics',
  },
  {
    q: 'насколько команда зависит от одного игрока',
    expect_file: 'cs2-team-diagnostics',
    category: 'Diagnostics',
  },
  {
    q: 'что у нас плохо с утилитой и уроном по своим',
    expect_file: 'cs2-team-diagnostics',
    category: 'Diagnostics',
  },
  {
    q: 'в чём мы первые в группе',
    expect_file: 'cs2-team-diagnostics',
    category: 'Diagnostics',
  },

  // --- соперники и планы на матчи ---
  {
    q: 'план на матч против Поцелуй всадницу',
    expect_file: 'cs2-opponent-plans|opponents',
    category: 'Opponents',
  },
  {
    q: 'кто главная угроза в составе Рассадник добра',
    expect_file: 'opponents|cs2-opponent-plans',
    category: 'Opponents',
  },
  {
    q: 'что известно про замену Dexter на Siberian Hawk у Такахули',
    expect_file: 'cs2-opponent-plans|opponents',
    category: 'Opponents',
  },
  {
    q: 'у кого лучший ретейк в группе',
    expect_file: 'opponents|cs2-whoajor-intelligence',
    category: 'Opponents',
  },

  // --- методология и ограничения данных ---
  {
    q: 'значит ли equivalent team matches что команда играла вместе',
    expect_file: 'metric-equivalent-team-matches',
    category: 'Methodology',
  },
  {
    q: 'как считается покартовая сила состава',
    expect_file: 'metric-estimated-strength',
    category: 'Methodology',
  },
  {
    q: 'чего нет в снимке whoajor и почему',
    expect_file: 'cs2-whoajor-intelligence|metric-equivalent-team-matches',
    category: 'Methodology',
  },
  {
    q: 'откуда взяты все цифры по соперникам',
    expect_file: 'cs2-whoajor-intelligence',
    category: 'Methodology',
  },

  // --- контекст ---
  {
    q: 'когда и с кем мы играем',
    expect_file: 'product|cs2-opponent-plans',
    category: 'Context',
  },
  {
    q: 'какой у нас состав и рейтинги игроков',
    expect_file: 'product|cs2-whoajor-intelligence',
    category: 'Context',
  },
];
