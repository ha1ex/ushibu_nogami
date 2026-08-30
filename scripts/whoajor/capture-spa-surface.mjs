#!/usr/bin/env node
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { captureSpaSurfaceAssets } from './lib/spa-surface-audit.mjs';

export function parseCaptureSpaSurfaceArgs(args) {
  const values = args.filter((value) => value !== '--');
  const options = { delayMs: 250 };
  for (let index = 0; index < values.length; index += 1) {
    const option = values[index];
    if (!option.startsWith('--')) throw new Error(`unexpected positional argument ${option}`);
    const value = values[index + 1];
    if (value === undefined) throw new Error(`${option} requires a value`);
    index += 1;
    if (option === '--output') options.outputDir = value;
    else if (option === '--delay-ms') {
      const delayMs = Number(value);
      if (!Number.isInteger(delayMs) || delayMs < 0) {
        throw new Error('--delay-ms must be a non-negative integer');
      }
      options.delayMs = delayMs;
    } else throw new Error(`unknown option ${option}`);
  }
  if (!options.outputDir) throw new Error('--output is required');
  return options;
}

export async function runCaptureSpaSurfaceCli(args, {
  capture = captureSpaSurfaceAssets,
  stdout = process.stdout,
} = {}) {
  const options = parseCaptureSpaSurfaceArgs(args);
  const manifest = await capture({
    ...options,
    auditId: basename(options.outputDir),
  });
  stdout.write(`${JSON.stringify({
    status: 'captured',
    auditId: manifest.auditId,
    assets: manifest.assets.length,
    assetRootHash: manifest.assetRootHash,
  })}\n`);
  return manifest;
}

async function main() {
  await runCaptureSpaSurfaceCli(process.argv.slice(2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
