#!/usr/bin/env node
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyPublishedSnapshots } from './lib/published-snapshot.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_WHOAJOR_ROOT = join(REPO_ROOT, '01_raw', 'whoajor');

export async function runVerifyPublishedCli(args, { stdout = process.stdout } = {}) {
  const positionals = args.filter((value) => value !== '--');
  if (positionals.length > 1 || positionals.some((value) => !value)) {
    throw new Error('usage: whoajor:verify-published -- [whoajor-raw-root]');
  }
  const result = await verifyPublishedSnapshots(positionals[0] ?? DEFAULT_WHOAJOR_ROOT);
  stdout.write(`${JSON.stringify({
    status: result.status,
    fullSnapshotCount: result.fullSnapshotCount,
    snapshots: result.snapshots,
  })}\n`);
  return result;
}

async function main() {
  await runVerifyPublishedCli(process.argv.slice(2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
