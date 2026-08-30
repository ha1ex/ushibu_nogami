#!/usr/bin/env node
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateSnapshot } from './lib/validation.mjs';

let temporarySequence = 0;

async function writeReportAtomically(dir, report) {
  await mkdir(dir, { recursive: true });
  const destination = join(dir, 'validation-report.json');
  const temporary = `${destination}.tmp-${process.pid}-${temporarySequence += 1}`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`);
  await rename(temporary, destination);
}

export async function runValidationCli(args) {
  const positionals = args[0] === '--' ? args.slice(1) : args;
  if (positionals.length !== 1 || !positionals[0]) {
    throw new Error('usage: whoajor:validate -- <snapshot-dir>');
  }
  const dir = positionals[0];
  const report = await validateSnapshot(dir);
  await writeReportAtomically(dir, report);
  return report;
}

async function main() {
  const report = await runValidationCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    errors: report.errors.length,
    rootHash: report.rootHash,
  })}\n`);
  if (report.status !== 'complete') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
