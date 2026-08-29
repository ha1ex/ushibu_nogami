import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';

const sharedSkills = ['kb-ingest', 'decision-log', 'interviewer-agent'];
const hostAdapters = [
  { label: 'Claude', root: '.claude' },
  { label: 'Codex', root: '.agents' },
];
const conductorSchema = 'https://conductor.build/schemas/settings.repo.schema.json';
const conductorSetup = 'corepack pnpm run setup && corepack pnpm kb:index && git config core.hooksPath scripts/git-hooks';
const rootSetup = 'corepack pnpm -C scripts/semantic install --frozen-lockfile && corepack pnpm -C scripts/skillopt install --frozen-lockfile && corepack pnpm -C tools/viewer install --frozen-lockfile && corepack pnpm -C scripts/whoajor install --frozen-lockfile';
const viewerCommand = 'VIEWER_PORT=$CONDUCTOR_PORT VITE_PORT=$((CONDUCTOR_PORT + 1)) corepack pnpm viewer:dev';
const agentTest = 'node --test scripts/agent/test-config.mjs scripts/agent/test-write-guard.mjs scripts/agent/test-repository-check.mjs scripts/agent/test-kb-init.mjs';
const kbCheck = 'corepack pnpm agent:test && corepack pnpm agent:check && corepack pnpm viewer:test && node scripts/semantic/test-retrieval.mjs && node scripts/semantic/test-control.mjs && node scripts/semantic/test-gate.mjs && node scripts/kb-doctor.mjs && node scripts/semantic/verify.mjs --scan --provenance --no-semantic';
const rootExecutableScripts = {
  setup: rootSetup,
  'agent:test': agentTest,
  'agent:check': 'node scripts/agent/sync-config.mjs --check',
  'viewer:dev': 'corepack pnpm -C tools/viewer dev',
  'viewer:test': 'corepack pnpm -C tools/viewer test',
  'viewer:build': 'corepack pnpm -C tools/viewer build',
  'kb:check': kbCheck,
};
const viewerDev = 'concurrently -n server,client -c blue,magenta "corepack pnpm dev:server" "corepack pnpm dev:client"';
const viewerTest = 'tsx --test ./*.test.ts';
const claudeSessionCommand = 'node "$CLAUDE_PROJECT_DIR/scripts/session-start-context.mjs"';
const codexSessionCommand = 'node "$(git rev-parse --show-toplevel)/scripts/session-start-context.mjs"';
const canonicalPostToolUse = {
  Claude: {
    matcher: 'Write|Edit|MultiEdit',
    command: 'node "$CLAUDE_PROJECT_DIR/scripts/agent/write-guard.mjs"',
  },
  Codex: {
    matcher: 'apply_patch|Edit|Write',
    command: 'node "$(git rev-parse --show-toplevel)/scripts/agent/write-guard.mjs"',
  },
};
const requiredClaudePermissions = [
  'Bash(corepack pnpm run setup:*)',
  'Bash(corepack pnpm kb:*)',
  'Bash(corepack pnpm agent:*)',
  'Bash(corepack pnpm viewer:*)',
  'Bash(corepack pnpm skill:*)',
];
const canonicalConductorLines = [
  `"$schema" = "${conductorSchema}"`,
  '[scripts]',
  `setup = "${conductorSetup}"`,
  'run_mode = "concurrent"',
  '[scripts.run.viewer]',
  'available_in = ["local"]',
  `command = "${viewerCommand}"`,
  'default = true',
  'icon = "play"',
  '[scripts.run.check]',
  'available_in = ["local", "cloud"]',
  'command = "corepack pnpm kb:check"',
  'icon = "test-tube"',
];

function withoutHtmlComments(content) {
  return content.replace(/<!--[\s\S]*?-->/g, '');
}

function commandIsExplicitlyProhibited(prefix) {
  return /(?:\b(?:do not|don't|must not|never)\s+(?:run|execute|use)|(?:не\s+(?:выполня(?:й|йте|ть)|запуска(?:й|йте|ть)|использ(?:уй|уйте|овать)|пуш(?:ь|ьте|ить))|запрещ(?:ено|ается)\s+(?:выполнять|запускать|использовать)))\s*(?:the\s+command|команду|командой)?[\s`*_"'«»()[\]:-]*$/iu.test(prefix);
}

function hasMandatoryAutomaticMainPush(content) {
  return withoutHtmlComments(content).split('\n').some((line) => {
    const commands = line.matchAll(/git\s+push\s+origin\s+HEAD:main/gi);
    for (const command of commands) {
      if (!commandIsExplicitlyProhibited(line.slice(0, command.index))) return true;
    }
    return false;
  });
}

async function readText(root, path, errors) {
  try {
    return await readFile(join(root, path), 'utf8');
  } catch (error) {
    errors.push(`Cannot read ${path}: ${error.message}`);
    return null;
  }
}

function eventHookEntries(config, event) {
  const entries = config?.hooks?.[event];
  return Array.isArray(entries) ? entries : [];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function commandReferencesScript(command, scriptPath) {
  const escaped = escapeRegExp(scriptPath);
  return new RegExp(`(?:^|[\\s"'=/])${escaped}(?=$|[\\s"'\`;|&])`).test(command);
}

function auditClaudePermissions(config, errors) {
  const allow = config?.permissions?.allow;
  if (!Array.isArray(allow)) {
    errors.push('Claude permissions must allow documented workflows through corepack pnpm.');
    return;
  }
  if (allow.some((permission) => typeof permission === 'string' && /^Bash\(pnpm\b/.test(permission))) {
    errors.push('Claude permissions must not retain stale bare pnpm allow entries.');
  }
  const missing = requiredClaudePermissions.filter((permission) => !allow.includes(permission));
  if (missing.length > 0) {
    errors.push(`Claude permissions must include Corepack workflows: ${missing.join(', ')}.`);
  }
}

function auditSessionStart(config, label, errors) {
  const entries = eventHookEntries(config, 'SessionStart');
  const expectedCommand = label === 'Claude' ? claudeSessionCommand : codexSessionCommand;
  const references = [];
  for (const entry of entries) {
    for (const hook of Array.isArray(entry?.hooks) ? entry.hooks : []) {
      if (typeof hook?.command === 'string' && commandReferencesScript(hook.command, 'scripts/session-start-context.mjs')) {
        references.push({ entry, hook });
      }
    }
  }

  if (references.length !== 1 || references[0].hook.command !== expectedCommand) {
    if (label === 'Claude') {
      errors.push(`Claude SessionStart command must be exact and safely quote CLAUDE_PROJECT_DIR: ${claudeSessionCommand}.`);
    } else {
      errors.push(`Codex SessionStart command must be exact: ${codexSessionCommand}.`);
    }
  }
  if (label === 'Codex'
    && (references.length !== 1 || references[0].entry.matcher !== '^(startup|resume|clear|compact)$')) {
    errors.push('Codex SessionStart matcher must be anchored and include startup, resume, clear, and compact.');
  }
}

function auditPostToolUse(config, label, level, errors) {
  const entries = eventHookEntries(config, 'PostToolUse');
  const references = [];
  for (const entry of entries) {
    for (const hook of Array.isArray(entry?.hooks) ? entry.hooks : []) {
      if (typeof hook?.command === 'string' && commandReferencesScript(hook.command, 'scripts/agent/write-guard.mjs')) {
        references.push({ entry, hook });
      }
    }
  }

  if (level < 2) {
    if (references.length > 0) {
      errors.push(`${label} level ${level} requires the common PostToolUse scripts/agent/write-guard.mjs guard to be absent.`);
    }
    return;
  }

  const expected = canonicalPostToolUse[label];
  const canonical = references.filter(({ entry, hook }) => (
    entry.matcher === expected.matcher
    && hook.type === 'command'
    && hook.command === expected.command
    && hook.timeout === 10
  ));
  if (references.length !== 1 || canonical.length !== 1) {
    errors.push(`${label} canonical PostToolUse must contain exactly one scripts/agent/write-guard.mjs guard at level ${level}.`);
  }
}

async function auditHooks(root, path, label, level, errors) {
  const content = await readText(root, path, errors);
  if (content === null) return;

  let config;
  try {
    config = JSON.parse(content);
  } catch (error) {
    errors.push(`${label} hooks JSON is invalid: ${error.message}`);
    return;
  }

  auditSessionStart(config, label, errors);
  if (Number.isInteger(level)) auditPostToolUse(config, label, level, errors);
  if (label === 'Claude') auditClaudePermissions(config, errors);
}

async function auditHarness(root, errors) {
  let value;
  try {
    value = JSON.parse(await readFile(join(root, 'agent-config/harness.json'), 'utf8'));
  } catch (error) {
    errors.push(`Harness manifest agent-config/harness.json must be valid JSON with strict version and level fields: ${error.message}`);
    return null;
  }

  const keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort() : [];
  if (keys.length !== 2 || keys[0] !== 'level' || keys[1] !== 'version'
    || value.version !== 1 || !Number.isInteger(value.level) || value.level < 0 || value.level > 3) {
    errors.push('Harness manifest agent-config/harness.json must be exactly { "version": 1, "level": 0..3 }.');
    return null;
  }
  return value.level;
}

async function auditSharedSkills(root, errors) {
  for (const skill of sharedSkills) {
    const canonicalPath = join(root, 'skills', skill, 'SKILL.md');
    let canonical;
    try {
      canonical = await realpath(canonicalPath);
    } catch (error) {
      errors.push(`Shared skill ${skill} has no canonical SKILL.md: ${error.message}`);
      continue;
    }

    const invalidHosts = [];
    for (const host of hostAdapters) {
      try {
        const resolved = await realpath(join(root, host.root, 'skills', skill, 'SKILL.md'));
        if (resolved !== canonical) invalidHosts.push(host.label);
      } catch {
        invalidHosts.push(host.label);
      }
    }
    if (invalidHosts.length > 0) {
      errors.push(
        `Shared skill ${skill} must resolve to its canonical file for Claude and Codex; invalid: ${invalidHosts.join(', ')}.`,
      );
    }
  }
}

function stripTomlComment(line) {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted && escaped) {
      escaped = false;
    } else if (quoted && character === '\\') {
      escaped = true;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === '#') {
      return line.slice(0, index);
    }
  }
  return line;
}

function hasInvalidTomlLexicalInput(content) {
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    if (code === 0x0d) {
      if (content.charCodeAt(index + 1) !== 0x0a) return true;
    } else if ((code <= 0x1f && code !== 0x09 && code !== 0x0a) || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function canonicalTomlLines(content) {
  return content
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((line) => stripTomlComment(line).replace(/^[ \t]+|[ \t]+$/g, ''))
    .filter(Boolean);
}

function parseTomlContractForDiagnostics(content) {
  const values = new Map();
  let section = '';

  for (const line of content.split('\n')) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }

    const valueMatch = line.match(/^\s*("[^"]+"|[A-Za-z0-9_-]+)\s*=\s*(.*?)\s*(?:#.*)?$/);
    if (!valueMatch) continue;
    const key = valueMatch[1].startsWith('"') ? JSON.parse(valueMatch[1]) : valueMatch[1];
    const raw = valueMatch[2];
    let value = raw;
    try {
      if (raw.startsWith('"') || raw.startsWith('[')) value = JSON.parse(raw);
    } catch {
      // The consumer checks below report the affected value as invalid.
    }
    values.set(section ? `${section}.${key}` : key, value);
  }

  return values;
}

function hasExactly(values, expected) {
  return Array.isArray(values)
    && values.length === expected.length
    && expected.every((value) => values.includes(value));
}

async function auditWorkflow(root, path, errors) {
  let content;
  try {
    content = await readFile(join(root, path), 'utf8');
  } catch (error) {
    errors.push(`${path} is required at harness level 2 or 3: ${error.message}`);
    return;
  }
  const lines = content.split(/\r?\n/).map((line) => line.trim());
  if (!lines.includes('run: corepack pnpm kb:check')) {
    errors.push(`${path} must call corepack pnpm kb:check.`);
  }
  if (!lines.includes('run: node --test scripts/agent/test-corepack-bootstrap.mjs')) {
    errors.push(`${path} must run test-corepack-bootstrap.mjs as a separate non-recursive step.`);
  }
}

async function auditConductor(root, level, errors) {
  let settings;
  try {
    settings = await readFile(join(root, '.conductor/settings.toml'), 'utf8');
  } catch {
    errors.push('Shared Conductor settings are missing: .conductor/settings.toml.');
  }

  if (settings !== undefined) {
    if (hasInvalidTomlLexicalInput(settings)) {
      errors.push('Shared Conductor settings contain invalid TOML lexical input: control characters and lone carriage returns are not allowed.');
    } else {
      const lines = canonicalTomlLines(settings);
      if (lines.length !== canonicalConductorLines.length
        || lines.some((line, index) => line !== canonicalConductorLines[index])) {
        errors.push('Shared settings must match the bounded canonical Conductor repository contract; duplicate, unknown, malformed, reordered, and non-canonical lines are not allowed. TOML comments are allowed.');
      }
    }

    const config = parseTomlContractForDiagnostics(settings);
    if (config.get('$schema') !== conductorSchema) {
      errors.push(`Shared Conductor settings must use the repository settings schema ${conductorSchema}.`);
    }
    if (config.get('scripts.setup') !== conductorSetup) {
      errors.push(`Conductor setup must be exactly: ${conductorSetup}.`);
    }
    if (config.get('scripts.run_mode') !== 'concurrent') {
      errors.push('Conductor scripts.run_mode must be concurrent.');
    }
    if (!hasExactly(config.get('scripts.run.viewer.available_in'), ['local'])) {
      errors.push('Conductor viewer available_in must contain only local.');
    }
    if (config.get('scripts.run.viewer.command') !== viewerCommand) {
      errors.push(`Conductor viewer command must map VIEWER_PORT from CONDUCTOR_PORT and VITE_PORT from CONDUCTOR_PORT + 1: ${viewerCommand}.`);
    }
    if (!hasExactly(config.get('scripts.run.check.available_in'), ['local', 'cloud'])) {
      errors.push('Conductor check available_in must contain local and cloud.');
    }
    if (config.get('scripts.run.check.command') !== 'corepack pnpm kb:check') {
      errors.push('Conductor check command must be exactly: corepack pnpm kb:check.');
    }
  }

  let packageJson;
  try {
    packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  } catch (error) {
    errors.push(`Cannot read root package.json for Conductor bootstrap: ${error.message}`);
  }
  if (packageJson !== undefined) {
    for (const [script, command] of Object.entries(rootExecutableScripts)) {
      if (packageJson?.scripts?.[script] !== command) {
        if (script === 'setup') {
          errors.push(`Root setup must use exactly four frozen-lockfile installs through corepack pnpm: ${rootSetup}.`);
        } else if (script === 'agent:test') {
          errors.push(`Root agent:test must list the four explicit non-recursive tests and exclude test-corepack-bootstrap.mjs: ${agentTest}.`);
        } else if (script === 'kb:check') {
          errors.push(`Root kb:check must include agent:test, agent:check, and viewer:test without bootstrap recursion: ${kbCheck}.`);
        } else {
          errors.push(`Root ${script} script must run through Corepack without a global pnpm shim: ${command}.`);
        }
      }
    }
  }

  let viewerPackage;
  try {
    viewerPackage = JSON.parse(await readFile(join(root, 'tools/viewer/package.json'), 'utf8'));
  } catch (error) {
    errors.push(`Cannot read tools/viewer/package.json for Conductor bootstrap: ${error.message}`);
  }
  if (viewerPackage !== undefined) {
    if (viewerPackage?.scripts?.dev !== viewerDev) {
      errors.push(`Viewer dev script must launch both processes through Corepack without a global pnpm shim: ${viewerDev}.`);
    }
    if (viewerPackage?.scripts?.test !== viewerTest) {
      errors.push(`Viewer test script must run every top-level viewer test: ${viewerTest}.`);
    }
  }

  let prePush;
  try {
    prePush = await readFile(join(root, 'scripts/git-hooks/pre-push'), 'utf8');
  } catch (error) {
    errors.push(`Cannot read pre-push hook for Conductor bootstrap: ${error.message}`);
  }
  if (prePush !== undefined) {
    const executableLines = prePush
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    if (!executableLines.includes('corepack pnpm kb:check')
      || executableLines.some((line) => /(?<!corepack )\bpnpm\b/.test(line))) {
      errors.push('The pre-push hook must run corepack pnpm kb:check without a global pnpm shim.');
    }
  }

  if (level >= 2) {
    await auditWorkflow(root, '.github/workflows/ci.yml', errors);
    await auditWorkflow(root, '.github/workflows/kb-ci.yml', errors);
  }
}

export async function auditRepository(root) {
  const errors = [];
  const claude = await readText(root, 'CLAUDE.md', errors);
  const agents = await readText(root, 'AGENTS.md', errors);
  const level = await auditHarness(root, errors);

  if (claude !== null) {
    const firstContentLine = withoutHtmlComments(claude)
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean);
    if (firstContentLine !== '@AGENTS.md') {
      errors.push('The first non-comment content in CLAUDE.md must be @AGENTS.md.');
    }
  }

  for (const [path, content] of [['AGENTS.md', agents], ['CLAUDE.md', claude]]) {
    if (content !== null && hasMandatoryAutomaticMainPush(content)) {
      errors.push(`${path} contains a mandatory automatic main push rule.`);
    }
  }

  await auditHooks(root, '.claude/settings.json', 'Claude', level, errors);
  await auditHooks(root, '.codex/hooks.json', 'Codex', level, errors);
  await auditSharedSkills(root, errors);
  await auditConductor(root, level, errors);

  return { passed: errors.length === 0, errors };
}
