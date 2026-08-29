# Cross-model Agent Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать основной Conductor-workflow одинаково оснащённым и одинаково проверяемым для Claude Code/Opus и Codex/GPT.

**Architecture:** `AGENTS.md` задаёт единый контракт, а Claude/Codex получают тонкие host adapters. MCP-конфиги генерируются из одного manifest; lifecycle hooks вызывают один dependency-free write guard; общие skills физически едины через symlink; `pnpm kb:check` является общей deterministic границей.

**Tech Stack:** Node.js 20/22 ESM, `node:test`, JSON/TOML adapters, Claude Code hooks, Codex hooks, Conductor TOML, pnpm 9.15.0.

**Spec:** `docs/superpowers/specs/2026-08-29-cross-model-agent-parity-design.md`

## Global Constraints

- `AGENTS.md` — единственный нормативный контракт; `CLAUDE.md` начинается с `@AGENTS.md`.
- Агент остаётся на текущей workspace-ветке; прямой push в `main` только по явной команде; force-push запрещён.
- После любого фактического push в `main` ответ на русском содержит «Что сделано» и «Как проверить».
- Оба MCP adapter файла генерируются из `agent-config/mcp-servers.json` и запускают процессы из Git root.
- Claude и Codex используют один SessionStart script и один PostToolUse write guard.
- Canonical shared skills: `kb-ingest`, `decision-log`, `interviewer-agent`; target platforms — macOS/Linux.
- Conductor вызывает pnpm через `corepack pnpm` без global symlink, использует frozen lockfiles,
  строит semantic index и запускает viewer на выделенных портах.
- Новые функции разрабатываются TDD: RED должен быть зафиксирован до production implementation.
- Изменения не пушатся и не публикуются автоматически.

---

### Task 1: Canonical MCP manifest и generated adapters

**Files:**
- Create: `agent-config/mcp-servers.json`
- Create: `scripts/agent/config.mjs`
- Create: `scripts/agent/sync-config.mjs`
- Create: `scripts/agent/test-config.mjs`
- Create: `.codex/config.toml`
- Modify: `.mcp.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `validateManifest(value)`, `renderClaudeConfig(manifest)`, `renderCodexConfig(manifest)`, `syncConfigs({ root, write })`.
- Produces CLI: `node scripts/agent/sync-config.mjs --check|--write`.
- Later tasks consume `pnpm agent:sync` and the generated `.codex/config.toml`.

- [ ] **Step 1: Write the failing renderer tests**

Create `scripts/agent/test-config.mjs` with `node:test`. Use a literal fixture with one server and assert literal consumer outputs:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateManifest,
  renderClaudeConfig,
  renderCodexConfig,
  syncConfigs,
} from './config.mjs';

const fixture = {
  version: 1,
  servers: [{
    name: 'kb-local',
    command: 'sh',
    args: ['-lc', 'cd "$(git rev-parse --show-toplevel)" && exec node scripts/semantic/mcp-server.mjs'],
    description: 'KB tools',
  }],
};

test('renders a Claude project MCP map', () => {
  assert.equal(renderClaudeConfig(fixture), '{\n  "mcpServers": {\n    "kb-local": {\n      "command": "sh",\n      "args": [\n        "-lc",\n        "cd \\"$(git rev-parse --show-toplevel)\\" && exec node scripts/semantic/mcp-server.mjs"\n      ],\n      "description": "KB tools"\n    }\n  }\n}\n');
});

test('renders a Codex project MCP table', () => {
  assert.equal(renderCodexConfig(fixture), '# Generated from agent-config/mcp-servers.json. Do not edit.\n\n[mcp_servers.kb-local]\ncommand = "sh"\nargs = ["-lc", "cd \\"$(git rev-parse --show-toplevel)\\" && exec node scripts/semantic/mcp-server.mjs"]\nstartup_timeout_sec = 30\ntool_timeout_sec = 120\n');
});

test('rejects duplicate server names before writing', () => {
  assert.throws(() => validateManifest({ version: 1, servers: [fixture.servers[0], fixture.servers[0]] }), /duplicate.*kb-local/i);
});

test('check mode reports adapter drift without overwriting it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-config-'));
  await mkdir(join(root, 'agent-config'), { recursive: true });
  await mkdir(join(root, '.codex'), { recursive: true });
  await writeFile(join(root, 'agent-config/mcp-servers.json'), JSON.stringify(fixture));
  await writeFile(join(root, '.mcp.json'), 'stale\n');
  await writeFile(join(root, '.codex/config.toml'), 'stale\n');
  const result = await syncConfigs({ root, write: false });
  assert.deepEqual(result.drift, ['.mcp.json', '.codex/config.toml']);
  assert.equal(await readFile(join(root, '.mcp.json'), 'utf8'), 'stale\n');
});
```

- [ ] **Step 2: Run RED**

Run: `node --test scripts/agent/test-config.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/agent/config.mjs`.

- [ ] **Step 3: Implement the manifest library and CLI**

`config.mjs` validates plain objects, `version === 1`, non-empty unique names, command, args array of non-empty strings and description. TOML strings use a local `tomlString(value) => JSON.stringify(value)` encoder. `syncConfigs` reads the manifest, computes both expected strings, compares before any write, and only writes after successful validation.

`sync-config.mjs` accepts exactly one of `--check` or `--write`, resolves Git root through `git rev-parse --show-toplevel`, prints changed/drifted paths, exits 1 on drift in check mode and 2 on invalid usage/config.

`agent-config/mcp-servers.json` contains `kb-local` and `skillopt-local`; both use `sh -lc` with `cd "$(git rev-parse --show-toplevel)" && exec node <server-path>`.

- [ ] **Step 4: Generate adapters and verify GREEN**

Run:

```bash
node scripts/agent/sync-config.mjs --write
node --test scripts/agent/test-config.mjs
node scripts/agent/sync-config.mjs --check
```

Expected: all tests PASS; check reports both adapters synchronized.

- [ ] **Step 5: Add package commands and commit**

Add:

```json
"agent:sync": "node scripts/agent/sync-config.mjs --write",
"agent:check": "node scripts/agent/sync-config.mjs --check"
```

Commit: `Унифицировать MCP-конфигурацию агентов`.

---

### Task 2: Shared write guard и lifecycle hooks

**Files:**
- Create: `scripts/agent/write-guard-lib.mjs`
- Create: `scripts/agent/write-guard.mjs`
- Create: `scripts/agent/test-write-guard.mjs`
- Create: `.codex/hooks.json`
- Modify: `.claude/settings.json`

**Interfaces:**
- Consumes: existing `scripts/check-decisions.mjs`, `check-md-frontmatter.mjs`, `check-provenance.mjs`.
- Produces: `extractChangedPaths(event, { cwd, root })`, `validateWrittenPaths(paths, { root })`.
- Both host hook configs call `scripts/agent/write-guard.mjs` after file edits.

- [ ] **Step 1: Write failing event-normalization tests**

Create tests asserting:

```js
test('extracts Claude Write file_path', () => {
  assert.deepEqual(extractChangedPaths({ tool_name: 'Write', tool_input: { file_path: '/repo/04_synthesis/a.md' } }, { cwd: '/repo', root: '/repo' }), ['/repo/04_synthesis/a.md']);
});

test('extracts every Codex apply_patch path', () => {
  const command = '*** Begin Patch\n*** Update File: 04_synthesis/a.md\n*** Move to: 04_synthesis/b.md\n*** Add File: 05_decisions/c.md\n*** End Patch';
  assert.deepEqual(extractChangedPaths({ tool_name: 'apply_patch', tool_input: { command } }, { cwd: '/repo', root: '/repo' }), ['/repo/04_synthesis/a.md', '/repo/04_synthesis/b.md', '/repo/05_decisions/c.md']);
});

test('drops env and outside-root paths', () => {
  const command = '*** Begin Patch\n*** Add File: .env.local\n*** Add File: ../outside.md\n*** End Patch';
  assert.deepEqual(extractChangedPaths({ tool_name: 'apply_patch', tool_input: { command } }, { cwd: '/repo', root: '/repo' }), []);
});
```

Add an integration test that creates an invalid `05_decisions/x.md`, calls `validateWrittenPaths`, and asserts `{ passed: false }` with `DECISION:` in diagnostics. Add a valid decision containing `DECISION:` and `[source: /02_sources/x.md]` and assert pass.

- [ ] **Step 2: Run RED**

Run: `node --test scripts/agent/test-write-guard.mjs`
Expected: FAIL because `write-guard-lib.mjs` does not exist.

- [ ] **Step 3: Implement normalization and validation**

`extractChangedPaths` accepts Claude `file_path` and Codex patch headers `Update File`, `Add File`, `Delete File`, `Move to`; resolves relative paths against event `cwd`; deduplicates; rejects paths outside root, `.env*`, non-Markdown and YAML outside `skills/*/evals`.

`validateWrittenPaths` skips deleted files, verifies realpath remains inside root, reads content, then runs all three existing validators with this stdin payload:

```json
{"tool_name":"Write","tool_input":{"file_path":"/absolute/path.md","content":"final file text"}}
```

Aggregate exit-2 diagnostics. Malformed event JSON is fail-open and journaled. CLI exits 2 with stderr when any validator rejects.

- [ ] **Step 4: Run GREEN**

Run: `node --test scripts/agent/test-write-guard.mjs`
Expected: all tests PASS, output pristine.

- [ ] **Step 5: Configure both clients**

Claude `.claude/settings.json`:

- retain SessionStart;
- remove three `PreToolUse` validators;
- add one `PostToolUse` matcher `Write|Edit|MultiEdit` calling `node "$CLAUDE_PROJECT_DIR/scripts/agent/write-guard.mjs"`.

Codex `.codex/hooks.json`:

- SessionStart matcher `startup|resume|compact`, calling `node "$(git rev-parse --show-toplevel)/scripts/session-start-context.mjs"`;
- PostToolUse matcher `apply_patch|Edit|Write`, calling the same write guard from Git root.

- [ ] **Step 6: Verify hook fixtures and commit**

Run:

```bash
printf '%s' '{"hook_event_name":"PostToolUse","tool_name":"apply_patch","cwd":"'"$PWD"'","tool_input":{"command":"*** Begin Patch\n*** Update File: README.md\n*** End Patch"}}' | node scripts/agent/write-guard.mjs
node --test scripts/agent/test-write-guard.mjs
```

Expected: exit 0 and tests PASS.

Commit: `Добавить общий write guard для Claude и Codex`.

---

### Task 3: Single-source instructions и native shared skills

**Files:**
- Modify: `AGENTS.md`
- Replace: `CLAUDE.md`
- Modify: `.remember/core.md`
- Move: `skills/skill-ingest.md` → `skills/kb-ingest/SKILL.md`
- Move: `skills/skill-decision-log.md` → `skills/decision-log/SKILL.md`
- Move: `.claude/skills/interviewer-agent/SKILL.md` → `skills/interviewer-agent/SKILL.md`
- Create symlinks: `.claude/skills/{kb-ingest,decision-log,interviewer-agent}`
- Create symlinks: `.agents/skills/{kb-ingest,decision-log,interviewer-agent}`
- Modify: `.claude/skills/README.md`
- Modify: `skills/README.md`
- Modify: `scripts/check-decisions.mjs`
- Create: `scripts/agent/repository-check.mjs`
- Create: `scripts/agent/test-repository-check.mjs`
- Modify: `scripts/agent/sync-config.mjs`

**Interfaces:**
- Produces: `auditRepository(root) -> { passed, errors }`.
- `agent:check` calls config drift check plus repository audit.

- [ ] **Step 1: Write failing repository-audit tests**

Create a temporary repo fixture and assert observable policy failures:

```js
test('rejects split instructions and divergent shared skills', async () => {
  const root = await makeFixture({ claude: '# local rules\n', agentRule: 'git push origin HEAD:main' });
  const result = await auditRepository(root);
  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /@AGENTS\.md/);
  assert.match(result.errors.join('\n'), /automatic main push/i);
  assert.match(result.errors.join('\n'), /kb-ingest.*Claude.*Codex/i);
});

test('accepts one contract and skills resolving to canonical files', async () => {
  const root = await makeFixture({ claude: '@AGENTS.md\n', agentRule: 'Работай в текущей ветке.' });
  await linkSharedSkills(root);
  const result = await auditRepository(root);
  assert.deepEqual(result, { passed: true, errors: [] });
});
```

The fixture also includes minimal `.claude/settings.json`, `.codex/hooks.json` and shared skill
directories so the audit exercises real adapters rather than mocks.

- [ ] **Step 2: Run RED**

Run: `node --test scripts/agent/test-repository-check.mjs`
Expected: FAIL because `repository-check.mjs` is missing.

- [ ] **Step 3: Implement repository audit**

Audit these consumer-visible invariants:

- first non-comment content of `CLAUDE.md` is `@AGENTS.md`;
- neither active instruction file contains `git push origin HEAD:main` as a mandatory rule;
- Claude/Codex hook JSON both reference `session-start-context.mjs` and `write-guard.mjs`;
- the three common skills exist in both host directories and `realpath` equals the canonical `skills/<name>/SKILL.md`;

Conductor invariants are added to this audit in Task 4, after the repository settings file exists.

Update `sync-config.mjs --check` to run `auditRepository` after MCP drift and report all errors. `--write` continues to write only generated MCP adapters.

- [ ] **Step 4: Consolidate instructions**

Add to `AGENTS.md`: Russian language policy, Conductor-safe Git policy, artifact placement, host-adapter map, setup/check commands, and the optimized reading order from the spec.

Replace `CLAUDE.md` with `@AGENTS.md`, a short statement that normative rules live there, and pointers to `.claude/settings.json`, `.mcp.json`, `.claude/skills` and trust commands.

Remove duplicated hard rules from `.remember/core.md`; link to `AGENTS.md` instead.

- [ ] **Step 5: Migrate and link shared skills**

Move the three canonical files without rewriting their procedure bodies. Normalize native frontmatter so each has `name` and a natural-language `description`; retain legacy trigger metadata if useful. Create relative symlinks from both host skill roots to `../../skills/<name>`.

Update all README/path references and the decision validator recommendation.

- [ ] **Step 6: Run GREEN against fixture and real repository**

Run:

```bash
node --test scripts/agent/test-repository-check.mjs
node scripts/agent/sync-config.mjs --check
node scripts/kb-doctor.mjs
```

Expected: tests PASS; repository audit PASS; doctor exit 0.

- [ ] **Step 7: Commit**

Commit: `Сделать AGENTS единым контрактом для моделей`.

---

### Task 4: Reproducible Conductor bootstrap и единый quality gate

**Files:**
- Create: `.conductor/settings.toml`
- Create: `tools/viewer/ports.ts`
- Create: `tools/viewer/ports.test.ts`
- Modify: `tools/viewer/server.ts`
- Modify: `tools/viewer/vite.config.ts`
- Modify: `tools/viewer/package.json`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `scripts/git-hooks/pre-push`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/kb-ci.yml`
- Modify: `README.md`

**Interfaces:**
- Produces: `resolveViewerPorts(env) -> { apiPort, clientPort }`.
- Produces commands: `pnpm kb:check`, `pnpm viewer:test`, deterministic `pnpm run setup`.

- [ ] **Step 1: Write failing viewer port tests**

Create `tools/viewer/ports.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveViewerPorts } from './ports.js';

test('uses adjacent Conductor workspace ports', () => {
  assert.deepEqual(resolveViewerPorts({ CONDUCTOR_PORT: '4400' }), { apiPort: 4400, clientPort: 4401 });
});

test('explicit viewer ports override Conductor', () => {
  assert.deepEqual(resolveViewerPorts({ CONDUCTOR_PORT: '4400', VIEWER_PORT: '5500', VITE_PORT: '6600' }), { apiPort: 5500, clientPort: 6600 });
});

test('uses standalone defaults and rejects invalid ports', () => {
  assert.deepEqual(resolveViewerPorts({}), { apiPort: 3001, clientPort: 5173 });
  assert.throws(() => resolveViewerPorts({ CONDUCTOR_PORT: '0' }), /valid TCP port/i);
});
```

Install the existing viewer lockfile before the RED run:

```bash
corepack pnpm -C tools/viewer install --frozen-lockfile
```

- [ ] **Step 2: Run RED**

Run: `pnpm -C tools/viewer exec tsx --test ports.test.ts`
Expected: FAIL because `ports.ts` is missing.

- [ ] **Step 3: Implement port resolver and wire both processes**

`resolveViewerPorts` parses decimal integers in range 1–65535. Defaults are API 3001/client 5173. A valid `CONDUCTOR_PORT` sets API to base and client to base+1. Explicit `VIEWER_PORT` and `VITE_PORT` independently override those values. Reject base 65535 because the adjacent frontend port would overflow.

`server.ts` uses `resolveViewerPorts(process.env).apiPort`; `vite.config.ts` uses both returned values for dev server and proxy.

- [ ] **Step 4: Add Conductor config and deterministic commands**

Create repository settings with schema URL, `scripts.setup`, `run_mode = "concurrent"`, default local viewer run and cross-environment check run. Setup command is exactly:

```sh
corepack pnpm run setup && corepack pnpm kb:index && git config core.hooksPath scripts/git-hooks
```

Viewer run maps `VIEWER_PORT=$CONDUCTOR_PORT` and `VITE_PORT=$((CONDUCTOR_PORT + 1))` before
`corepack pnpm viewer:dev`.

Extend `auditRepository` with consumer checks that the shared Conductor settings contain frozen
setup, `kb:index`, hook bootstrap, concurrent mode and `CONDUCTOR_PORT` viewer mapping. Add a failing
fixture case first, run it RED, then implement the checks and run it GREEN.

Change root setup to three `corepack pnpm -C <dir> install --frozen-lockfile` calls. Add:

```json
"viewer:test": "pnpm -C tools/viewer exec tsx --test ports.test.ts",
"kb:check": "pnpm agent:check && node scripts/semantic/test-retrieval.mjs && node scripts/semantic/test-control.mjs && node scripts/semantic/test-gate.mjs && node scripts/kb-doctor.mjs && node scripts/semantic/verify.mjs --scan --provenance --no-semantic"
```

Pre-push executes `pnpm kb:check`. Both CI workflows install with the root frozen setup and execute `pnpm kb:check`; `kb-ci` retains index/eval/model cache steps without duplicating the individual checks.

- [ ] **Step 5: Harden environment handling and docs**

Change `.gitignore` from exact `.env` to:

```gitignore
.env*
!.env.example
```

README documents:

- `pnpm run setup`, `pnpm kb:index`, `pnpm kb:check`;
- Claude project MCP approval;
- Codex project trust, `/hooks`, `/mcp`;
- the seven-step cross-model smoke flow from the spec;
- provider-specific status of standalone `--execute`/critic/dream commands.

- [ ] **Step 6: Run focused GREEN**

Run:

```bash
pnpm -C tools/viewer exec tsx --test ports.test.ts
node --test scripts/agent/test-config.mjs scripts/agent/test-write-guard.mjs scripts/agent/test-repository-check.mjs
pnpm agent:check
```

Expected: all tests and checks PASS.

- [ ] **Step 7: Run full verification**

Run:

```bash
pnpm run setup
pnpm kb:index
pnpm kb:check
pnpm viewer:test
pnpm viewer:build
git diff --check
git status --short
```

Expected: every command except informational `git status` exits 0; status lists only intended files.

- [ ] **Step 8: Commit**

Commit: `Настроить воспроизводимую работу агентов в Conductor`.
