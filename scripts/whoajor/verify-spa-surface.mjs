#!/usr/bin/env node
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyPublishedSpaSurfaceAudits } from './lib/spa-surface-audit.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_WHOAJOR_ROOT = join(REPO_ROOT, '01_raw', 'whoajor');
const DEFAULT_SOURCE_SUMMARIES_ROOT = join(REPO_ROOT, '02_sources');

export async function runVerifySpaSurfaceCli(args, {
  verify = verifyPublishedSpaSurfaceAudits,
  stdout = process.stdout,
} = {}) {
  const positionals = args.filter((value) => value !== '--');
  if (positionals.length > 1 || positionals.some((value) => !value || value.startsWith('--'))) {
    throw new Error('usage: whoajor:verify-spa-surface -- [whoajor-raw-root]');
  }
  const whoajorRoot = positionals[0] ?? DEFAULT_WHOAJOR_ROOT;
  const verifyOptions = resolve(whoajorRoot) === DEFAULT_WHOAJOR_ROOT
    ? { sourceSummariesRoot: DEFAULT_SOURCE_SUMMARIES_ROOT }
    : {};
  const result = await verify(whoajorRoot, verifyOptions);
  stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

async function main() {
  await runVerifySpaSurfaceCli(process.argv.slice(2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
