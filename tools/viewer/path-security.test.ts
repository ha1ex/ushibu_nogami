import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { resolveSafeMarkdownPath } from './path-security.js';

const fixtureRoots: string[] = [];

test.after(async () => {
  await Promise.all(fixtureRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function write(root: string, path: string, content: string) {
  const destination = join(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
  return destination;
}

async function makeRoot(prefix = 'viewer-path-') {
  const root = await mkdtemp(join(tmpdir(), prefix));
  fixtureRoots.push(root);
  return root;
}

test('accepts a normal markdown file and returns its lexical response path', async () => {
  const root = await makeRoot();
  const target = await write(root, '03_wiki/normal.md', '# Normal\n');

  assert.deepEqual(await resolveSafeMarkdownPath(root, '03_wiki/normal.md'), {
    relativePath: '03_wiki/normal.md',
    resolvedPath: await realpath(target),
  });
});

test('rejects a markdown symlink whose real target escapes the repository root', async () => {
  const root = await makeRoot();
  const outside = await makeRoot('viewer-outside-');
  const secret = await write(outside, 'secret.md', 'secret\n');
  await mkdir(join(root, '03_wiki'), { recursive: true });
  await symlink(secret, join(root, '03_wiki/escape.md'));

  assert.equal(await resolveSafeMarkdownPath(root, '03_wiki/escape.md'), null);
});

test('accepts an internal symlink but retains the lexical link path', async () => {
  const root = await makeRoot();
  const target = await write(root, '03_wiki/target.md', '# Target\n');
  await symlink('target.md', join(root, '03_wiki/alias.md'));

  assert.deepEqual(await resolveSafeMarkdownPath(root, '03_wiki/alias.md'), {
    relativePath: '03_wiki/alias.md',
    resolvedPath: await realpath(target),
  });
});

test('rejects markdown aliases whose internal real targets are hidden or non-markdown', async (t) => {
  const cases = [
    { name: 'root env file', target: '.env', linkTarget: '../.env', alias: 'env-alias.md' },
    { name: 'git config', target: '.git/config', linkTarget: '../.git/config', alias: 'git-alias.md' },
    { name: 'plain text file', target: 'note.txt', linkTarget: '../note.txt', alias: 'text-alias.md' },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const root = await makeRoot();
      await write(root, fixture.target, 'sensitive or non-markdown\n');
      await mkdir(join(root, '03_wiki'), { recursive: true });
      await symlink(fixture.linkTarget, join(root, '03_wiki', fixture.alias));

      assert.equal(await resolveSafeMarkdownPath(root, `03_wiki/${fixture.alias}`), null);
    });
  }
});

test('rejects traversal, hidden segments, non-markdown paths, and missing files', async () => {
  const root = await makeRoot();
  await write(root, '03_wiki/visible.md', '# Visible\n');
  await write(root, '.hidden/secret.md', '# Secret\n');
  await write(root, '03_wiki/note.txt', 'text\n');

  for (const path of [
    '../outside.md',
    '03_wiki/../03_wiki/visible.md',
    '.hidden/secret.md',
    '03_wiki/.nested/secret.md',
    '03_wiki/note.txt',
    '03_wiki/missing.md',
    '',
  ]) {
    assert.equal(await resolveSafeMarkdownPath(root, path), null, path);
  }
});
