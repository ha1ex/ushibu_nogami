#!/usr/bin/env node
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import operations from '../assets/data/operations.json' with { type: 'json' };
import { convertV3, deriveAllowedKeys } from '../lib/state-core.js';

function argumentsFrom(argv) {
  const result = { input: null, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option !== '--input' && option !== '--output') throw new Error(`Неизвестный аргумент: ${option}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Для ${option} нужен путь`);
    const name = option.slice(2);
    if (result[name] !== null) throw new Error(`Аргумент ${option} указан повторно`);
    result[name] = value;
    index += 1;
  }
  if (!result.input) throw new Error('Укажите --input /явный/путь/team-v3.json');
  return result;
}

async function main() {
  const args = argumentsFrom(process.argv.slice(2));
  const inputPath = path.resolve(args.input);
  const inputRealPath = await realpath(inputPath);
  const source = JSON.parse(await readFile(inputRealPath, 'utf8'));
  const converted = convertV3(source, deriveAllowedKeys(operations));
  const output = { preview: converted.document, report: converted.report };

  if (args.output) {
    const outputPath = path.resolve(args.output);
    if (outputPath === inputPath || outputPath === inputRealPath) throw new Error('Output не может совпадать с input');
    await writeFile(outputPath, JSON.stringify(converted.document, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    output.output = outputPath;
  }
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

main().catch((error) => {
  process.stderr.write(`Миграция не выполнена: ${error.message}\n`);
  process.exitCode = 1;
});
