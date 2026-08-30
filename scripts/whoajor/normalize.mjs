#!/usr/bin/env node
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDatabase } from './lib/normalize.mjs';

export async function runNormalizeCli(args) {
  const positionals = args[0] === '--' ? args.slice(1) : args;
  if (positionals.length < 1 || positionals.length > 2 || !positionals[0]) {
    throw new Error('usage: whoajor:build-db -- <snapshot-dir> [database-path]');
  }
  return buildDatabase(
    positionals[0],
    positionals[1] ?? join(positionals[0], 'whoajor.sqlite'),
  );
}

async function main() {
  const result = await runNormalizeCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
