# Полный импорт stats.whoajor.com — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать полный проверяемый снимок публичного GET API stats.whoajor.com, построить из raw-ответов SQLite и подключить источник к KB.

**Architecture:** Последовательный HTTP-сборщик сохраняет каждый ответ content-addressed и ведёт manifest. Независимый валидатор доказывает полноту и целостность; нормализатор строит SQLite только из сохранённого raw, после чего генератор создаёт source summary и обновляет KB.

**Tech Stack:** Node.js 20–22, ESM, встроенные `fetch`/`node:test`/`node:crypto`, `better-sqlite3` 12.10.0, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-29-whoajor-full-import-design.md`

## Global Constraints

- Разрешение сообщества на полный импорт подтверждено пользователем 2026-08-29.
- Только публичные GET-запросы; `POST /api/matches/{id}/tags` и любые мутации запрещены.
- Сетевой обход последовательный: concurrency `1`, пауза по умолчанию `250 ms`, максимум `5` retry для `429/503/network error`.
- SteamID64 хранится только как `TEXT` и проверяется регулярным выражением `/^\d{17}$/`.
- `01_raw/**` неизменяем: новый успешный запуск создаёт новый snapshot, существующие raw-файлы не перезаписываются.
- Канонический источник — exact HTTP body + manifest SHA-256; SQLite всегда производна и пересобираема.
- Командная сыгранность не выводится автоматически из индивидуальных агрегатов.
- Публичный scope: meta, tags, draft, полный match index/details, leaderboard, все player views, weapons/details/time-series и weapon-splits.
- Комбинаторный перебор `tag × map × side × from × to` не выполняется; импортируются первичные сущности, unfiltered views и конечные `by=day` views.
- Любой пропуск, schema drift обязательного поля, duplicate PK, broken FK или изменение границы snapshot блокирует публикацию.
- После каждого завершённого коммита: `pnpm whoajor:test`, релевантные KB-гейты, затем `git push origin HEAD:main` без force-push.

## Карта файлов

- `scripts/whoajor/package.json` — зависимости и локальные команды пакета.
- `scripts/whoajor/config.mjs` — base URL, rate/retry defaults, contract version.
- `scripts/whoajor/lib/canonical-json.mjs` — deterministic JSON, SHA-256, request keys.
- `scripts/whoajor/lib/contract.mjs` — endpoint contract, required fields/types, query builders.
- `scripts/whoajor/lib/raw-store.mjs` — staging, response blobs, manifest, resume и root hash.
- `scripts/whoajor/lib/http-client.mjs` — GET-only client, pacing, retry/backoff.
- `scripts/whoajor/lib/discovery.mjs` — извлечение match ID, SteamID и weapons из raw.
- `scripts/whoajor/collect.mjs` — оркестрация полного API-обхода.
- `scripts/whoajor/lib/validation.mjs` — pure validation functions.
- `scripts/whoajor/validate.mjs` — CLI-обёртка и `validation-report.json`.
- `scripts/whoajor/schema.sql` — нормализованная SQLite-схема.
- `scripts/whoajor/lib/normalize.mjs` — raw → SQLite transactions.
- `scripts/whoajor/normalize.mjs` — CLI сборки БД.
- `scripts/whoajor/lib/summary.mjs` — counts/диапазоны/ограничения → Markdown.
- `scripts/whoajor/summarize.mjs` — CLI генерации source summary.
- `scripts/whoajor/sync.mjs` — collect → validate → normalize → publish → summarize.
- `scripts/whoajor/test/fixture-api.mjs` — маленький детерминированный fake API.
- `scripts/whoajor/test/*.test.mjs` — offline contract/regression/integration tests.
- `package.json` — корневые `whoajor:*` и расширенный `setup`.
- `.github/workflows/kb-ci.yml` — offline тесты/валидация опубликованного snapshot.
- `02_sources/2026-08-29-whoajor-full-snapshot.md` — итоговое саммари.
- `index.md`, `log.md`, при необходимости `04_synthesis/open-questions.md` и `04_synthesis/contradictions.md` — ingest workflow.

---

### Task 1: Пакет, контракт и канонические идентификаторы

**Files:**
- Create: `scripts/whoajor/package.json`
- Create: `scripts/whoajor/config.mjs`
- Create: `scripts/whoajor/lib/canonical-json.mjs`
- Create: `scripts/whoajor/lib/contract.mjs`
- Create: `scripts/whoajor/test/canonical-json.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `canonicalStringify(value): string`, `sha256Hex(data): string`, `normalizeQuery(entries): string`, `requestKey(path, query): string`, `CONTRACT`, `buildUrl(baseUrl, path, query): URL`.
- Consumes: только Node standard library.

- [ ] **Step 1: Написать failing tests канонизации и request key**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalStringify, normalizeQuery, requestKey, sha256Hex,
} from '../lib/canonical-json.mjs';

test('canonicalStringify сортирует object keys и сохраняет порядок arrays', () => {
  assert.equal(canonicalStringify({ z: 1, a: { d: 2, c: [3, 1] } }),
    '{"a":{"c":[3,1],"d":2},"z":1}');
});

test('requestKey не зависит от порядка query params', () => {
  assert.equal(normalizeQuery([['offset', '100'], ['limit', '50']]), 'limit=50&offset=100');
  assert.equal(requestKey('/api/matches', { offset: 100, limit: 50 }),
    'GET /api/matches?limit=50&offset=100');
});

test('sha256Hex воспроизводим', () => {
  assert.equal(sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
```

- [ ] **Step 2: Запустить тест и подтвердить ожидаемый fail**

Run: `node --test scripts/whoajor/test/canonical-json.test.mjs`

Expected: FAIL с `ERR_MODULE_NOT_FOUND` для `lib/canonical-json.mjs`.

- [ ] **Step 3: Реализовать canonical helpers и явный endpoint contract**

```js
// scripts/whoajor/lib/canonical-json.mjs
import { createHash } from 'node:crypto';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export const canonicalStringify = (value) => JSON.stringify(canonicalize(value));
export const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
export const normalizeQuery = (entries) => new URLSearchParams(
  [...entries].filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)]).sort(([a], [b]) => a.localeCompare(b)),
).toString();
export const requestKey = (path, query = {}) => {
  const normalized = normalizeQuery(Object.entries(query));
  return `GET ${path}${normalized ? `?${normalized}` : ''}`;
};
```

`contract.mjs` должен экспортировать frozen object с `version: '1.0.0'`, endpoint templates,
required keys и primary key functions. `buildUrl` обязан кодировать path ID через
`encodeURIComponent`, сортировать query и принимать только path, начинающийся с `/api/`.

- [ ] **Step 4: Добавить package/root scripts и установить lockfile**

```json
{
  "name": "whoajor-import",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test test/*.test.mjs" },
  "dependencies": { "better-sqlite3": "^12.10.0" }
}
```

В корневой `package.json` добавить `scripts/whoajor install` в `setup`, а также:

```json
"whoajor:test": "pnpm -C scripts/whoajor test",
"whoajor:collect": "node scripts/whoajor/collect.mjs",
"whoajor:validate": "node scripts/whoajor/validate.mjs",
"whoajor:build-db": "node scripts/whoajor/normalize.mjs",
"whoajor:sync": "node scripts/whoajor/sync.mjs"
```

Run: `pnpm -C scripts/whoajor install`

Expected: создаётся `scripts/whoajor/pnpm-lock.yaml`, dependency `better-sqlite3@12.10.0`.

- [ ] **Step 5: Запустить tests и проверки**

Run: `pnpm whoajor:test && git diff --check`

Expected: все tests PASS, diff-check clean.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/whoajor
git commit -m "Добавить контракт импорта whoajor"
```

---

### Task 2: Content-addressed raw store и manifest/resume

**Files:**
- Create: `scripts/whoajor/lib/raw-store.mjs`
- Create: `scripts/whoajor/test/raw-store.test.mjs`

**Interfaces:**
- Consumes: `canonicalStringify`, `requestKey`, `sha256Hex` из Task 1.
- Produces: `createSnapshot(root, metadata)`, `storeResponse(snapshot, responseRecord)`, `loadSnapshot(root)`, `computeRootHash(requests)`, `finalizeManifest(snapshot, status)`.

- [ ] **Step 1: Написать failing test raw store**

```js
test('storeResponse сохраняет exact body один раз и связывает его с request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'whoajor-'));
  const snapshot = await createSnapshot(root, { snapshotId: 'fixture', contractVersion: '1.0.0' });
  await storeResponse(snapshot, {
    path: '/api/meta', query: {}, status: 200,
    headers: { 'content-type': 'application/json' }, body: '{"matches":2}', durationMs: 12,
  });
  await storeResponse(snapshot, {
    path: '/api/meta', query: {}, status: 200,
    headers: { 'content-type': 'application/json' }, body: '{"matches":2}', durationMs: 8,
  });
  const manifest = await finalizeManifest(snapshot, 'complete');
  assert.equal(manifest.requests.length, 1);
  assert.equal(manifest.requests[0].bodySha256, sha256Hex('{"matches":2}'));
  assert.match(manifest.rootHash, /^[a-f0-9]{64}$/);
  assert.equal(await readFile(join(root, 'responses', `${manifest.requests[0].bodySha256}.json`), 'utf8'),
    '{"matches":2}');
});
```

Добавить tests: повторный request с другим body = hard error; truncated/changed blob не resume'ится;
root hash не зависит от `durationMs` и времени запуска.

- [ ] **Step 2: Запустить test и подтвердить fail**

Run: `node --test scripts/whoajor/test/raw-store.test.mjs`

Expected: FAIL с отсутствующим `raw-store.mjs`.

- [ ] **Step 3: Реализовать atomic manifest и content-addressed blobs**

Manifest request entry должен содержать ровно:

```js
{
  key, path, query, url, status, contentType, contentLength,
  observedHeaders, fetchedAt, durationMs, bodyBytes,
  bodySha256, canonicalSha256, itemCount, reportedTotal, blob,
}
```

Запись: temporary file рядом с target → `rename`; body blob именуется `<sha256>.json`.
Resume разрешён, только если manifest entry, файл, byte count и hash совпадают.
`computeRootHash` хеширует отсортированные строки `${key}\0${bodySha256}\n`.

- [ ] **Step 4: Запустить tests**

Run: `pnpm whoajor:test`

Expected: canonical/raw-store tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/whoajor/lib/raw-store.mjs scripts/whoajor/test/raw-store.test.mjs
git commit -m "Добавить проверяемое хранение raw-ответов"
```

---

### Task 3: GET-only HTTP client с pacing/retry

**Files:**
- Create: `scripts/whoajor/lib/http-client.mjs`
- Create: `scripts/whoajor/test/http-client.test.mjs`

**Interfaces:**
- Produces: `createHttpClient({ baseUrl, fetchImpl, delayMs, maxRetries, sleep, userAgent }).get(path, query): Promise<HttpRecord>`.
- `HttpRecord`: `{ path, query, url, status, headers, body, durationMs }`.

- [ ] **Step 1: Написать failing tests клиента**

```js
test('client запрещает не-API path и не имеет mutation methods', async () => {
  const client = createHttpClient({ baseUrl: 'https://stats.whoajor.com', fetchImpl: async () => null });
  await assert.rejects(client.get('/admin'), /only \/api\//);
  assert.equal(client.post, undefined);
});

test('client повторяет 429 по Retry-After и возвращает exact body', async () => {
  const calls = [];
  const responses = [
    new Response('{"error":"slow"}', { status: 429, headers: { 'Retry-After': '1' } }),
    new Response('{"matches":2}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ];
  const client = createHttpClient({
    baseUrl: 'https://stats.whoajor.com', delayMs: 0, maxRetries: 2,
    sleep: async (ms) => calls.push(ms), fetchImpl: async () => responses.shift(),
  });
  const result = await client.get('/api/meta');
  assert.equal(result.body, '{"matches":2}');
  assert.deepEqual(calls, [1000]);
});
```

Добавить tests: JSON content-type обязателен; 404 не retry; network error retry с bounded
backoff `[250,500,1000,2000,4000]`; между успешными запросами вызывается pacing sleep.

- [ ] **Step 2: Запустить tests и подтвердить fail**

Run: `node --test scripts/whoajor/test/http-client.test.mjs`

Expected: FAIL с отсутствующим `http-client.mjs`.

- [ ] **Step 3: Реализовать минимальный client**

Client делает только `fetch(url, { method: 'GET', headers: { accept: 'application/json',
user-agent: 'ushibu-nogami-whoajor-import/1.0' } })`, сохраняет observed response headers и
читает `response.text()` один раз. После исчерпания retry ошибка включает URL, status и число попыток,
но не теряет staging manifest.

- [ ] **Step 4: Запустить tests**

Run: `pnpm whoajor:test`

Expected: все tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/whoajor/lib/http-client.mjs scripts/whoajor/test/http-client.test.mjs
git commit -m "Добавить безопасный HTTP-клиент whoajor"
```

---

### Task 4: Полный collector и динамическое обнаружение сущностей

**Files:**
- Create: `scripts/whoajor/lib/discovery.mjs`
- Create: `scripts/whoajor/collect.mjs`
- Create: `scripts/whoajor/test/fixture-api.mjs`
- Create: `scripts/whoajor/test/collector.test.mjs`

**Interfaces:**
- Consumes: `CONTRACT`, `createHttpClient`, raw-store API.
- Produces: `collectSnapshot({ outputDir, client, now, pageSize }): Promise<Manifest>`;
  `discoverPlayers(payloads): string[]`, `discoverWeapons(payloads): string[]`.

- [ ] **Step 1: Создать точный fake API и failing integration test**

Fake fixture должен моделировать `meta.matches=2`, match pages `1+1`, два details, leaderboard
из трёх игроков, draft из одного игрока, два weapons и все player endpoints. Router обязан считать
каждый URL и падать на незапланированном endpoint.

```js
test('collector обходит все конечные сущности ровно один раз', async () => {
  const fixture = createFixtureApi();
  const manifest = await collectSnapshot({
    outputDir: await mkdtemp(join(tmpdir(), 'whoajor-collect-')),
    client: createHttpClient({ baseUrl: fixture.baseUrl, fetchImpl: fixture.fetch, delayMs: 0 }),
    now: () => new Date('2026-08-29T07:00:00Z'), pageSize: 1,
  });
  assert.equal(manifest.status, 'collected');
  assert.equal(manifest.sourceCounts.matches, 2);
  assert.deepEqual(manifest.discovered.players, [
    '76561198000000001', '76561198000000002', '76561198000000003',
  ]);
  assert.ok(manifest.requests.some((r) => r.key.includes('/api/players/76561198000000003/maps')));
  assert.ok(manifest.requests.some((r) => r.key.includes('/api/weapons/ak47?by=day')));
  fixture.assertNoUnexpectedCalls();
});
```

Добавить tests: overlap page dedup; `total` drift → `unstable`; `limit` на player matches не
используется; players берутся из leaderboard + draft + match details + round rosters; все ID
сортируются перед detail queue для воспроизводимости.

- [ ] **Step 2: Запустить collector test и подтвердить fail**

Run: `node --test scripts/whoajor/test/collector.test.mjs`

Expected: FAIL с отсутствующим collector/discovery.

- [ ] **Step 3: Реализовать очередь endpoint'ов**

Порядок запросов фиксирован:

```text
meta:start → tags → draft-config → matches pages → match details → leaderboard
→ player summary/maps/weapons/weapons?by=day/matches (sorted SteamID)
→ weapons → weapon detail/detail?by=day (sorted weapon) → weapon-splits
→ meta:end → matches head:end
```

Match index: `limit=100`, `offset=0,100,...`, overlap `1` между страницами, dedup по `id`.
Collector сохраняет every response до parsing. JSON parse/schema failure оставляет snapshot
`incomplete` и возвращает non-zero CLI exit.

CLI принимает:

```text
--output .context/whoajor-staging/2026-08-29T070000Z
--base-url https://stats.whoajor.com
--delay-ms 250
--page-size 100
--resume
```

- [ ] **Step 4: Запустить offline tests**

Run: `pnpm whoajor:test`

Expected: все tests PASS; fake router не видел POST или неизвестных URLs.

- [ ] **Step 5: Commit**

```bash
git add scripts/whoajor/collect.mjs scripts/whoajor/lib/discovery.mjs scripts/whoajor/test
git commit -m "Добавить полный сборщик whoajor"
```

---

### Task 5: Независимый snapshot validator

**Files:**
- Create: `scripts/whoajor/lib/validation.mjs`
- Create: `scripts/whoajor/validate.mjs`
- Create: `scripts/whoajor/test/validation.test.mjs`

**Interfaces:**
- Consumes: snapshot manifest/blobs, `CONTRACT`, discovery helpers.
- Produces: `validateSnapshot(dir): Promise<ValidationReport>`;
  report `{ status, checkedAt, errors, warnings, discrepancies, counts, rootHash }`.

- [ ] **Step 1: Написать failing validator tests**

```js
test('валидный fixture проходит и фиксирует неблокирующее расхождение карт', async () => {
  const dir = await buildCollectedFixture();
  const report = await validateSnapshot(dir);
  assert.equal(report.status, 'complete');
  assert.equal(report.errors.length, 0);
  assert.ok(report.discrepancies.some((x) => x.code === 'META_MAP_SUM_MISMATCH'));
});

test('missing detail, duplicate PK и broken FK блокируют snapshot', async () => {
  for (const mutate of [removeMatchDetail, duplicatePlayerRound, addUnknownRoundSteamid]) {
    const dir = await buildCollectedFixture();
    await mutate(dir);
    const report = await validateSnapshot(dir);
    assert.equal(report.status, 'incomplete');
    assert.ok(report.errors.length > 0);
  }
});
```

Добавить отдельные tests: missing page, inconsistent total, malformed SteamID, invalid body hash,
required-field schema drift, `(steamid,weapon)` duplicate, weapon aggregate mismatch, idempotent rerun.

- [ ] **Step 2: Запустить tests и подтвердить fail**

Run: `node --test scripts/whoajor/test/validation.test.mjs`

Expected: FAIL с отсутствующим validation module.

- [ ] **Step 3: Реализовать pure validators**

Hard errors:

```text
BODY_HASH_MISMATCH, ROOT_HASH_MISMATCH, REQUEST_MISSING, PAGE_GAP,
TOTAL_MISMATCH, MATCH_DETAIL_MISSING, DUPLICATE_PK, BROKEN_FK,
INVALID_STEAMID, REQUIRED_FIELD_MISSING, FIELD_TYPE_MISMATCH,
WEAPON_AGGREGATE_MISMATCH, SNAPSHOT_BOUNDARY_CHANGED
```

Documented discrepancies/warnings:

```text
META_MAP_SUM_MISMATCH, WINS_LOSSES_LT_MATCHES, UNKNOWN_FIELD,
INDEX_DETAIL_NAMING_DIFFERENCE, FILTER_PARAMETER_IGNORED
```

CLI всегда записывает `validation-report.json`; exit `0` только при `status=complete`, иначе `1`.

- [ ] **Step 4: Запустить tests**

Run: `pnpm whoajor:test`

Expected: все tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/whoajor/lib/validation.mjs scripts/whoajor/validate.mjs scripts/whoajor/test/validation.test.mjs
git commit -m "Добавить валидацию снимков whoajor"
```

---

### Task 6: Нормализованная SQLite и логический fingerprint

**Files:**
- Create: `scripts/whoajor/schema.sql`
- Create: `scripts/whoajor/lib/normalize.mjs`
- Create: `scripts/whoajor/normalize.mjs`
- Create: `scripts/whoajor/test/normalize.test.mjs`

**Interfaces:**
- Consumes: только snapshot со `validation-report.status === 'complete'`.
- Produces: `buildDatabase(snapshotDir, dbPath): Promise<{ counts, dataFingerprint }>`.

- [ ] **Step 1: Написать failing SQLite integration test**

```js
test('normalizer сохраняет сущности, FK и весь source_json', async () => {
  const snapshotDir = await buildValidatedFixture();
  const dbPath = join(snapshotDir, 'whoajor.sqlite');
  const first = await buildDatabase(snapshotDir, dbPath);
  const db = new Database(dbPath, { readonly: true });
  assert.equal(db.pragma('foreign_key_check').length, 0);
  assert.equal(db.prepare('select count(*) n from matches').get().n, 2);
  assert.equal(db.prepare('select count(*) n from match_rounds').get().n, 4);
  assert.equal(db.prepare('select typeof(steamid) t from players limit 1').get().t, 'text');
  assert.ok(JSON.parse(db.prepare('select source_json j from match_players limit 1').get().j));
  db.close();
  const secondPath = join(snapshotDir, 'whoajor-second.sqlite');
  const second = await buildDatabase(snapshotDir, secondPath);
  assert.equal(first.dataFingerprint, second.dataFingerprint);
});
```

- [ ] **Step 2: Запустить test и подтвердить fail**

Run: `node --test scripts/whoajor/test/normalize.test.mjs`

Expected: FAIL с отсутствующим normalize module/schema.

- [ ] **Step 3: Создать concrete schema**

Каждая таблица из spec создаётся `STRICT` где поддерживается, с `PRAGMA foreign_keys=ON`.
Метрики с широкой/изменчивой схемой хранятся в `metrics_json`; исходная API-строка всегда хранится
в `source_json`. Основные PK:

```sql
matches(match_id PRIMARY KEY);
match_rounds(PRIMARY KEY(match_id, round));
round_rosters(PRIMARY KEY(match_id, round, side, steamid));
match_players(PRIMARY KEY(match_id, steamid));
player_rounds(PRIMARY KEY(match_id, steamid, round));
player_side_stats(PRIMARY KEY(match_id, steamid, side));
player_clutches(PRIMARY KEY(match_id, steamid, round, start_tick));
match_player_weapons(PRIMARY KEY(match_id, steamid, weapon));
weapon_splits(PRIMARY KEY(snapshot_id, steamid, weapon));
leaderboard_snapshots(PRIMARY KEY(snapshot_id, query_fingerprint, steamid));
player_map_snapshots(PRIMARY KEY(snapshot_id, query_fingerprint, steamid, map));
```

Normalizer работает в одной transaction, удаляет неполный target при ошибке и завершает
`PRAGMA foreign_key_check`, `integrity_check`, counts comparison с validation report.
`dataFingerprint` — SHA-256 отсортированных canonical rows без operational timestamps.

- [ ] **Step 4: Запустить tests и SQLite checks**

Run: `pnpm whoajor:test`

Expected: tests PASS, `foreign_key_check` пуст, два builds имеют одинаковый logical fingerprint.

- [ ] **Step 5: Commit**

```bash
git add scripts/whoajor/schema.sql scripts/whoajor/lib/normalize.mjs scripts/whoajor/normalize.mjs scripts/whoajor/test/normalize.test.mjs
git commit -m "Добавить SQLite-базу whoajor"
```

---

### Task 7: Summary generator и безопасная публикация

**Files:**
- Create: `scripts/whoajor/lib/summary.mjs`
- Create: `scripts/whoajor/summarize.mjs`
- Create: `scripts/whoajor/sync.mjs`
- Create: `scripts/whoajor/test/summary.test.mjs`
- Create: `scripts/whoajor/test/sync.test.mjs`

**Interfaces:**
- Consumes: validated staging snapshot и SQLite result.
- Produces: `renderSourceSummary(input): string`, `publishSnapshot(stagingDir, rawDir)`, end-to-end `sync()`.

- [ ] **Step 1: Написать failing tests summary/publish**

```js
test('summary содержит provenance, counts, root hash и методологическое ограничение', () => {
  const markdown = renderSourceSummary(fixtureSummaryInput());
  assert.match(markdown, /^---\ntype: source/m);
  assert.match(markdown, /root hash: `[a-f0-9]{64}`/);
  assert.match(markdown, /матчей: 2/);
  assert.match(markdown, /SteamID.*строкой/);
  assert.match(markdown, /не доказывает сыгранность/);
});

test('publish запрещён для incomplete snapshot и не перезаписывает raw', async () => {
  await assert.rejects(publishSnapshot(incompleteDir, rawDir), /status complete/);
  await assert.rejects(publishSnapshot(completeDir, existingRawDir), /already exists/);
});
```

- [ ] **Step 2: Запустить tests и подтвердить fail**

Run: `node --test scripts/whoajor/test/summary.test.mjs scripts/whoajor/test/sync.test.mjs`

Expected: FAIL с отсутствующими modules.

- [ ] **Step 3: Реализовать генератор и transaction-like publish**

`sync.mjs` выполняет строго:

```js
await collectSnapshot(options);
const report = await validateSnapshot(stagingDir);
if (report.status !== 'complete') throw new Error('snapshot is not complete');
await buildDatabase(stagingDir, join(stagingDir, 'whoajor.sqlite'));
await writeFile(join(stagingDir, 'source-summary.md'), renderSourceSummary(input));
await publishSnapshot(stagingDir, rawTarget); // rename только после всех checks
```

Summary frontmatter: `type`, `title`, `date`, `raw`, `source`, `confidence`, `tags`; текст различает
FACT source counts, INFERENCE и UNKNOWN, содержит ссылку на raw manifest и документирует все
`source_discrepancies` без сглаживания.

- [ ] **Step 4: Запустить tests**

Run: `pnpm whoajor:test`

Expected: все tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/whoajor/lib/summary.mjs scripts/whoajor/summarize.mjs scripts/whoajor/sync.mjs scripts/whoajor/test
git commit -m "Добавить публикацию полного снимка whoajor"
```

---

### Task 8: Live collection, независимая проверка и разрешение source discrepancies

**Files:**
- Create: `.context/whoajor-staging/2026-08-29-full/` (temporary, gitignored)
- Create after success: `01_raw/whoajor/2026-08-29-full-snapshot/`
- Modify as tests expose real schema: only `scripts/whoajor/lib/contract.mjs`, validation/normalization code and their tests.

**Interfaces:**
- Consumes: completed offline-tested pipeline.
- Produces: published raw snapshot, manifest, validation report, SQLite and exact observed counts.

- [ ] **Step 1: Запустить preflight на immutable endpoints**

Run:

```bash
pnpm whoajor:collect -- --output .context/whoajor-staging/2026-08-29-full --delay-ms 250 --page-size 100
```

Expected: последовательный GET-only run; manifest status `collected`; ориентир `matches=368`,
players `>=81`, weapons `39`. Точные acceptance counts берутся из start/end meta, не из ориентира.

- [ ] **Step 2: Валидировать raw до SQLite**

Run:

```bash
pnpm whoajor:validate -- .context/whoajor-staging/2026-08-29-full
```

Expected: exit `0`, `status=complete`, `errors=[]`; расхождение `META_MAP_SUM_MISMATCH` сохранено.

Если найден реальный schema drift или неверный инвариант: добавить минимальную raw fixture,
написать failing regression test, исправить contract/validator и перезапустить только после PASS.
Нельзя менять raw body либо ослаблять invariant без зафиксированного evidence.

- [ ] **Step 3: Построить БД и провести независимые SQL-сверки**

Run:

```bash
pnpm whoajor:build-db -- .context/whoajor-staging/2026-08-29-full
sqlite3 .context/whoajor-staging/2026-08-29-full/whoajor.sqlite 'pragma integrity_check; pragma foreign_key_check;'
sqlite3 -header -column .context/whoajor-staging/2026-08-29-full/whoajor.sqlite \
  'select (select count(*) from matches) matches, (select count(*) from players) players, (select count(*) from match_rounds) rounds;'
```

Expected: `integrity_check=ok`, foreign key output пуст, match count равен meta/index/details.

- [ ] **Step 4: Независимая hash/sampling сверка**

Детерминированно выбрать первые/последние match ID и ещё `max(30, ceil(entityCount*0.01))`
сущностей по `sha256(snapshotId + entityId)`. Повторно запросить только выбранные разрешённые GET
и сравнить canonical hashes. Любое несовпадение = `unstable`, новый snapshot run.

- [ ] **Step 5: Опубликовать snapshot**

Run:

```bash
node scripts/whoajor/sync.mjs --publish-existing .context/whoajor-staging/2026-08-29-full
```

Expected: создан `01_raw/whoajor/2026-08-29-full-snapshot/`; staging не является каноническим;
старый raw JSON не изменён.

- [ ] **Step 6: Проверить размер SQLite до git add**

Run: `du -h 01_raw/whoajor/2026-08-29-full-snapshot/whoajor.sqlite`

Expected: если файл `<90 MiB`, коммитить как есть; иначе создать deterministic gzip (`mtime=0`),
проверить распаковку/hash, удалить только производный `.sqlite` из коммитимого snapshot и оставить
raw responses + `.sqlite.gz`. Ни один raw response не удалять.

- [ ] **Step 7: Commit raw snapshot и pipeline fixes**

```bash
git add scripts/whoajor 01_raw/whoajor/2026-08-29-full-snapshot
git commit -m "Импортировать полный снимок whoajor"
```

---

### Task 9: Интеграция в KB, CI и финальная верификация

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/kb-ci.yml`
- Create: `02_sources/2026-08-29-whoajor-full-snapshot.md`
- Modify: `index.md`
- Modify: `log.md`
- Modify if evidence changed: `04_synthesis/open-questions.md`
- Modify if conflicts found: `04_synthesis/contradictions.md`
- Modify if existing conclusions changed: relevant `03_wiki/*.md`, `04_synthesis/*.md`

**Interfaces:**
- Consumes: published snapshot + generated source summary.
- Produces: searchable/cited KB layer and blocking CI validation.

- [ ] **Step 1: Добавить failing CI/offline published-snapshot test**

Добавить test, который находит все `01_raw/whoajor/*/manifest.json`, запускает validator без сети и
падает при missing blob/hash/count. Run локально до CI change:

```bash
node scripts/whoajor/test/published-snapshot.test.mjs
```

Expected before implementation: FAIL, test file/module отсутствует.

- [ ] **Step 2: Реализовать published snapshot test и CI step**

В `.github/workflows/kb-ci.yml` перед `kb-doctor` добавить:

```yaml
- name: Validate whoajor snapshots
  run: |
    pnpm -C scripts/whoajor install --frozen-lockfile
    pnpm whoajor:test
    node scripts/whoajor/test/published-snapshot.test.mjs
```

- [ ] **Step 3: Перенести generated summary и выполнить ingest workflow**

Source summary обязан содержать FACT-утверждения с exact counts, min/max timestamps, request count,
raw/canonical/root hashes, SQLite counts и известные discrepancies. Добавить ссылку в `index.md` и
строку ingest в `log.md`. Просмотреть open questions/contradictions и менять их только при прямом
evidence из нового source summary.

- [ ] **Step 4: Полный offline test suite**

Run:

```bash
pnpm whoajor:test
pnpm kb:doctor
node scripts/semantic/verify.mjs --scan --provenance --no-semantic
node scripts/semantic/test-gate.mjs
pnpm kb:index
pnpm kb:eval
```

Expected: все команды exit `0`; doctor без замечаний; verify clean; retrieval не хуже baseline.

- [ ] **Step 5: Финальный manual audit**

Run:

```bash
git diff --check
git status --short
jq '{status, rootHash, counts: .sourceCounts}' 01_raw/whoajor/2026-08-29-full-snapshot/manifest.json
sqlite3 -header -column 01_raw/whoajor/2026-08-29-full-snapshot/whoajor.sqlite \
  'select count(*) matches from matches; select count(*) players from players;'
```

Expected: только ожидаемые изменения; manifest complete; counts совпадают с summary/SQLite.
Если SQLite сохранён как gzip, распаковать во временный каталог и выполнить те же запросы там.

- [ ] **Step 6: Commit и push**

```bash
git add .github/workflows/kb-ci.yml package.json 02_sources index.md log.md 03_wiki 04_synthesis scripts/whoajor
git commit -m "Подключить полный whoajor к базе знаний"
git push origin HEAD:main
```

- [ ] **Step 7: Дать пользователю проверяемое резюме на русском**

Сообщить без технического жаргона:

1. сколько матчей, игроков, раундов и записей оружия перенесено;
2. что все матчи имеют detail и прошли сверку;
3. как открыть viewer/summary и какой SQL/curl выполнить при отсутствии UI-пути;
4. какие source discrepancies/UNKNOWN остались и почему они не означают потерю данных.
