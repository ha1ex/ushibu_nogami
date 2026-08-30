# Index — карта KB

> Этот файл — навигационная карта проекта. Обновляется по мере роста KB.
> При добавлении нового артефакта — добавьте ссылку сюда (это шаг 8 из ingest workflow в AGENTS.md).

## Контекст

- [Контекст проекта](./00_context/product.md) — команда, расписание, пул карт, ограничения данных
- [Semantic invariant](./.remember/core.md) — цель, контекст, hard rules

## Источники

- [Все source summaries](./02_sources/)
- [Снимок whoajor 2026-08-29](./02_sources/2026-08-29-cs2-whoajor-intelligence.md) — статистика пяти составов CS2
- [Тренировка Inferno 2026-08-29](./02_sources/2026-08-29-inferno-training-report.md) — сессия 01 проведена, что осталось неизвестным

## Wiki (концепты)

- [Все wiki-страницы](./03_wiki/)
- [Соперники группы](./03_wiki/opponents.md) — профили четырёх составов
- [Пул карт 2026](./03_wiki/map-pool-2026.md) — голосование, сила, сравнительный сигнал
- [Раскол T / CT](./03_wiki/t-ct-split.md) — общая болезнь всех пяти составов
- [`estimated_strength`](./03_wiki/metric-estimated-strength.md) — покартовая оценка силы
- [`equivalent_team_matches`](./03_wiki/metric-equivalent-team-matches.md) — почему это не «сыгранные вместе матчи»

## Synthesis

- [Диагностика «Ушибу ногами»](./04_synthesis/cs2-team-diagnostics.md) — сильные стороны и системные провалы
- [Стратегия вето](./04_synthesis/cs2-veto-strategy.md) — какие карты держать, какие банить
- [Планы на четыре матча](./04_synthesis/cs2-opponent-plans.md) — пик, бан, что эксплуатируем
- [Open questions](./04_synthesis/open-questions.md) — известные пробелы, требующие закрытия
- [Contradictions](./04_synthesis/contradictions.md) — конфликты в источниках, зафиксированные дословно

## Decisions

- [Все принятые решения](./05_decisions/)

## Outputs

- [Финальные артефакты](./06_outputs/)
- [Каталог базовых MCP — 12 серверов](./06_outputs/mcp-catalog/_index.md)
- [CHANGELOG](./CHANGELOG.md)

---

## Оснастка (harness)

- [Карта архитектуры харнесса](./docs/architecture.md) — ортогональные измерения и петля Compose → Adapt → Evolve

## Журнал

См. [`log.md`](./log.md) — хронология ingest-операций и больших правок.
