# Shared project skills

Скиллы здесь — канонические provider-neutral процедуры. Claude Code видит те же каталоги через
`.claude/skills/<name>`, Codex — через `.agents/skills/<name>`; оба host roots содержат относительные
symlink на этот каталог, поэтому копии процедур не расходятся.

## Формат

Каждый скилл находится в отдельном каталоге `skills/<name>/SKILL.md` с native frontmatter:

```yaml
---
name: имя
description: Естественное описание назначения и условий применения скилла.
triggers:
  phrases: ["короткая фраза", "ещё одна"]
  files: ["паттерны файлов"]
  events: ["события"]
inputs: какие артефакты читает
outputs: какие артефакты создаёт
---
```

## Текущие скиллы

- [`kb-ingest`](./kb-ingest/SKILL.md) — обработка нового артефакта по ingest workflow из AGENTS.md.
- [`decision-log`](./decision-log/SKILL.md) — добавление решения с rationale и evidence.
- [`interviewer-agent`](./interviewer-agent/SKILL.md) — последовательный сбор неявного контекста.

## Как добавлять

1. Создайте `skills/<name>/SKILL.md` с frontmatter (см. формат выше).
2. Опишите процедуру явными шагами — агенты будут следовать им буквально.
3. Добавьте относительные symlink в `.claude/skills/<name>` и `.agents/skills/<name>`.
4. Добавьте ссылку на скилл в этот README.
5. Запустите `corepack pnpm agent:check`, чтобы проверить identity host adapters и canonical файла.
