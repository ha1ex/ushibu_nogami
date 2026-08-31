# Лог изменений KB

> Каждое значимое обновление (новый источник, новая wiki-страница, новое решение) — одна строка.
> Формат: `YYYY-MM-DD | <слой> | <краткое описание>`.
> Шаг 9 из ingest workflow в AGENTS.md.

## 2026-05-26

- (init) Создан репозиторий из шаблона `ai-kb-harness-template`.
- tools/viewer | generic Viewer (Vite + React + Tailwind 4): дизайн-система, 6 страниц, API, граф.
- scripts/skillopt | Phase 1–3: regression-тесты SKILL.md (multi-provider LLM), optimization loop (reflect/diff/apply/revert) + 2 graders, read-only MCP-сервер + страница /skillopt.
- README | TL;DR: 4 слоя, 4 сценария, границы ответственности.
- 06_outputs/cybos-cases | зеркало cybos.ai/cases — 418 кейсов в 11 категориях + scrapers.

## 2026-05-27

- 06_outputs/anthropics-skills | пилот anthropic agent skills — 12 Apache-2.0 + категория Design.
- 06_outputs/{fabric-patterns,claude-cookbooks} | +fabric 218 patterns +claude-cookbooks 84 notebooks +3 promoted SKILL.md → 732 единиц / 4 источника.
- 06_outputs | dedup + source-available cards + quality-probes (18/18 PASS), затем расширены до 42/42 PASS на 14 категорий.
- .claude/skills | interviewer-agent (auto-trigger «интервью» / «interview»).

## 2026-05-29

- 06_outputs/_audit-report-2026-05-29.md | всесторонний аудит (двойная оптика «шаблон / реальная KB»), 6 измерений, scorecard + backlog.
- harness + контент | фиксы аудита: supply chain (`protobufjs` override), viewer security (allowlist .md + bind 127.0.0.1), сужены permissions + наполнен deny, онбординг (`.nvmrc`/`engines`/`setup`/CI), таймауты на `spawnSync`, path-guard в skillopt MCP, заполнен semantic invariant, задокументирован external-corpus, cybos licensing (provider/license ×418), помечены 7 fabric-стабов. Детали — в `CHANGELOG.md`.
- 06_outputs/mcp-catalog/ | каталог базовых MCP — 12 серверов (7 reference + Playwright, Chrome DevTools, Context7, GitHub, Brave Search) + `baseline.mcp.json` (keyless-набор). Отобрано по deep-research май 2026.

## 2026-06-25

- 04_synthesis | `code-as-agent-harness-adoption.md` — синтез разбора обзора «Code as Agent Harness» (adopt now/later/not).
- harness (Control) | N1 verify→critique→revise: `verify.mjs` отдаёт `critique`, `kb-critic.mjs` строит revision-промпт (`--execute` авто-цикл).
- harness (Control) | N3 verify-гейт в CI (`verify.mjs --scan --provenance`); цитаты в комментариях/коде игнорируются (`maskExamples`).
- harness (Control) | N4 layer-handoff provenance: `scripts/lib/provenance.mjs` + PreToolUse-хук `check-provenance.mjs`. Тесты `test-control.mjs`.
- harness (Memory/Evolve) | N2 verified answer-cards: `kb_promote` → `04_synthesis/_answers/` (gated verify+provenance+dedup); `kb-doctor` флагует stale.
- harness | quick-wins: `log.md` в индексе (`INDEXABLE_ROOT_FILES`), describe-then-index (L3), scratch-hygiene inbox (L4), `.remember/preferences.md` answer-policy (L5).

## 2026-07-02

- harness (Control) | A1–A4: закрыты обходы контура доверия — path-traversal в цитатах, claim-coverage (FACT/DECISION без цитаты = гейт), регистронезависимый `[source:]`, adversarial-сьют `test-gate.mjs` в CI, наблюдаемый fail-open хуков, git pre-push гейт.
- 00_context…05_decisions | walkthrough-пример «пилот AI-ассистента поддержки»: сквозная цепочка raw → summary → wiki → synthesis → decision с метками/цитатами; удаляется `kb:init --strip-demo`.
- 04_synthesis/_answers | закоммичен каркас для verified answer-cards (`kb_promote`, N2).

## 2026-08-29

- (init) kb:init: проект «Ushibu Nogami — личная база знаний», демо вычищено, level=2.
- 01_raw/whoajor | снимок статистики stats.whoajor.com по пяти составам CS2 (1.4 MB JSON, immutable).
- 02_sources | саммари снимка: методология, окна recent/long, командные и покартовые агрегаты, 30 игроков.
- 03_wiki | 5 концептов: opponents, map-pool-2026, t-ct-split, metric-estimated-strength, metric-equivalent-team-matches.
- 04_synthesis | cs2-team-diagnostics, cs2-veto-strategy, cs2-opponent-plans; open-questions переписаны под домен (Q1–Q5), добавлено противоречие C1 (Dust 2: голос команды против статистики).
- 00_context | product.md — команда, расписание, пул карт, ограничения данных.
- (init) домен проекта зафиксирован: скаутинг CS2 для «Ушибу ногами»; walkthrough-пример шаблона удалён.

## 2026-08-30

- FACT: 01_raw/whoajor + 02_sources | импортирован канонический полный снимок Whoajor v2: 864 ответа,
  368 карточек матчей, 7 903 раунда, trends для 20 игроков и проверенная SQLite с 29 таблицами;
  предшествующий v1 сохранён как superseded history без trends.
  [source: /02_sources/2026-08-30-whoajor-full-snapshot.md]
- FACT: 01_raw/whoajor + 02_sources | добавлен immutable audit публичного SPA surface:
  8 GET-наблюдений 7 HTML/JS ресурсов, 24 GET call site, все 16 семейств CONTRACT v1.1 и два
  явно исключённых POST.
  [source: /02_sources/2026-08-30-whoajor-spa-surface-audit.md]
- DECISION: Сбор выполнен в однократном scope; регулярный автоматический обход в него не входит.
  [source: /05_decisions/whoajor-collection-scope.md]
- 01_raw/trainings + 02_sources | отчёт капитана: тренировка по Inferno проведена 2026-08-29 (сессия 01, на день раньше плана).
- 00_context + 03_wiki/map-pool-2026 | Inferno помечена как отработанная карта; уточнено, что «единственная практиковавшаяся» — состояние на момент снимка.
- site/ | штаб отмечает Inferno готовой: ✓ в роадмапе и карточке сессии, плейбук Inferno в «done», очередь карт пересчитана (Mirage — главный приоритет), ближайшая тренировка теперь Mirage 02.09.


## 2026-08-31 — движок вето veto-1 и переработка скаутинг-дашборда

- DECISION: вето-вердикты считает движок veto-1 («цифры решают»); ручные pick/ban удалены из
  конфига, комфорт команды показывается как контекст и противоречие.
  [source: /05_decisions/veto-framework.md]
- scripts/whoajor | новый модуль lib/veto-model.mjs (+ тесты), датасеты teamMapStats и vetoAdvice,
  mapEdges ограничен пулом из 7 карт (без фабрикации edge при n=0), валидатор планов сверяет
  вердикт с движком; конфиги team-context.json и season-schedule.json.
- site/ | раздел «Статистика» пересобран answer-first: вердикт-панель, баннер «комфорт против
  цифр», вето-матрица 7 карт с зоной шума, дерево вето, карточки угроз без сырых evidence-ID,
  самоскаутинг `sopernik/us`; плейбук и вето-черновик приведены к вердиктам скаутинга (C3).
- 04_synthesis | contradictions C3 (три источника правды о вето, reconciled), open-questions Q6
  (порядок вето лиги), cs2-veto-strategy — секция про движок и расхождение моделей.
- 04_synthesis | зеркальный скаутинг «Как нас видят соперники»: наш профиль, векторы атаки на нас
  и вето их глазами; перевес в открытии раундов держится на одном игроке.
  [source: /03_wiki/metric-equivalent-team-matches.md]
- scripts/whoajor + site/ | датасет `mirrorScouting` (4 строки) и раздел «Как нас видят»: движок
  veto-1 антисимметричен, поэтому взгляд соперника — тот же скоринг с обратным знаком, а не вторая
  модель вето; инвариант закреплён в верификаторе и тестах.

