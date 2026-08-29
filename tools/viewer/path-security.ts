import { realpath, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';

export type SafeMarkdownPath = {
  relativePath: string;
  resolvedPath: string;
};

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep));
}

function hasUnsafeSegment(path: string): boolean {
  return path.split(/[\\/]/).some((segment) => segment === '.' || segment === '..' || segment.startsWith('.'));
}

export async function resolveSafeMarkdownPath(root: string, requestedPath: string): Promise<SafeMarkdownPath | null> {
  if (typeof requestedPath !== 'string') return null;
  const safe = requestedPath.replace(/^\/+/, '');
  if (!safe || extname(safe).toLowerCase() !== '.md' || hasUnsafeSegment(safe)) return null;

  const lexicalRoot = resolve(root);
  const lexicalTarget = resolve(lexicalRoot, safe);
  const lexicalRelative = relative(lexicalRoot, lexicalTarget);
  if (!lexicalRelative || !isInside(lexicalRoot, lexicalTarget)) return null;

  try {
    const [resolvedRoot, resolvedTarget] = await Promise.all([
      realpath(lexicalRoot),
      realpath(lexicalTarget),
    ]);
    if (!isInside(resolvedRoot, resolvedTarget)) return null;
    if (!(await stat(resolvedTarget)).isFile()) return null;
    return {
      relativePath: lexicalRelative.split(sep).join('/'),
      resolvedPath: resolvedTarget,
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error
      && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null;
    throw error;
  }
}
