# Cross-model parity для Claude Code и Codex

Статус: review
Дата: 2026-08-29

## Цель

DECISION: Основной интерактивный workflow репозитория должен давать Claude Code/Opus и
Codex/GPT один нормативный контекст, одинаковый набор локальных KB-инструментов, одинаковую
раннюю обратную связь после записи и одинаковые финальные гейты. [source: /AGENTS.md]

DECISION: «Одинаково» означает совпадение контрактов и критериев приёмки, а не дословное
совпадение ответов двух моделей. Проверяется допустимость результата, а не стиль текста.
[source: /docs/architecture.md]

## Область изменений

В реализацию входят:

1. единый нормативный файл инструкций;
2. Claude- и Codex-адаптеры для MCP и lifecycle hooks;
3. общие project skills для ключевых KB-процессов;
4. воспроизводимый bootstrap Conductor-workspace;
5. единая команда deterministic checks;
6. автоматическая проверка конфигурационного паритета;
7. документация ручного smoke-теста на обеих моделях.

Не входят:

- побуквенное сравнение ответов моделей;
- автоматический вызов платных Claude/OpenAI API;
- переписывание `think --execute`, critic и dream-cycle: эти standalone-команды остаются
  явно provider-specific и не входят в интерактивный Conductor-контракт;
- наполнение KB реальными продуктовыми источниками;
- семантическое доказательство истинности каждого `FACT` поверх существующего provenance-гейта.

## 1. Единый нормативный контракт

DECISION: `AGENTS.md` становится единственным source of truth для поведения любого агента.
В него переносятся язык, Git/worktree policy, правила артефактов, обязательные проверки и карта
host adapters. [source: /AGENTS.md] [source: /CLAUDE.md]

DECISION: `CLAUDE.md` становится тонким адаптером и начинается с `@AGENTS.md`; в нём остаются
только особенности Claude Code — permissions, hooks и команды доверия. [source: /CLAUDE.md]

DECISION: `.remember/core.md` хранит только устойчивый семантический контекст проекта и ссылки
на `AGENTS.md`; поведенческие правила в нём не дублируются. [source: /.remember/core.md]

DECISION: Агент работает в текущей workspace-ветке, не переименовывает её и не пушит напрямую
в `main` без явной команды пользователя. Force-push в `main` запрещён. После фактического push
в `main` агент всегда даёт краткое русское резюме «что сделано» и пошаговое «как проверить».
[source: /CLAUDE.md]

DECISION: Для содержательных вопросов сначала читаются `index.md`, `00_context` и active open
questions; большой `README.md` обязателен только для вопросов об устройстве/запуске харнесса.
Релевантное знание дальше находится через `kb_search`; это уменьшает дублирование контекста в
`kb_think`. [source: /index.md] [source: /04_synthesis/open-questions.md]

## 2. MCP как host adapters одного manifest

DECISION: Каноническое описание локальных MCP-серверов хранится в
`agent-config/mcp-servers.json`. Оно содержит имя, command, args и человекочитаемое описание
каждого сервера. [source: /.mcp.json]

DECISION: `scripts/agent/sync-config.mjs` детерминированно рендерит из manifest:

- `.mcp.json` для Claude Code;
- `.codex/config.toml` для Codex.

Режим `--check` ничего не пишет и завершает работу с ошибкой при drift. Режим `--write` обновляет
оба адаптера. Проверка входит в `pnpm agent:check` и CI.

DECISION: Оба MCP запускаются из Git root через POSIX shell wrapper, поэтому одинаково работают
при старте агента из корня или вложенного каталога на macOS/Linux. Conductor поддерживает эти две
среды; Windows не является целевой платформой этой спецификации.

DECISION: Project MCP и hooks требуют доверия со стороны клиента. README описывает одноразовую
проверку: Claude — approve project MCP, Codex — trust `.codex` layer и `/hooks`, затем проверить
список инструментов.

## 3. Одинаковые lifecycle hooks

DECISION: Claude и Codex запускают один `scripts/session-start-context.mjs` на SessionStart.
Скрипт остаётся read-only и добавляет branch/status/diffstat/working-memory context. [source:
/scripts/session-start-context.mjs]

DECISION: После Write/Edit/MultiEdit/apply_patch оба клиента запускают один
`scripts/agent/write-guard.mjs` как `PostToolUse`. Скрипт:

1. читает JSON event из stdin;
2. извлекает затронутые пути из Claude `file_path` либо Codex apply-patch command;
3. читает итоговое содержимое файла с диска;
4. прогоняет существующие dependency-free validators через нормализованный Write payload;
5. при нарушении пишет объединённую причину в stderr и выходит с кодом 2.

FACT: PostToolUse не откатывает уже выполненную запись, поэтому окончательным enforcement boundary
остаются `pnpm kb:check`, pre-push и CI. [source: /scripts/git-hooks/pre-push]

DECISION: Три Claude-only `PreToolUse` entries заменяются общим PostToolUse guard, чтобы момент и
правила обратной связи совпадали у двух клиентов. Validators остаются отдельными небольшими
скриптами и продолжают быть единственным источником соответствующих правил. [source:
/.claude/settings.json] [source: /scripts/check-provenance.mjs]

## 4. Общие skills

DECISION: Три provider-neutral процесса становятся нативными skills обоих клиентов:

- `skills/kb-ingest/SKILL.md`;
- `skills/decision-log/SKILL.md`;
- `skills/interviewer-agent/SKILL.md`.

DECISION: `.claude/skills/<name>` и `.agents/skills/<name>` являются относительными symlink на
одни и те же canonical skill directories. Это допустимо для целевых macOS/Linux сред и исключает
расхождение копий.

DECISION: `claude-api`, upstream `mcp-builder` и upstream `skill-creator` остаются Claude-specific
расширениями и явно исключаются из parity contract. Их наличие не меняет обязательные KB-инварианты.
[source: /.claude/skills/README.md]

## 5. Conductor bootstrap и параллельный запуск

DECISION: `.conductor/settings.toml` содержит versioned setup для каждого нового workspace:

1. запуск pnpm через `corepack pnpm` без записи global symlink;
2. frozen-lockfile install трёх подпакетов;
3. построение локального semantic index;
4. `git config core.hooksPath scripts/git-hooks`.

DECISION: Conductor run mode — `concurrent`. Viewer получает backend port из `CONDUCTOR_PORT`, а
frontend — следующий выделенный порт; run-script доступен только в local workspace. Общий check
run-script доступен в local и cloud.

DECISION: Viewer также понимает `CONDUCTOR_PORT` напрямую, сохраняя `VIEWER_PORT`/`VITE_PORT` как
явные overrides и 3001/5173 как fallback вне Conductor. [source: /tools/viewer/server.ts]

DECISION: `.gitignore` исключает `.env*`, кроме явно коммитимого `.env.example`; это безопасно при
стандартном Files-to-copy поведении Conductor. [source: /.gitignore]

## 6. Общие checks и acceptance criteria

DECISION: `pnpm agent:check` проверяет без сети:

- generated MCP adapters не расходятся с manifest;
- Claude импортирует `AGENTS.md`;
- оба hooks-файла вызывают одинаковые session/write scripts;
- общие skills существуют у обоих клиентов и резолвятся в один canonical файл;
- Conductor setup и port mapping присутствуют;
- опасное правило автоматического `git push origin HEAD:main` не осталось в active instructions.

DECISION: `pnpm kb:check` запускает `agent:check`, `kb-doctor`, offline control/retrieval/gate tests
и deterministic citation/provenance scan. Эта же команда используется pre-push и CI; индекс и
retrieval eval остаются отдельными более тяжёлыми CI-шагами. [source: /.github/workflows/kb-ci.yml]

DECISION: Автоматические тесты покрывают renderer, drift detection, разбор Claude/Codex hook
events, успешную проверку валидного файла и блокировку невалидной decision-карточки. Новые функции
разрабатываются по red-green-refactor.

## 7. Ручная проверка двух моделей

README получает одинаковый smoke-сценарий для свежих Claude и Codex workspace:

1. setup завершён, semantic index существует;
2. клиент доверяет project config/hooks;
3. оба клиента видят `kb-local` и `skillopt-local`;
4. оба вызывают `kb_search` на одном запросе;
5. оба получают feedback на одну и ту же невалидную decision fixture;
6. `pnpm kb:check` проходит после исправления;
7. ни один клиент не пушит в `main` без явной команды.

## Error handling и безопасность

DECISION: Config generator валидирует типы, уникальность имён и непустые command/args до записи;
при ошибке существующие adapters не перезаписываются.

DECISION: Write guard игнорирует отсутствующие после удаления файлы и пути вне Git root, не читает
`.env*`, ограничивается Markdown/YAML KB-артефактами и fail-open журналирует malformed hook payload.

DECISION: Config и hook trust остаются явным действием пользователя: репозиторий не пытается
обходить approval/sandbox механизмы клиентов.

## Критерий готовности

Работа готова, когда:

- unit/contract tests демонстрируют red-green цикл и проходят;
- `pnpm agent:check` и `pnpm kb:check` завершаются с exit 0;
- viewer build проходит;
- `kb-doctor` не показывает новых ошибок;
- `git diff --check` проходит;
- независимый code review не содержит Critical/Important замечаний;
- в отчёте явно отделена автоматическая проверка от ручного runtime smoke, если запуск второй
  модели требует отдельной интерактивной сессии или approval.
