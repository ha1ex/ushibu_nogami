import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateManifest,
  renderClaudeConfig,
  renderCodexConfig,
  syncConfigs,
} from './config.mjs';

const fixture = {
  version: 1,
  servers: [{
    name: 'kb-local',
    command: 'sh',
    args: ['-lc', 'cd "$(git rev-parse --show-toplevel)" && exec node scripts/semantic/mcp-server.mjs'],
    description: 'KB tools',
  }],
};

async function createAdapterRoot(manifest = fixture) {
  const root = await mkdtemp(join(tmpdir(), 'agent-config-'));
  await mkdir(join(root, 'agent-config'), { recursive: true });
  await mkdir(join(root, '.codex'), { recursive: true });
  await writeFile(join(root, 'agent-config/mcp-servers.json'), JSON.stringify(manifest));
  await writeFile(join(root, '.mcp.json'), 'stale claude\n');
  await writeFile(join(root, '.codex/config.toml'), 'stale codex\n');
  return root;
}

async function readAdapters(root) {
  return Promise.all([
    readFile(join(root, '.mcp.json'), 'utf8'),
    readFile(join(root, '.codex/config.toml'), 'utf8'),
  ]);
}

test('renders a Claude project MCP map', () => {
  assert.equal(renderClaudeConfig(fixture), '{\n  "mcpServers": {\n    "kb-local": {\n      "command": "sh",\n      "args": [\n        "-lc",\n        "cd \\"$(git rev-parse --show-toplevel)\\" && exec node scripts/semantic/mcp-server.mjs"\n      ],\n      "description": "KB tools"\n    }\n  }\n}\n');
});

test('renders a Codex project MCP table', () => {
  assert.equal(renderCodexConfig(fixture), '# Generated from agent-config/mcp-servers.json. Do not edit.\n\n[mcp_servers.kb-local]\ncommand = "sh"\nargs = ["-lc", "cd \\"$(git rev-parse --show-toplevel)\\" && exec node scripts/semantic/mcp-server.mjs"]\nstartup_timeout_sec = 30\ntool_timeout_sec = 120\n');
});

test('rejects duplicate server names before writing', () => {
  assert.throws(() => validateManifest({ version: 1, servers: [fixture.servers[0], fixture.servers[0]] }), /duplicate.*kb-local/i);
});

test('check mode reports adapter drift without overwriting it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-config-'));
  await mkdir(join(root, 'agent-config'), { recursive: true });
  await mkdir(join(root, '.codex'), { recursive: true });
  await writeFile(join(root, 'agent-config/mcp-servers.json'), JSON.stringify(fixture));
  await writeFile(join(root, '.mcp.json'), 'stale\n');
  await writeFile(join(root, '.codex/config.toml'), 'stale\n');
  const result = await syncConfigs({ root, write: false });
  assert.deepEqual(result.drift, ['.mcp.json', '.codex/config.toml']);
  assert.equal(await readFile(join(root, '.mcp.json'), 'utf8'), 'stale\n');
});

test('write mode replaces both stale adapters from the manifest', async () => {
  const root = await createAdapterRoot();
  const result = await syncConfigs({ root, write: true });
  assert.deepEqual(result.drift, ['.mcp.json', '.codex/config.toml']);
  assert.deepEqual(await readAdapters(root), [renderClaudeConfig(fixture), renderCodexConfig(fixture)]);
});

test('invalid manifest leaves both stale adapters unchanged in write mode', async () => {
  const invalidManifest = { version: 1, servers: [fixture.servers[0], fixture.servers[0]] };
  const root = await createAdapterRoot(invalidManifest);
  await assert.rejects(syncConfigs({ root, write: true }), /duplicate.*kb-local/i);
  assert.deepEqual(await readAdapters(root), ['stale claude\n', 'stale codex\n']);
});

test('rejects names that cannot be rendered as TOML bare keys', () => {
  for (const name of ['foo.bar', 'with space', 'bad]name']) {
    assert.throws(
      () => validateManifest({ version: 1, servers: [{ ...fixture.servers[0], name }] }),
      /name.*TOML/i,
    );
  }
});

test('restores both adapters when the second promotion fails', async () => {
  const root = await createAdapterRoot();
  let renameCalls = 0;
  const fileSystem = {
    mkdir,
    readFile,
    writeFile,
    rename: async (...args) => {
      renameCalls += 1;
      if (renameCalls === 4) throw new Error('second promotion failed');
      return rename(...args);
    },
    rm,
  };

  await assert.rejects(syncConfigs({ root, write: true, fileSystem }), /second promotion failed/);
  assert.deepEqual(await readAdapters(root), ['stale claude\n', 'stale codex\n']);
});
