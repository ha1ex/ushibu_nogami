import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import { auditRepository } from './repository-check.mjs';
import { discoverEvals, listSkillsWithEvals, readSkillFile } from '../skillopt/evals/loader.mjs';

const sharedSkills = ['kb-ingest', 'decision-log', 'interviewer-agent'];
const fixtureRoots = [];
const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const claudeSession = 'node "$CLAUDE_PROJECT_DIR/scripts/session-start-context.mjs"';
const claudeGuard = 'node "$CLAUDE_PROJECT_DIR/scripts/agent/write-guard.mjs"';
const codexSession = 'node "$(git rev-parse --show-toplevel)/scripts/session-start-context.mjs"';
const codexGuard = 'node "$(git rev-parse --show-toplevel)/scripts/agent/write-guard.mjs"';
const requiredClaudeAllow = [
  'Bash(corepack pnpm run setup:*)',
  'Bash(corepack pnpm kb:*)',
  'Bash(corepack pnpm agent:*)',
  'Bash(corepack pnpm viewer:*)',
  'Bash(corepack pnpm skill:*)',
];
const validConductorSettings = `"$schema" = "https://conductor.build/schemas/settings.repo.schema.json"

[scripts]
setup = "corepack pnpm run setup && corepack pnpm kb:index && git config core.hooksPath scripts/git-hooks"
run_mode = "concurrent"

[scripts.run.viewer]
available_in = ["local"]
command = "VIEWER_PORT=$CONDUCTOR_PORT VITE_PORT=$((CONDUCTOR_PORT + 1)) corepack pnpm viewer:dev"
default = true
icon = "play"

[scripts.run.check]
available_in = ["local", "cloud"]
command = "corepack pnpm kb:check"
icon = "test-tube"
`;
const validRootPackage = {
  scripts: {
    setup: 'corepack pnpm -C scripts/semantic install --frozen-lockfile && corepack pnpm -C scripts/skillopt install --frozen-lockfile && corepack pnpm -C tools/viewer install --frozen-lockfile && corepack pnpm -C scripts/whoajor install --frozen-lockfile',
    'agent:test': 'node --test scripts/agent/test-config.mjs scripts/agent/test-write-guard.mjs scripts/agent/test-repository-check.mjs scripts/agent/test-kb-init.mjs',
    'agent:check': 'node scripts/agent/sync-config.mjs --check',
    'viewer:dev': 'corepack pnpm -C tools/viewer dev',
    'viewer:test': 'corepack pnpm -C tools/viewer test',
    'viewer:build': 'corepack pnpm -C tools/viewer build',
    'kb:check': 'corepack pnpm agent:test && corepack pnpm agent:check && corepack pnpm viewer:test && node scripts/semantic/test-retrieval.mjs && node scripts/semantic/test-control.mjs && node scripts/semantic/test-gate.mjs && node scripts/kb-doctor.mjs && node scripts/semantic/verify.mjs --scan --provenance --no-semantic',
  },
};
const validViewerPackage = {
  scripts: {
    dev: 'concurrently -n server,client -c blue,magenta "corepack pnpm dev:server" "corepack pnpm dev:client"',
    test: 'tsx --test ./*.test.ts',
  },
};
const validPrePush = `#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
corepack pnpm kb:check
`;
const validWorkflow = `name: fixture
jobs:
  check:
    steps:
      - name: Run deterministic quality gate
        run: corepack pnpm kb:check
      - name: Verify Corepack bootstrap without recursion
        run: node --test scripts/agent/test-corepack-bootstrap.mjs
`;
const validMcpManifest = {
  version: 1,
  servers: [{
    name: 'skillopt-local',
    command: 'node',
    args: ['scripts/skillopt/mcp-server.mjs'],
    description: 'Мутации выполняются через CLI: corepack pnpm skill <verb>.',
  }],
};

function withConductorSettings(transform) {
  return transform(validConductorSettings);
}

test.after(async () => {
  await Promise.all(fixtureRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function write(root, path, content) {
  const destination = join(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

async function linkSharedSkills(root) {
  for (const skill of sharedSkills) {
    await write(root, `skills/${skill}/SKILL.md`, `---\nname: ${skill}\ndescription: fixture\n---\n`);
    for (const host of ['.claude', '.agents']) {
      await mkdir(join(root, host, 'skills'), { recursive: true });
      await symlink(`../../skills/${skill}`, join(root, host, 'skills', skill));
    }
  }
}

async function replaceHostSkillWithCopy(root, host, skill) {
  await rm(join(root, host, 'skills', skill));
  await write(root, `${host}/skills/${skill}/SKILL.md`, `---\nname: ${skill}\ndescription: divergent copy\n---\n`);
}

async function makeFixture({
  claude = '<!-- adapter -->\n\n@AGENTS.md\n',
  agentRule = 'Работай в текущей ветке. Не пушь в main автоматически.',
  claudeSettings,
  codexHooks,
  linkSkills = true,
  conductorSettings = validConductorSettings,
  rootPackage = validRootPackage,
  viewerPackage = validViewerPackage,
  prePush = validPrePush,
  harness = { version: 1, level: 2 },
  mcpManifest = validMcpManifest,
  workflows = { ci: validWorkflow, kbCi: validWorkflow },
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'repository-check-'));
  fixtureRoots.push(root);
  await write(root, 'AGENTS.md', `${agentRule}\n`);
  await write(root, 'CLAUDE.md', claude);
  await write(root, '.claude/settings.json', JSON.stringify(claudeSettings ?? {
    permissions: { allow: requiredClaudeAllow },
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: claudeSession, timeout: 10 }] }],
      PostToolUse: [{ matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: claudeGuard, timeout: 10 }] }],
    },
  }));
  await write(root, '.codex/hooks.json', JSON.stringify(codexHooks ?? {
    hooks: {
      SessionStart: [{ matcher: '^(startup|resume|clear|compact)$', hooks: [{ type: 'command', command: codexSession, timeout: 10 }] }],
      PostToolUse: [{ matcher: 'apply_patch|Edit|Write', hooks: [{ type: 'command', command: codexGuard, timeout: 10 }] }],
    },
  }));
  if (harness !== null) await write(root, 'agent-config/harness.json', `${JSON.stringify(harness, null, 2)}\n`);
  if (mcpManifest !== null) await write(root, 'agent-config/mcp-servers.json', `${JSON.stringify(mcpManifest, null, 2)}\n`);
  if (conductorSettings !== null) {
    await write(root, '.conductor/settings.toml', conductorSettings);
  }
  await write(root, 'package.json', JSON.stringify(rootPackage));
  await write(root, 'tools/viewer/package.json', JSON.stringify(viewerPackage));
  await write(root, 'scripts/git-hooks/pre-push', prePush);
  if (workflows?.ci !== null) await write(root, '.github/workflows/ci.yml', workflows.ci);
  if (workflows?.kbCi !== null) await write(root, '.github/workflows/kb-ci.yml', workflows.kbCi);
  if (linkSkills) await linkSharedSkills(root);
  return root;
}

test('rejects missing and malformed harness level manifests', async (t) => {
  const cases = [
    { name: 'missing', harness: null },
    { name: 'extra key', harness: { version: 1, level: 2, extra: true } },
    { name: 'wrong version', harness: { version: 2, level: 2 } },
    { name: 'out of range', harness: { version: 1, level: 4 } },
    { name: 'non-integer', harness: { version: 1, level: 1.5 } },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const root = await makeFixture({ harness: fixture.harness });
      const result = await auditRepository(root);
      assert.equal(result.passed, false);
      assert.match(result.errors.join('\n'), /agent-config\/harness\.json.*version.*level|harness manifest/i);
    });
  }
});

test('accepts level 1 without common PostToolUse guards or CI workflows', async () => {
  const root = await makeFixture({
    harness: { version: 1, level: 1 },
    workflows: { ci: null, kbCi: null },
    claudeSettings: {
      permissions: { allow: requiredClaudeAllow },
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: claudeSession, timeout: 10 }] }],
        PostToolUse: [{ matcher: 'NotebookEdit', hooks: [{ command: 'node scripts/other-hook.mjs' }] }],
      },
    },
    codexHooks: {
      hooks: {
        SessionStart: [{ matcher: '^(startup|resume|clear|compact)$', hooks: [{ type: 'command', command: codexSession, timeout: 10 }] }],
        PostToolUse: [{ matcher: 'custom_tool', hooks: [{ command: 'node scripts/other-hook.mjs' }] }],
      },
    },
  });

  assert.deepEqual(await auditRepository(root), { passed: true, errors: [] });
});

test('rejects common PostToolUse guards at levels below 2', async () => {
  const root = await makeFixture({ harness: { version: 1, level: 0 }, workflows: { ci: null, kbCi: null } });
  const result = await auditRepository(root);

  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /level 0.*PostToolUse.*absent/i);
});

test('rejects a missing canonical PostToolUse guard at level 2', async () => {
  const root = await makeFixture({
    codexHooks: {
      hooks: {
        SessionStart: [{ matcher: '^(startup|resume|clear|compact)$', hooks: [{ command: codexSession }] }],
        PostToolUse: [{ matcher: 'custom_tool', hooks: [{ command: 'node scripts/other-hook.mjs' }] }],
      },
    },
  });
  const result = await auditRepository(root);

  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /Codex.*canonical PostToolUse/i);
});

test('rejects stale bare-pnpm Claude permissions and accepts required Corepack workflows', async () => {
  const root = await makeFixture({
    claudeSettings: {
      permissions: {
        allow: ['Bash(pnpm run setup:*)', 'Bash(pnpm kb:*)'],
      },
      hooks: {
        SessionStart: [{ hooks: [{ command: claudeSession }] }],
        PostToolUse: [{ matcher: 'Write|Edit|MultiEdit', hooks: [{ command: claudeGuard }] }],
      },
    },
  });

  const result = await auditRepository(root);
  const errors = result.errors.join('\n');
  assert.equal(result.passed, false);
  assert.match(errors, /Claude permissions.*bare pnpm/i);
  assert.match(errors, /corepack pnpm run setup/i);
  assert.match(errors, /corepack pnpm agent/i);
  assert.match(errors, /corepack pnpm viewer/i);
  assert.match(errors, /corepack pnpm skill/i);
});

test('rejects a bare pnpm SkillOpt command in the shared MCP description', async () => {
  const root = await makeFixture({
    mcpManifest: {
      ...validMcpManifest,
      servers: [{
        ...validMcpManifest.servers[0],
        description: 'Мутации выполняются через CLI: pnpm skill <verb>.',
      }],
    },
  });

  const result = await auditRepository(root);
  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /skillopt-local.*corepack pnpm skill/i);
});

test('rejects non-canonical SessionStart quoting and a Codex matcher missing clear', async () => {
  const root = await makeFixture({
    claudeSettings: {
      permissions: { allow: requiredClaudeAllow },
      hooks: {
        SessionStart: [{ hooks: [{ command: 'node $CLAUDE_PROJECT_DIR/scripts/session-start-context.mjs' }] }],
        PostToolUse: [{ matcher: 'Write|Edit|MultiEdit', hooks: [{ command: claudeGuard }] }],
      },
    },
    codexHooks: {
      hooks: {
        SessionStart: [{ matcher: 'startup|resume|compact', hooks: [{ command: codexSession }] }],
        PostToolUse: [{ matcher: 'apply_patch|Edit|Write', hooks: [{ command: codexGuard }] }],
      },
    },
  });

  const result = await auditRepository(root);
  const errors = result.errors.join('\n');
  assert.equal(result.passed, false);
  assert.match(errors, /Claude SessionStart.*exact.*CLAUDE_PROJECT_DIR/i);
  assert.match(errors, /Codex SessionStart.*clear/i);
});

test('the repository Claude SessionStart command executes when the project path contains spaces', async () => {
  const settings = JSON.parse(await readFile(join(projectRoot, '.claude/settings.json'), 'utf8'));
  const command = settings.hooks.SessionStart[0].hooks[0].command;
  const spacedRoot = await mkdtemp(join(tmpdir(), 'claude project with spaces-'));
  fixtureRoots.push(spacedRoot);
  await write(spacedRoot, 'scripts/session-start-context.mjs', 'process.stdout.write("session-ok");\n');

  const result = await execFileAsync('sh', ['-c', command], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: spacedRoot },
  });

  assert.equal(result.stdout, 'session-ok');
});

test('rejects recursive or incomplete permanent gate scripts', async () => {
  const root = await makeFixture({
    rootPackage: {
      scripts: {
        ...validRootPackage.scripts,
        'agent:test': 'node --test scripts/agent/*.mjs scripts/agent/test-corepack-bootstrap.mjs',
        'kb:check': 'corepack pnpm agent:check',
      },
    },
  });
  const result = await auditRepository(root);
  const errors = result.errors.join('\n');

  assert.equal(result.passed, false);
  assert.match(errors, /agent:test.*explicit.*test-corepack-bootstrap/i);
  assert.match(errors, /kb:check.*agent:test.*viewer:test/i);
});

test('rejects CI without a separate Corepack bootstrap test step', async () => {
  const root = await makeFixture({
    workflows: {
      ci: 'steps:\n  - run: corepack pnpm kb:check\n',
      kbCi: validWorkflow,
    },
  });
  const result = await auditRepository(root);

  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /ci\.yml.*test-corepack-bootstrap\.mjs.*separate/i);
});

test('rejects missing shared Conductor settings with an actionable error', async () => {
  const root = await makeFixture({ conductorSettings: null });

  const result = await auditRepository(root);

  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /shared Conductor settings are missing.*\.conductor\/settings\.toml/i);
});

test('rejects an invalid Conductor bootstrap and run contract', async () => {
  const root = await makeFixture({
    conductorSettings: `"$schema" = "https://example.com/wrong-schema.json"
[scripts]
setup = "pnpm install"
run_mode = "nonconcurrent"
[scripts.run.viewer]
available_in = ["cloud"]
command = "pnpm viewer:dev"
[scripts.run.check]
available_in = ["local"]
command = "pnpm test"
`,
    rootPackage: { scripts: { setup: 'pnpm install' } },
  });

  const result = await auditRepository(root);
  const errors = result.errors.join('\n');

  assert.equal(result.passed, false);
  assert.match(errors, /repository settings schema/i);
  assert.match(errors, /Conductor setup.*corepack pnpm run setup.*kb:index.*hooksPath/i);
  assert.match(errors, /root setup.*four frozen-lockfile installs/i);
  assert.match(errors, /run_mode.*concurrent/i);
  assert.match(errors, /viewer.*available_in.*local/i);
  assert.match(errors, /viewer.*CONDUCTOR_PORT.*VITE_PORT/i);
  assert.match(errors, /check.*available_in.*local.*cloud/i);
  assert.match(errors, /check.*corepack pnpm kb:check/i);
});

test('rejects trailing garbage in shared Conductor settings', async () => {
  const root = await makeFixture({
    conductorSettings: withConductorSettings((settings) => `${settings}\nthis is not TOML\n`),
  });

  const result = await auditRepository(root);

  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /canonical Conductor repository contract/i);
});

test('rejects duplicate Conductor keys even when the last value is valid', async () => {
  const root = await makeFixture({
    conductorSettings: withConductorSettings((settings) => settings.replace(
      'setup = "corepack pnpm run setup',
      'setup = "pnpm install"\nsetup = "corepack pnpm run setup',
    )),
  });

  const result = await auditRepository(root);

  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /canonical Conductor repository contract/i);
});

test('rejects malformed TOML quotes and arrays', async (t) => {
  for (const malformedLine of ['broken = "unterminated', 'broken = ["local"']) {
    await t.test(malformedLine, async () => {
      const root = await makeFixture({
        conductorSettings: withConductorSettings((settings) => `${settings}\n${malformedLine}\n`),
      });

      const result = await auditRepository(root);

      assert.equal(result.passed, false);
      assert.match(result.errors.join('\n'), /canonical Conductor repository contract/i);
    });
  }
});

test('allows comments without weakening the canonical Conductor contract', async () => {
  const root = await makeFixture({
    conductorSettings: withConductorSettings((settings) => settings
      .replace('[scripts]', '# shared bootstrap\n[scripts]')
      .replace('run_mode = "concurrent"', 'run_mode = "concurrent" # isolated ports')),
  });

  const result = await auditRepository(root);

  assert.deepEqual(result, { passed: true, errors: [] });
});

test('rejects TOML-disallowed controls before whitespace and comment normalization', async (t) => {
  const cases = [
    { name: 'standalone vertical tab', settings: `${validConductorSettings}\u000b` },
    { name: 'vertical tab inside comment', settings: `${validConductorSettings}# comment\u000b\n` },
    { name: 'form feed inside comment', settings: `${validConductorSettings}# comment\u000c\n` },
    { name: 'lone carriage return', settings: `${validConductorSettings}# comment\r` },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const root = await makeFixture({ conductorSettings: fixture.settings });

      const result = await auditRepository(root);

      assert.equal(result.passed, false);
      assert.match(result.errors.join('\n'), /invalid TOML lexical input/i);
    });
  }
});

test('allows CRLF plus TOML space and tab around comments', async () => {
  const root = await makeFixture({
    conductorSettings: validConductorSettings
      .replace('[scripts]', '\t# comment with tab\n\t[scripts]\t')
      .replaceAll('\n', '\r\n'),
  });

  const result = await auditRepository(root);

  assert.deepEqual(result, { passed: true, errors: [] });
});

test('rejects a syntactically valid near-match outside the bounded Conductor contract', async () => {
  const root = await makeFixture({
    conductorSettings: withConductorSettings((settings) => settings.replace('default = true', 'default = false')),
  });

  const result = await auditRepository(root);

  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /canonical Conductor repository contract/i);
});

test('rejects nested package and hook commands that require a global pnpm shim', async () => {
  const root = await makeFixture({
    rootPackage: {
      scripts: {
        ...validRootPackage.scripts,
        'viewer:test': 'pnpm -C tools/viewer exec tsx --test ports.test.ts',
        'kb:check': 'pnpm agent:check',
      },
    },
    viewerPackage: {
      scripts: { dev: 'concurrently "pnpm dev:server" "pnpm dev:client"' },
    },
    prePush: '#!/usr/bin/env bash\npnpm kb:check\n',
  });

  const result = await auditRepository(root);
  const errors = result.errors.join('\n');

  assert.equal(result.passed, false);
  assert.match(errors, /viewer:test.*Corepack/i);
  assert.match(errors, /kb:check.*Corepack/i);
  assert.match(errors, /viewer dev.*Corepack/i);
  assert.match(errors, /pre-push.*Corepack/i);
});

test('rejects split instructions and divergent shared skills', async () => {
  const root = await makeFixture({
    claude: '# local rules\n',
    agentRule: 'git push origin HEAD:main',
  });
  await replaceHostSkillWithCopy(root, '.claude', 'kb-ingest');

  const result = await auditRepository(root);

  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /@AGENTS\.md/);
  assert.match(result.errors.join('\n'), /automatic main push/i);
  assert.match(result.errors.join('\n'), /kb-ingest.*Claude.*Codex/i);
});

test('rejects a missing required hook reference in either host adapter', async () => {
  const root = await makeFixture({
    codexHooks: {
      hooks: {
        SessionStart: [{ hooks: [{ command: 'node scripts/other-context.mjs' }] }],
        PostToolUse: [{ hooks: [{ command: 'node scripts/agent/write-guard.mjs' }] }],
      },
    },
  });

  const result = await auditRepository(root);

  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /Codex.*session-start-context\.mjs/i);
});

test('rejects hooks when the required scripts are swapped between lifecycle events', async () => {
  const root = await makeFixture({
    claudeSettings: {
      hooks: {
        SessionStart: [{ hooks: [{ command: 'node scripts/agent/write-guard.mjs' }] }],
        PostToolUse: [{ hooks: [{ command: 'node scripts/session-start-context.mjs' }] }],
      },
    },
  });

  const result = await auditRepository(root);

  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /Claude.*SessionStart.*session-start-context\.mjs/i);
  assert.match(result.errors.join('\n'), /Claude.*PostToolUse.*write-guard\.mjs/i);
});

test('rejects hooks found only in one lifecycle or outside the hooks object', async () => {
  const root = await makeFixture({
    codexHooks: {
      hooks: {
        SessionStart: [{ hooks: [
          { command: 'node scripts/session-start-context.mjs' },
          { command: 'node scripts/agent/write-guard.mjs' },
        ] }],
        PostToolUse: [],
      },
      ignored: { command: 'node scripts/agent/write-guard.mjs' },
    },
  });

  const result = await auditRepository(root);

  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /Codex.*PostToolUse.*write-guard\.mjs/i);
});

test('rejects a hook command whose filename merely contains the expected script name', async () => {
  const root = await makeFixture({
    codexHooks: {
      hooks: {
        SessionStart: [{ hooks: [{ command: 'node scripts/session-start-context.mjs' }] }],
        PostToolUse: [{ hooks: [{ command: 'node scripts/agent/fake-write-guard.mjs' }] }],
      },
    },
  });

  const result = await auditRepository(root);

  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /Codex.*PostToolUse.*write-guard\.mjs/i);
});

test('rejects automatic main push even when an unrelated action is forbidden later', async (t) => {
  for (const agentRule of [
    'Всегда выполняй git push origin HEAD:main; force-push запрещён.',
    'Always run git push origin HEAD:main; never force-push.',
  ]) {
    await t.test(agentRule, async () => {
      const root = await makeFixture({ agentRule });

      const result = await auditRepository(root);

      assert.equal(result.passed, false);
      assert.match(result.errors.join('\n'), /automatic main push/i);
    });
  }
});

test('accepts an explicit prohibition immediately governing the main push command', async () => {
  const root = await makeFixture({
    agentRule: 'Не выполняй git push origin HEAD:main без явной команды пользователя.',
  });

  const result = await auditRepository(root);

  assert.deepEqual(result, { passed: true, errors: [] });
});

test('rejects every host skill that does not resolve to its canonical SKILL.md', async () => {
  const root = await makeFixture();
  await replaceHostSkillWithCopy(root, '.agents', 'decision-log');

  const result = await auditRepository(root);

  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /decision-log.*Claude.*Codex/i);
});

test('rejects missing, broken, and wrong-target shared skill links', async (t) => {
  const cases = [
    {
      name: 'missing link',
      mutate: (root) => rm(join(root, '.claude/skills/kb-ingest')),
    },
    {
      name: 'broken link',
      mutate: async (root) => {
        await rm(join(root, '.agents/skills/kb-ingest'));
        await symlink('../../skills/missing', join(root, '.agents/skills/kb-ingest'));
      },
    },
    {
      name: 'wrong-target link',
      mutate: async (root) => {
        await rm(join(root, '.claude/skills/kb-ingest'));
        await symlink('../../skills/decision-log', join(root, '.claude/skills/kb-ingest'));
      },
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const root = await makeFixture();
      await fixture.mutate(root);

      const result = await auditRepository(root);

      assert.equal(result.passed, false);
      assert.match(result.errors.join('\n'), /kb-ingest.*Claude.*Codex/i);
    });
  }
});

test('accepts one contract and all six host skills resolving to canonical files', async () => {
  const root = await makeFixture();

  for (const skill of sharedSkills) {
    const canonical = await realpath(join(root, 'skills', skill, 'SKILL.md'));
    for (const host of ['.claude', '.agents']) {
      assert.equal(await realpath(join(root, host, 'skills', skill, 'SKILL.md')), canonical);
    }
  }

  const result = await auditRepository(root);

  assert.deepEqual(result, { passed: true, errors: [] });
});

test('SkillOpt discovers canonical native SKILL.md files after the migration', async () => {
  const skills = await listSkillsWithEvals();
  const shared = new Map(skills.map((skill) => [skill.skill, skill]));

  assert.equal(shared.get('kb-ingest')?.skillFileExists, true);
  assert.equal(shared.get('decision-log')?.skillFileExists, true);
  assert.equal(shared.get('interviewer-agent')?.skillFileExists, true);
});

test('SkillOpt reads the canonical kb-ingest file and discovers its migrated evals', async () => {
  const skill = await readSkillFile('kb-ingest');
  const evals = await discoverEvals({ skillFilter: 'kb-ingest' });

  assert.equal(skill.path, 'skills/kb-ingest/SKILL.md');
  assert.match(skill.text, /^---\nname: kb-ingest\n/);
  assert.deepEqual(evals.map((item) => item.id).sort(), ['happy-path', 'no-fabrication']);
  assert.ok(evals.every((item) => !item.error));
  assert.ok(evals.every((item) => item.path.startsWith('skills/kb-ingest/evals/')));
});

test('SkillOpt retains legacy root-level skill discovery through an isolated seam', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillopt-legacy-'));
  fixtureRoots.push(root);
  const skillsDir = join(root, 'skills');
  await write(root, 'skills/legacy-skill.md', '# Legacy procedure\n');

  const listed = await listSkillsWithEvals({ skillsDir });
  const skill = await readSkillFile('legacy-skill', { skillsDir, repoRoot: root });

  assert.deepEqual(listed, [{ skill: 'legacy-skill', skillFileExists: true, caseCount: 0 }]);
  assert.equal(skill.path, 'skills/legacy-skill.md');
  assert.equal(skill.text, '# Legacy procedure\n');
});
