import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractChangedPaths, validateWrittenPaths } from './write-guard-lib.mjs';

test('extracts a Claude Write file_path', () => {
  assert.deepEqual(
    extractChangedPaths(
      { tool_name: 'Write', tool_input: { file_path: '/repo/04_synthesis/a.md' } },
      { cwd: '/repo', root: '/repo' },
    ),
    ['/repo/04_synthesis/a.md'],
  );
});

test('extracts Claude Edit and MultiEdit file paths', () => {
  assert.deepEqual(
    extractChangedPaths(
      { tool_name: 'MultiEdit', tool_input: { file_path: '05_decisions/a.md' } },
      { cwd: '/repo/nested', root: '/repo' },
    ),
    ['/repo/nested/05_decisions/a.md'],
  );
});

test('extracts every Codex apply_patch path', () => {
  const command = [
    '*** Begin Patch',
    '*** Update File: 04_synthesis/a.md',
    '*** Move to: 04_synthesis/b.md',
    '*** Add File: 05_decisions/c.md',
    '*** End Patch',
  ].join('\n');
  assert.deepEqual(
    extractChangedPaths({ tool_name: 'apply_patch', tool_input: { command } }, { cwd: '/repo', root: '/repo' }),
    ['/repo/04_synthesis/a.md', '/repo/04_synthesis/b.md', '/repo/05_decisions/c.md'],
  );
});

test('drops env, outside-root, unsupported, and duplicate paths', () => {
  const command = [
    '*** Begin Patch',
    '*** Add File: .env.local',
    '*** Add File: ../outside.md',
    '*** Add File: notes.txt',
    '*** Add File: skills/kb/evals/case.yaml',
    '*** Add File: skills/kb/evals/case.yaml',
    '*** End Patch',
  ].join('\n');
  assert.deepEqual(
    extractChangedPaths({ tool_name: 'apply_patch', tool_input: { command } }, { cwd: '/repo', root: '/repo' }),
    ['/repo/skills/kb/evals/case.yaml'],
  );
});

async function createFixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), 'write-guard-'));
  await Promise.all([
    mkdir(join(root, '02_sources'), { recursive: true }),
    mkdir(join(root, '05_decisions'), { recursive: true }),
  ]);
  return root;
}

test('rejects a written decision missing DECISION evidence', async () => {
  const root = await createFixtureRoot();
  const path = join(root, '05_decisions/x.md');
  await writeFile(path, '---\ntype: decision\n---\n\nБез обязательной метки.\n');

  const result = await validateWrittenPaths([path], { root });

  assert.equal(result.passed, false);
  assert.match(result.diagnostics, /DECISION:/);
});

test('accepts a valid written decision after all validators run', async () => {
  const root = await createFixtureRoot();
  const path = join(root, '05_decisions/x.md');
  await writeFile(
    path,
    '---\ntype: decision\n---\n\nDECISION: Сохраняем проверку. [source: /02_sources/x.md]\n',
  );

  const result = await validateWrittenPaths([path], { root });

  assert.deepEqual(result, { passed: true, diagnostics: '' });
});

test('does not follow a changed-file symlink outside the root', async () => {
  const root = await createFixtureRoot();
  const outside = await mkdtemp(join(tmpdir(), 'write-guard-outside-'));
  const outsideFile = join(outside, 'secret.md');
  const linkedPath = join(root, '05_decisions/linked.md');
  await writeFile(outsideFile, 'DECISION: Outside. [source: /02_sources/x.md]\n');
  await symlink(outsideFile, linkedPath);

  const result = await validateWrittenPaths([linkedPath], { root });

  assert.deepEqual(result, { passed: true, diagnostics: '' });
});
