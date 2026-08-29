import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractChangedPaths, validateWrittenPaths } from './write-guard-lib.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function runWriteGuard(input, { env = {} } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ['scripts/agent/write-guard.mjs'], {
      cwd: projectRoot,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (status) => resolveResult({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}

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

test('extracts a Codex Delete File header', () => {
  assert.deepEqual(
    extractChangedPaths(
      { tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Delete File: 05_decisions/deleted.md\n*** End Patch' } },
      { cwd: '/repo', root: '/repo' },
    ),
    ['/repo/05_decisions/deleted.md'],
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

test('skips a nonexistent path left by a Codex Delete File patch', async () => {
  const root = await createFixtureRoot();
  const result = await validateWrittenPaths([join(root, '05_decisions/deleted.md')], { root });

  assert.deepEqual(result, { passed: true, diagnostics: '' });
});

test('runs check-decisions against a decision fixture', async () => {
  const root = await createFixtureRoot();
  const path = join(root, '05_decisions/decision.md');
  await writeFile(path, '---\ntype: decision\n---\n\nНет обязательной метки.\n');

  const result = await validateWrittenPaths([path], { root });

  assert.equal(result.passed, false);
  assert.match(result.diagnostics, /\[check-decisions\]/);
});

test('runs check-md-frontmatter against a synthesis fixture', async () => {
  const root = await createFixtureRoot();
  const path = join(root, '04_synthesis/frontmatter.md');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, '---\nconfidence: high\n---\n\nINFERENCE: Текст.\n');

  const result = await validateWrittenPaths([path], { root });

  assert.equal(result.passed, false);
  assert.match(result.diagnostics, /\[check-md-frontmatter\]/);
});

test('runs check-provenance against a decision fixture', async () => {
  const root = await createFixtureRoot();
  const path = join(root, '05_decisions/provenance.md');
  await writeFile(
    path,
    '---\ntype: decision\n---\n\nDECISION: Неверная ссылка. [source: /05_decisions/other.md]\n',
  );

  const result = await validateWrittenPaths([path], { root });

  assert.equal(result.passed, false);
  assert.match(result.diagnostics, /\[check-provenance\]/);
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

test('preserves a decision symlink logical path while reading its inner-root target', async () => {
  const root = await createFixtureRoot();
  const target = join(root, 'README.md');
  const linkedPath = join(root, '05_decisions/linked.md');
  await writeFile(target, 'Нет обязательной decision-метки.\n');
  await symlink('../README.md', linkedPath);

  const result = await validateWrittenPaths([linkedPath], { root });

  assert.equal(result.passed, false);
  assert.match(result.diagnostics, /\[check-decisions\]/);
});

test('reports a nonzero silent validator with a fallback diagnostic', async () => {
  const root = await createFixtureRoot();
  const path = join(root, 'README.md');
  const silentValidator = join(root, 'silent-validator.mjs');
  await Promise.all([
    writeFile(path, 'Свободный markdown.\n'),
    writeFile(silentValidator, 'process.exit(7);\n'),
  ]);

  const result = await validateWrittenPaths([path], { root, validators: [silentValidator] });

  assert.deepEqual(result, {
    passed: false,
    diagnostics: 'validator silent-validator.mjs exited 7',
  });
});

test('journals malformed stdin while failing open', async (t) => {
  const journalRoot = await mkdtemp(join(tmpdir(), 'write-guard-journal-'));
  t.after(() => rm(journalRoot, { recursive: true, force: true }));

  const result = await runWriteGuard('{not-json', { env: { KB_ROOT: journalRoot, KB_JOURNAL: '1' } });
  const lines = (await readFile(join(journalRoot, '.context/kb-journal.jsonl'), 'utf8')).trim().split('\n');
  const record = JSON.parse(lines.at(-1));

  assert.equal(result.status, 0);
  assert.match(result.stderr, /\[write-guard\].*hook-error/);
  assert.deepEqual(record.kind, 'hook-error');
  assert.equal(record.hook, 'write-guard');
});

test('CLI rejects an invalid changed decision with diagnostics', async (t) => {
  const fixtureName = `.write-guard-cli-${process.pid}.md`;
  const path = join(projectRoot, '05_decisions', fixtureName);
  t.after(() => rm(path, { force: true }));
  await writeFile(path, '---\ntype: decision\n---\n\nНет DECISION evidence.\n');

  const result = await runWriteGuard(JSON.stringify({
    tool_name: 'apply_patch',
    cwd: projectRoot,
    tool_input: { command: `*** Begin Patch\n*** Update File: 05_decisions/${fixtureName}\n*** End Patch` },
  }));

  assert.equal(result.status, 2);
  assert.match(result.stderr, /\[check-decisions\]/);
  assert.match(result.stderr, /DECISION:/);
});

test('CLI allows a valid changed path', async () => {
  const result = await runWriteGuard(JSON.stringify({
    tool_name: 'apply_patch',
    cwd: projectRoot,
    tool_input: { command: '*** Begin Patch\n*** Update File: README.md\n*** End Patch' },
  }));

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
});
