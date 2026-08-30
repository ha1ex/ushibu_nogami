---
type: decision
status: approved
date: 2026-08-30
owner: владелец задачи
confidence: high
tags: [whoajor, collection, authorization, scope]
related:
  - /02_sources/2026-08-30-whoajor-full-snapshot.md
  - /00_context/product.md
---

# Граница сбора данных Whoajor

DECISION: Полный импорт Whoajor от 2026-08-30 разрешён как однократный сбор; регулярный,
периодический или повторный обход требует нового явного решения владельца сообщества.
[source: /02_sources/2026-08-30-whoajor-full-snapshot.md]

## Контекст и rationale

FACT: Завершённый однократный импорт сохранил канонический v2-снимок с 864 GET-ответами и
проверенную SQLite с 29 таблицами; предшествующий v1 без trends оставлен как superseded history.
[source: /02_sources/2026-08-30-whoajor-full-snapshot.md]

ASSUMPTION: Отсутствие отдельного разрешения на регулярный сбор не трактуется как такое разрешение.

RISK: Автоматизация повторного обхода без нового решения расширила бы частоту и объём запросов
за пределы проверенного снимка. [source: /02_sources/2026-08-30-whoajor-full-snapshot.md]

## Альтернатива

DECISION: Не считать разрешение на один полный импорт бессрочным разрешением на фоновые обновления.
[source: /02_sources/2026-08-30-whoajor-full-snapshot.md]

## Критерии соблюдения и реверс-план

- FACT: В текущем scope каноническим является полный снимок `2026-08-30-full-v2-snapshot`;
  `2026-08-30-full-snapshot` сохранён только как superseded historical evidence без trends.
  [source: /02_sources/2026-08-30-whoajor-full-snapshot.md]
- DECISION: Следующий сетевой сбор допустим только после нового явного решения владельца сообщества;
  такое решение заменит эту границу scope.
  [source: /02_sources/2026-08-30-whoajor-full-snapshot.md]
