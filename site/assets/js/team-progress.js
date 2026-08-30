/* ============================================================
   Командная сводка: кто сколько галочек отметил.

   Данные берём из /api/team — там на каждого игрока лежат счётчики
   личных отметок (гранаты, правила, лестница). Сервер отдаёт только
   количества, содержимое чужих отметок остаётся закрытым.

   Своя строка всегда пересчитывается из локального состояния, поэтому
   только что поставленная галочка видна сразу, не дожидаясь сервера.
   Чужие подтягиваются после каждого сохранения и при возврате
   на вкладку.
   ============================================================ */

window.TeamProgress = (function () {
  'use strict';

  var U = window.UI;
  var el = U.el;

  var PREFIX = { nades: 'nade-', rules: 'rule-', ladder: 'lad-' };

  var cache = null;      // последний успешный ответ сервера
  var inflight = null;   // не шлём параллельные запросы

  /* ---------------- Данные ---------------- */

  function fetchRoster() {
    if (inflight) return inflight;

    var request = fetch('/api/team', { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        inflight = null;
        cache = Array.isArray(data.roster) ? data.roster : [];
        return cache;
      })
      .catch(function (err) {
        inflight = null;
        throw err;
      });

    inflight = request;
    return request;
  }

  /* Свои счётчики берём из локального состояния: оно свежее ответа сервера. */
  function withLocal(roster) {
    var me = window.Store.me();
    if (!me) return roster.slice();

    return roster.map(function (p) {
      if (p.id !== me.id) return p;
      return {
        id: p.id,
        nick: p.nick,
        nades: window.Store.countByPrefix(PREFIX.nades),
        rules: window.Store.countByPrefix(PREFIX.rules),
        ladder: window.Store.countByPrefix(PREFIX.ladder)
      };
    });
  }

  /* ---------------- Отрисовка ---------------- */

  function rows(roster, opts) {
    var me = window.Store.me();

    return withLocal(roster)
      .map(function (p) {
        var main = opts.main(p);
        var pct = main.total ? Math.round((main.done / main.total) * 100) : 0;
        return { p: p, done: main.done, total: main.total, pct: pct, mine: !!me && me.id === p.id };
      })
      .sort(function (a, b) {
        if (b.pct !== a.pct) return b.pct - a.pct;
        return a.p.nick.localeCompare(b.p.nick, 'ru');
      });
  }

  function meterList(roster, opts) {
    return el('div', { class: 'meter-list' }, rows(roster, opts).map(function (r) {
      return el('div', { class: 'meter' + (r.mine ? ' meter--accent' : '') }, [
        el('div', { class: 'meter__name' }, el('span', {}, [
          el('strong', { class: 'meter__title', text: r.p.nick }),
          r.mine ? el('span', { class: 'chip chip--accent', style: 'margin-left:var(--s2)', text: 'вы' }) : null,
          el('br'),
          el('small', { class: 'label', text: opts.sub(r.p) })
        ])),
        el('div', { class: 'meter__track' },
          el('i', { class: 'meter__fill' + (r.mine ? '' : ' meter__fill--dim'), style: '--value:' + r.pct + '%' })),
        el('span', { class: 'meter__value', text: r.done + '/' + r.total })
      ]);
    }));
  }

  /* Карточка со сводкой. Сама загружается и сама обновляется.

     opts:
       title  — заголовок карточки
       hint   — подпись справа в шапке
       main   — (player) → { done, total }: по чему считается полоска
       sub    — (player) → строка с расшифровкой под ником          */
  function card(opts) {
    var body = el('div', {}, el('p', { class: 'label', text: 'Загружаем сводку…' }));
    var node = el('article', { class: 'module' + (opts.className ? ' ' + opts.className : '') }, [
      el('div', { class: 'card__head' }, [
        el('span', { text: opts.title }),
        el('span', { text: opts.hint || '' })
      ]),
      body
    ]);

    function draw(roster) {
      U.mount(body, meterList(roster, opts));
    }

    function fail() {
      // Уже нарисованную сводку не затираем: лучше показать чуть устаревшую, чем ошибку.
      if (cache) return;
      U.mount(body, el('p', {
        class: 'label',
        style: 'color:var(--signal)',
        text: 'Сводку загрузить не удалось'
      }));
    }

    function reload() {
      fetchRoster().then(draw).catch(fail);
    }

    reload();

    // Своя галочка — сразу, без похода на сервер.
    window.Store.onChange(function () { if (cache) draw(cache); });

    // Сохранились — забираем свежую картину по всем.
    window.Store.onStatus(function (status) { if (status === 'saved') reload(); });

    // Вернулись на вкладку — могли отметить с телефона или это мог сделать другой.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') reload();
    });

    return node;
  }

  return {
    load: fetchRoster,
    withLocal: withLocal,
    meterList: meterList,
    card: card
  };
})();
