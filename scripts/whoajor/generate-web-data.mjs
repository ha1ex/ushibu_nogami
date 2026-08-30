#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultCanonicalSource, generateWebData } from './lib/web-data.mjs';

export async function runGenerateWebDataCli(args) {
  const values = args[0] === '--' ? args.slice(1) : args;
  let outputDir;
  let sourceGzip;
  let recommendationPath;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === '--output') outputDir = values[++index];
    else if (values[index] === '--source') sourceGzip = values[++index];
    else if (values[index] === '--recommendations') recommendationPath = values[++index];
    else throw new Error(`unknown argument: ${values[index]}`);
  }
  if (!outputDir) throw new Error('usage: generate-web-data --output <dir> [--source <sqlite.gz>]');
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '..', '..');
  return generateWebData({
    outputDir: resolve(outputDir),
    sourceGzip: resolve(sourceGzip ?? defaultCanonicalSource(repoRoot)),
    recommendationPath: recommendationPath ? resolve(recommendationPath) : undefined,
  });
}

async function main() {
  const result = await runGenerateWebDataCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify({
    version: result.current.version,
    root: result.current.root,
    counts: result.manifest.counts,
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
