import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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

export async function syncConfigs({ root, write }) {
  const manifest = validateManifest(JSON.parse(await readFile(join(root, 'agent-config/mcp-servers.json'), 'utf8')));
  const expected = new Map([
    ['.mcp.json', renderClaudeConfig(manifest)],
    ['.codex/config.toml', renderCodexConfig(manifest)],
  ]);
  const drift = [];

  for (const [path, content] of expected) {
    let current;
    try {
      current = await readFile(join(root, path), 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (current !== content) drift.push(path);
  }

  if (write && drift.length > 0) {
    await mkdir(join(root, '.codex'), { recursive: true });
    await Promise.all(drift.map((path) => writeFile(join(root, path), expected.get(path))));
  }

  return { drift };
}
