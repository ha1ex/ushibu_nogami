#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { DEFAULT_DELAY_MS, WHOAJOR_BASE_URL } from './config.mjs';
import { verifySample } from './lib/sampling.mjs';

function parseNonNegativeInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${option} must be a non-negative integer`);
  }
  return parsed;
}

export function parseCliArgs(args) {
  const values = args[0] === '--' ? args.slice(1) : args;
  const options = { baseUrl: WHOAJOR_BASE_URL, delayMs: DEFAULT_DELAY_MS };
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith('--')) {
      if (options.snapshotDir) throw new Error(`unexpected positional argument ${token}`);
      options.snapshotDir = token;
      continue;
    }
    const value = values[index + 1];
    if (value === undefined) throw new Error(`${token} requires a value`);
    index += 1;
    if (token === '--base-url') options.baseUrl = value;
    else if (token === '--delay-ms') options.delayMs = parseNonNegativeInteger(value, token);
    else throw new Error(`unknown option ${token}`);
  }
  if (!options.snapshotDir) throw new Error('snapshot directory is required');
  return options;
}

export async function runCli(args, {
  client,
  minimumSampleSize,
  now,
  stdout = process.stdout,
} = {}) {
  const options = parseCliArgs(args);
  const report = await verifySample({
    ...options,
    client,
    minimumSampleSize,
    now,
  });
  stdout.write(`${JSON.stringify({
    status: report.status,
    selected: report.selectedCount,
    mismatches: report.reasons.length,
  })}\n`);
  return report.status === 'complete' ? 0 : 1;
}

async function main() {
  process.exitCode = await runCli(process.argv.slice(2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
