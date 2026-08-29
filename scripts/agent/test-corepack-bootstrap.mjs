import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const corepack = execFileSync('sh', ['-c', 'command -v corepack'], { encoding: 'utf8' }).trim();
const tempRoots = [];

test.after(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function withoutPnpmShim() {
  const bin = await mkdtemp(join(tmpdir(), 'corepack-only-path-'));
  tempRoots.push(bin);
  await symlink(process.execPath, join(bin, 'node'));
  await symlink(corepack, join(bin, 'corepack'));
  const forbiddenPnpm = join(bin, 'pnpm');
  await writeFile(forbiddenPnpm, '#!/bin/sh\necho "bare pnpm command is forbidden" >&2\nexit 86\n');
  await chmod(forbiddenPnpm, 0o755);
  return `${bin}:/usr/bin:/bin`;
}

async function runCorepackScript(script) {
  const env = {
    ...process.env,
    PATH: await withoutPnpmShim(),
    KB_JOURNAL: '0',
  };
  return execFileAsync(corepack, ['pnpm', script], {
    cwd: repoRoot,
    env,
    maxBuffer: 10 * 1024 * 1024,
  });
}

test('agent:check runs through Corepack without a global pnpm shim', async () => {
  await assert.doesNotReject(runCorepackScript('agent:check'));
});

test('viewer:test runs through Corepack without a global pnpm shim', async () => {
  await assert.doesNotReject(runCorepackScript('viewer:test'));
});

test('kb:check runs through Corepack without a global pnpm shim', async () => {
  await assert.doesNotReject(runCorepackScript('kb:check'));
});

test('pre-push runs the quality gate without a global pnpm shim', async () => {
  const env = {
    ...process.env,
    PATH: await withoutPnpmShim(),
    KB_JOURNAL: '0',
  };
  await assert.doesNotReject(execFileAsync(join(repoRoot, 'scripts/git-hooks/pre-push'), [], {
    cwd: repoRoot,
    env,
    input: '',
    maxBuffer: 10 * 1024 * 1024,
  }));
});
