import { readFile, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_VALIDATOR_PATHS = [
  resolve(here, '..', 'check-decisions.mjs'),
  resolve(here, '..', 'check-md-frontmatter.mjs'),
  resolve(here, '..', 'check-provenance.mjs'),
];

function isInside(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep));
}

function isSupportedPath(path, root) {
  const rel = relative(root, path);
  const portableRel = rel.split(sep).join('/');
  if (basename(path).startsWith('.env')) return false;
  if (/\.md$/i.test(path)) return true;
  return /^skills\/[^/]+\/evals\/[^/]+\.ya?ml$/i.test(portableRel);
}

function normalizePath(candidate, { cwd, root }) {
  if (typeof candidate !== 'string' || candidate.trim() === '') return null;
  const absolute = resolve(cwd, candidate);
  if (!isInside(root, absolute) || !isSupportedPath(absolute, root)) return null;
  return absolute;
}

function pathsFromPatch(command) {
  const paths = [];
  for (const line of command.split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (?:Update|Add|Delete) File:\s*(.+?)\s*$/)
      ?? line.match(/^\*\*\* Move to:\s*(.+?)\s*$/);
    if (match) paths.push(match[1]);
  }
  return paths;
}

/**
 * Extract allowed absolute changed paths from Claude Code and Codex hook events.
 * Paths are lexically contained in root; validateWrittenPaths additionally checks
 * real paths before reading any file.
 */
export function extractChangedPaths(event, { cwd = process.cwd(), root = process.cwd() } = {}) {
  if (!event || typeof event !== 'object') return [];
  const normalizedRoot = resolve(root);
  const normalizedCwd = resolve(cwd);
  const input = event.tool_input && typeof event.tool_input === 'object' ? event.tool_input : {};
  let candidates = [];

  if (/^(Write|Edit|MultiEdit)$/.test(event.tool_name) && typeof input.file_path === 'string') {
    candidates = [input.file_path];
  } else if (event.tool_name === 'apply_patch' && typeof input.command === 'string') {
    candidates = pathsFromPatch(input.command);
  }

  const seen = new Set();
  const paths = [];
  for (const candidate of candidates) {
    const path = normalizePath(candidate, { cwd: normalizedCwd, root: normalizedRoot });
    if (path && !seen.has(path)) {
      seen.add(path);
      paths.push(path);
    }
  }
  return paths;
}

function runValidator(validatorPath, payload, root) {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, [validatorPath], {
      cwd: root,
      env: { ...process.env, KB_ROOT: root },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      resolveResult({ status: 1, output: `${stderr}${stdout}${error.message}\n` });
    });
    child.once('close', (status) => {
      resolveResult({ status: status ?? 1, output: `${stderr}${stdout}` });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

/**
 * Validate final on-disk file text with all existing Write validators.
 * Deleted files and symlinks resolving outside root are deliberately skipped.
 */
export async function validateWrittenPaths(paths, { root = process.cwd(), validators = DEFAULT_VALIDATOR_PATHS } = {}) {
  const lexicalRoot = resolve(root);
  let realRoot;
  try {
    realRoot = await realpath(lexicalRoot);
  } catch {
    realRoot = lexicalRoot;
  }

  const diagnostics = [];
  for (const inputPath of Array.isArray(paths) ? paths : []) {
    const path = normalizePath(inputPath, { cwd: lexicalRoot, root: lexicalRoot });
    if (!path) continue;

    let realPath;
    try {
      realPath = await realpath(path);
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
    if (!isInside(realRoot, realPath)) continue;

    const content = await readFile(realPath, 'utf8');
    const payload = {
      tool_name: 'Write',
      tool_input: { file_path: path, content },
    };
    const activeValidators = Array.isArray(validators) ? validators : DEFAULT_VALIDATOR_PATHS;
    const results = await Promise.all(activeValidators.map((validatorPath) => runValidator(validatorPath, payload, realRoot)));
    for (const [index, result] of results.entries()) {
      if (result.status !== 0) {
        diagnostics.push(result.output.trim() || `validator ${basename(activeValidators[index])} exited ${result.status}`);
      }
    }
  }

  return { passed: diagnostics.length === 0, diagnostics: diagnostics.filter(Boolean).join('\n') };
}
