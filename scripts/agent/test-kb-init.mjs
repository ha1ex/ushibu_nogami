import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtureRoots = [];

const claudeSession = 'node "$CLAUDE_PROJECT_DIR/scripts/session-start-context.mjs"';
const claudeGuard = 'node "$CLAUDE_PROJECT_DIR/scripts/agent/write-guard.mjs"';
const codexSession = 'node "$(git rev-parse --show-toplevel)/scripts/session-start-context.mjs"';
const codexGuard = 'node "$(git rev-parse --show-toplevel)/scripts/agent/write-guard.mjs"';

test.after(async () => {
  await Promise.all(fixtureRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function write(root, path, content) {
  const destination = join(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'kb-init fixture-'));
  fixtureRoots.push(root);
  await mkdir(join(root, 'scripts'), { recursive: true });
  await copyFile(join(projectRoot, 'scripts/kb-init.mjs'), join(root, 'scripts/kb-init.mjs'));
  await write(root, 'AGENTS.md', '# AGENTS\n\n## Project purpose\n\nOld purpose.\n\n> Внутреннее устройство\n');
  await write(root, '.remember/core.md', '# Core\n\n## Цель проекта\n\nOld purpose.\n\n## Контекст\n');
  await write(root, 'log.md', '# Log\n');
  await write(root, 'agent-config/harness.json', '{\n  "version": 1,\n  "level": 2\n}\n');
  await write(root, '.github/workflows/ci.yml', 'name: CI\n');
  await write(root, '.github/workflows/kb-ci.yml', 'name: kb-ci\n');
  await write(root, '.claude/settings.json', `${JSON.stringify({
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: claudeSession, timeout: 10 }] }],
      PostToolUse: [
        { matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: claudeGuard, timeout: 10 }] },
        { matcher: 'NotebookEdit', hooks: [{ type: 'command', command: 'node scripts/other-post-hook.mjs' }] },
      ],
      Notification: [{ hooks: [{ type: 'command', command: 'node scripts/notify.mjs' }] }],
    },
  }, null, 2)}\n`);
  await write(root, '.codex/hooks.json', `${JSON.stringify({
    hooks: {
      SessionStart: [{
        matcher: '^(startup|resume|clear|compact)$',
        hooks: [{ type: 'command', command: codexSession, timeout: 10 }],
      }],
      PostToolUse: [
        { matcher: 'apply_patch|Edit|Write', hooks: [{ type: 'command', command: codexGuard, timeout: 10 }] },
        { matcher: 'custom_tool', hooks: [{ type: 'command', command: 'node scripts/other-post-hook.mjs' }] },
      ],
      Notification: [{ hooks: [{ type: 'command', command: 'node scripts/notify.mjs' }] }],
    },
  }, null, 2)}\n`);
  return root;
}

async function runInit(root, level) {
  return execFileAsync(process.execPath, [
    'scripts/kb-init.mjs',
    '--yes',
    '--keep-demo',
    '--level',
    String(level),
  ], { cwd: root });
}

async function readJson(root, path) {
  return JSON.parse(await readFile(join(root, path), 'utf8'));
}

function hookCommands(config, event) {
  return (config.hooks?.[event] ?? []).flatMap((entry) => entry.hooks ?? []).map((hook) => hook.command);
}

async function assertMissing(path) {
  await assert.rejects(stat(path), (error) => error?.code === 'ENOENT');
}

for (const level of [0, 1]) {
  test(`kb:init persists level ${level} and removes only common PostToolUse guards`, async () => {
    const root = await makeFixture();

    const result = await runInit(root, level);
    const claude = await readJson(root, '.claude/settings.json');
    const codex = await readJson(root, '.codex/hooks.json');

    assert.match(result.stdout, new RegExp(`PostToolUse.*L${level}`));
    assert.deepEqual(await readJson(root, 'agent-config/harness.json'), { version: 1, level });
    assert.deepEqual(hookCommands(claude, 'SessionStart'), [claudeSession]);
    assert.deepEqual(hookCommands(codex, 'SessionStart'), [codexSession]);
    assert.deepEqual(hookCommands(claude, 'PostToolUse'), ['node scripts/other-post-hook.mjs']);
    assert.deepEqual(hookCommands(codex, 'PostToolUse'), ['node scripts/other-post-hook.mjs']);
    assert.deepEqual(hookCommands(claude, 'Notification'), ['node scripts/notify.mjs']);
    assert.deepEqual(hookCommands(codex, 'Notification'), ['node scripts/notify.mjs']);
    await assertMissing(join(root, '.github/workflows/ci.yml'));
    await assertMissing(join(root, '.github/workflows/kb-ci.yml'));
  });
}

test('kb:init restores one canonical PostToolUse guard per host when raised to level 2', async () => {
  const root = await makeFixture();
  await runInit(root, 0);

  const result = await runInit(root, 2);
  const claude = await readJson(root, '.claude/settings.json');
  const codex = await readJson(root, '.codex/hooks.json');

  assert.match(result.stdout, /PostToolUse.*L2/);
  assert.deepEqual(await readJson(root, 'agent-config/harness.json'), { version: 1, level: 2 });
  assert.deepEqual(hookCommands(claude, 'SessionStart'), [claudeSession]);
  assert.deepEqual(hookCommands(codex, 'SessionStart'), [codexSession]);
  assert.equal(hookCommands(claude, 'PostToolUse').filter((command) => command === claudeGuard).length, 1);
  assert.equal(hookCommands(codex, 'PostToolUse').filter((command) => command === codexGuard).length, 1);
  assert.ok(hookCommands(claude, 'PostToolUse').includes('node scripts/other-post-hook.mjs'));
  assert.ok(hookCommands(codex, 'PostToolUse').includes('node scripts/other-post-hook.mjs'));
});
