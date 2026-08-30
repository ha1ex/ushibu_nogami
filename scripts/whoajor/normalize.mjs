#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { buildDatabase } from './lib/normalize.mjs';

export async function runNormalizeCli(args) {
  if (args.length !== 2 || !args[0] || !args[1]) {
    throw new Error('usage: whoajor:build-db -- <snapshot-dir> <database-path>');
  }
  return buildDatabase(args[0], args[1]);
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
