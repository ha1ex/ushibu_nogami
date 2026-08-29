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

function eventHookCommands(config, event) {
  const entries = config?.hooks?.[event];
  if (!Array.isArray(entries)) return [];

  const commands = [];
  for (const entry of entries) {
    if (!entry || !Array.isArray(entry.hooks)) continue;
    for (const hook of entry.hooks) {
      if (hook && typeof hook.command === 'string') commands.push(hook.command);
    }
  }
  return commands;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function commandReferencesScript(command, scriptPath) {
  const escaped = escapeRegExp(scriptPath);
  return new RegExp(`(?:^|[\\s"'=/])${escaped}(?=$|[\\s"'\`;|&])`).test(command);
}

async function auditHooks(root, path, label, errors) {
  const content = await readText(root, path, errors);
  if (content === null) return;

  let config;
  try {
    config = JSON.parse(content);
  } catch (error) {
    errors.push(`${label} hooks JSON is invalid: ${error.message}`);
    return;
  }

  const requiredHooks = [
    { event: 'SessionStart', script: 'scripts/session-start-context.mjs' },
    { event: 'PostToolUse', script: 'scripts/agent/write-guard.mjs' },
  ];
  for (const { event, script } of requiredHooks) {
    const commands = eventHookCommands(config, event);
    if (!commands.some((command) => commandReferencesScript(command, script))) {
      errors.push(`${label} ${event} hooks must reference ${script}.`);
    }
  }
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

function parseTomlContract(content) {
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

async function auditConductor(root, errors) {
  let settings;
  try {
    settings = await readFile(join(root, '.conductor/settings.toml'), 'utf8');
  } catch {
    errors.push('Shared Conductor settings are missing: .conductor/settings.toml.');
  }

  if (settings !== undefined) {
    const config = parseTomlContract(settings);
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
  if (packageJson !== undefined && packageJson?.scripts?.setup !== rootSetup) {
    errors.push(`Root setup must use exactly four frozen-lockfile installs through corepack pnpm: ${rootSetup}.`);
  }
}

export async function auditRepository(root) {
  const errors = [];
  const claude = await readText(root, 'CLAUDE.md', errors);
  const agents = await readText(root, 'AGENTS.md', errors);

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

  await auditHooks(root, '.claude/settings.json', 'Claude', errors);
  await auditHooks(root, '.codex/hooks.json', 'Codex', errors);
  await auditSharedSkills(root, errors);
  await auditConductor(root, errors);

  return { passed: errors.length === 0, errors };
}
