#!/usr/bin/env node
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeDataProfile } from './lib/profile.mjs';

export async function runProfileCli(args) {
  const positionals = args[0] === '--' ? args.slice(1) : args;
  if (positionals.length < 1 || positionals.length > 2 || !positionals[0]) {
    throw new Error('usage: node scripts/whoajor/profile.mjs <snapshot-dir> [database-path]');
  }
  const snapshotDir = positionals[0];
  const databasePath = positionals[1] ?? join(snapshotDir, 'whoajor.sqlite');
  const output = join(snapshotDir, 'data-profile.json');
  const report = await writeDataProfile(snapshotDir, databasePath, output);
  return { output, report };
}

async function main() {
  const { output, report } = await runProfileCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify({
    blockingChecks: report.blockingChecks,
    output,
    status: report.status,
  })}\n`);
  if (report.status !== 'complete') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
