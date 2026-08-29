#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reportHookError } from '../lib/journal.mjs';
import { extractChangedPaths, validateWrittenPaths } from './write-guard-lib.mjs';

function gitRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

const raw = readFileSync(0, 'utf8');
if (!raw.trim()) process.exit(0);

let event;
try {
  event = JSON.parse(raw);
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new TypeError('hook event must be an object');
} catch (error) {
  await reportHookError('write-guard', error);
  process.exit(0);
}

try {
  const root = resolve(gitRoot());
  const cwd = typeof event.cwd === 'string' ? event.cwd : root;
  const paths = extractChangedPaths(event, { cwd, root });
  if (paths.length === 0) process.exit(0);

  const result = await validateWrittenPaths(paths, { root });
  if (!result.passed) {
    process.stderr.write(`${result.diagnostics}\n`);
    process.exit(2);
  }
} catch (error) {
  await reportHookError('write-guard', error);
}
