#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultCanonicalSource } from './lib/web-data.mjs';
import { verifyWebData } from './lib/verify-web-data.mjs';

export async function runVerifyWebDataCli(args) {
  const values = args[0] === '--' ? args.slice(1) : args;
  let outputDir;
  let sourceGzip;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === '--output') outputDir = values[++index];
    else if (values[index] === '--source') sourceGzip = values[++index];
    else throw new Error(`unknown argument: ${values[index]}`);
  }
  if (!outputDir) throw new Error('usage: verify-web-data --output <dir> [--source <sqlite.gz>]');
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '..', '..');
  return verifyWebData({
    outputDir: resolve(outputDir),
    sourceGzip: resolve(sourceGzip ?? defaultCanonicalSource(repoRoot)),
  });
}

async function main() {
  const receipt = await runVerifyWebDataCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
