import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

const defaultFileSystem = { mkdir, readFile, writeFile, rename, rm };
const tomlBareKey = /^[A-Za-z0-9_-]+$/;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(message) {
  throw new TypeError(`Invalid MCP manifest: ${message}`);
}

export function validateManifest(value) {
  if (!isPlainObject(value)) invalid('manifest must be a plain object');
  if (value.version !== 1) invalid('version must be 1');
  if (!Array.isArray(value.servers)) invalid('servers must be an array');

  const names = new Set();
  for (const [index, server] of value.servers.entries()) {
    if (!isPlainObject(server)) invalid(`server ${index} must be a plain object`);
    if (typeof server.name !== 'string' || server.name.trim() === '') {
      invalid(`server ${index} must have a non-empty name`);
    }
    if (!tomlBareKey.test(server.name)) {
      invalid(`server ${server.name} name must be a TOML bare key`);
    }
    if (names.has(server.name)) invalid(`duplicate server name: ${server.name}`);
    names.add(server.name);
    if (typeof server.command !== 'string' || server.command.trim() === '') {
      invalid(`server ${server.name} must have a non-empty command`);
    }
    if (!Array.isArray(server.args) || server.args.some((arg) => typeof arg !== 'string' || arg.trim() === '')) {
      invalid(`server ${server.name} args must be an array of non-empty strings`);
    }
    if (typeof server.description !== 'string' || server.description.trim() === '') {
      invalid(`server ${server.name} must have a non-empty description`);
    }
  }

  return value;
}

export function renderClaudeConfig(manifest) {
  validateManifest(manifest);
  return `${JSON.stringify({
    mcpServers: Object.fromEntries(manifest.servers.map(({ name, command, args, description }) => [
      name,
      { command, args, description },
    ])),
  }, null, 2)}\n`;
}

function tomlString(value) {
  return JSON.stringify(value);
}

export function renderCodexConfig(manifest) {
  validateManifest(manifest);
  const tables = manifest.servers.map((server) => [
    `[mcp_servers.${server.name}]`,
    `command = ${tomlString(server.command)}`,
    `args = [${server.args.map(tomlString).join(', ')}]`,
    'startup_timeout_sec = 30',
    'tool_timeout_sec = 120',
  ].join('\n'));
  return `# Generated from agent-config/mcp-servers.json. Do not edit.\n\n${tables.join('\n\n')}\n`;
}

async function removeTemporaryFiles(files, fileSystem) {
  await Promise.all(files.map(async ({ temporary }) => {
    try {
      await fileSystem.rm(temporary, { force: true });
    } catch {
      // A failed cleanup must not mask the write or rollback error.
    }
  }));
}

async function writeAtomically(files, fileSystem) {
  try {
    await Promise.all(files.map(({ temporary, content }) => fileSystem.writeFile(temporary, content)));

    for (const file of files) {
      if (file.current === undefined) continue;
      await fileSystem.rename(file.destination, file.backup);
      file.backedUp = true;
    }

    for (const file of files) {
      await fileSystem.rename(file.temporary, file.destination);
      file.promoted = true;
    }

    await Promise.all(files
      .filter(({ backedUp }) => backedUp)
      .map(({ backup }) => fileSystem.rm(backup)));
  } catch (error) {
    await Promise.allSettled(files
      .filter(({ promoted }) => promoted)
      .reverse()
      .map(({ destination }) => fileSystem.rm(destination, { force: true })));
    await Promise.allSettled(files
      .filter(({ backedUp }) => backedUp)
      .reverse()
      .map(({ backup, destination }) => fileSystem.rename(backup, destination)));
    throw error;
  } finally {
    await removeTemporaryFiles(files, fileSystem);
  }
}

export async function syncConfigs({ root, write, fileSystem = defaultFileSystem }) {
  const manifest = validateManifest(JSON.parse(await fileSystem.readFile(join(root, 'agent-config/mcp-servers.json'), 'utf8')));
  const expected = new Map([
    ['.mcp.json', renderClaudeConfig(manifest)],
    ['.codex/config.toml', renderCodexConfig(manifest)],
  ]);
  const drift = [];

  for (const [path, content] of expected) {
    let current;
    try {
      current = await fileSystem.readFile(join(root, path), 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (current !== content) drift.push(path);
  }

  if (write && drift.length > 0) {
    await fileSystem.mkdir(join(root, '.codex'), { recursive: true });
    const token = `${process.pid}-${Date.now()}`;
    const files = drift.map((path, index) => {
      const destination = join(root, path);
      return {
        content: expected.get(path),
        current: undefined,
        destination,
        temporary: `${destination}.tmp-${token}-${index}`,
        backup: `${destination}.bak-${token}-${index}`,
      };
    });

    for (const file of files) {
      try {
        file.current = await fileSystem.readFile(file.destination, 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    await writeAtomically(files, fileSystem);
  }

  return { drift };
}
