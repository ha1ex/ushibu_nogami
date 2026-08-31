import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const exec = promisify(execFile);
const script = new URL('../scripts/migrate-state-v3.mjs', import.meta.url);

test('migration dry-run reads only explicit local input and reports kept and dropped keys', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ushibu-state-migration-'));
  const input = path.join(directory, 'team-v3.json');
  await writeFile(input, JSON.stringify({
    checks: { 'action-m01-confirm-time': true, rogue: true },
    notes: { 'match-m01-note': 'kept', 'match-m01-score': '13:9', 'match-m02-score': '13 - 9' }
  }));
  const { stdout } = await exec(process.execPath, [script.pathname, '--input', input]);
  const result = JSON.parse(stdout);
  assert.equal(result.preview.version, 4);
  assert.equal(result.preview.revision, 0);
  assert.deepEqual(result.preview.scores['match-m01-score'], { ours: 13, theirs: 9, played: true });
  assert.ok(result.report.kept.checks.includes('action-m01-confirm-time'));
  assert.ok(result.report.dropped.some((entry) => entry.key === 'rogue'));
  assert.ok(result.report.dropped.some((entry) => entry.key === 'match-m02-score' && entry.reason === 'incompatible_score'));
  assert.deepEqual(await readdir(directory), ['team-v3.json']);
});

test('migration output is explicit, exclusive and can never overwrite the input', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ushibu-state-output-'));
  const input = path.join(directory, 'input.json');
  const output = path.join(directory, 'output.json');
  await writeFile(input, JSON.stringify({ checks: {}, notes: {} }));
  await exec(process.execPath, [script.pathname, '--input', input, '--output', output]);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).version, 4);
  await assert.rejects(() => exec(process.execPath, [script.pathname, '--input', input, '--output', output]));
  await assert.rejects(() => exec(process.execPath, [script.pathname, '--input', input, '--output', input]));
});
