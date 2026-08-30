import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseCaptureSpaSurfaceArgs,
  runCaptureSpaSurfaceCli,
} from '../capture-spa-surface.mjs';
import { runVerifySpaSurfaceCli } from '../verify-spa-surface.mjs';

test('capture CLI разрешает только output/delay и не расширяет canonical origin scope', async () => {
  assert.deepEqual(
    parseCaptureSpaSurfaceArgs(['--output', '/tmp/audit', '--delay-ms', '400']),
    { outputDir: '/tmp/audit', delayMs: 400 },
  );
  assert.throws(
    () => parseCaptureSpaSurfaceArgs(['--base-url', 'https://example.com']),
    /unknown option --base-url/i,
  );
  assert.throws(() => parseCaptureSpaSurfaceArgs([]), /--output is required/i);

  let received;
  let output = '';
  await runCaptureSpaSurfaceCli(['--output', '/tmp/2026-08-30-spa-surface-audit'], {
    capture: async (options) => {
      received = options;
      return { auditId: options.auditId, assetRootHash: 'a'.repeat(64), assets: [1, 2] };
    },
    stdout: { write: (chunk) => { output += chunk; } },
  });
  assert.deepEqual(received, {
    outputDir: '/tmp/2026-08-30-spa-surface-audit',
    auditId: '2026-08-30-spa-surface-audit',
    delayMs: 250,
  });
  assert.deepEqual(JSON.parse(output), {
    status: 'captured',
    auditId: '2026-08-30-spa-surface-audit',
    assets: 2,
    assetRootHash: 'a'.repeat(64),
  });
});

test('published SPA verifier CLI работает offline и печатает aggregate result', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'whoajor-spa-cli-empty-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let output = '';
  const expected = { status: 'complete', auditCount: 1, audits: [{ auditId: 'audit' }] };

  const result = await runVerifySpaSurfaceCli([root], {
    verify: async (receivedRoot) => {
      assert.equal(receivedRoot, root);
      return expected;
    },
    stdout: { write: (chunk) => { output += chunk; } },
  });

  assert.equal(result, expected);
  assert.deepEqual(JSON.parse(output), expected);
});

test('package и CI требуют единый Whoajor gate: SPA surface плюс published snapshot', async () => {
  const packageJson = JSON.parse(await readFile(
    new URL('../../../package.json', import.meta.url),
    'utf8',
  ));
  assert.equal(
    packageJson.scripts['whoajor:verify'],
    'corepack pnpm whoajor:verify-spa-surface && corepack pnpm whoajor:verify-published',
  );

  const workflow = await readFile(
    new URL('../../../.github/workflows/kb-ci.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /^\s*corepack pnpm whoajor:verify\s*$/m);
});
