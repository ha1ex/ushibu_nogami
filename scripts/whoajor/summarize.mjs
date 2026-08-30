#!/usr/bin/env node
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderSourceSummary } from './lib/summary.mjs';
import {
  createSummaryInput, defaultRawTarget, writeFileAtomically,
} from './sync.mjs';

export async function runSummarizeCli(args) {
  const positionals = args.filter((value) => value !== '--');
  if (positionals.length < 1 || positionals.length > 3 || !positionals[0]) {
    throw new Error('usage: whoajor:summarize -- <snapshot-dir> [raw-target] [output-path]');
  }
  const [snapshotDir, rawTarget = defaultRawTarget(snapshotDir), output = join(
    snapshotDir, 'source-summary.md',
  )] = positionals;
  const summary = renderSourceSummary(await createSummaryInput(snapshotDir, rawTarget));
  await writeFileAtomically(output, summary);
  return { output, bytes: Buffer.byteLength(summary) };
}

async function main() {
  process.stdout.write(`${JSON.stringify(await runSummarizeCli(process.argv.slice(2)))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
