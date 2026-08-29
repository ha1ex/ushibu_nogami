import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';

const sharedSkills = ['kb-ingest', 'decision-log', 'interviewer-agent'];
const hostAdapters = [
  { label: 'Claude', root: '.claude' },
  { label: 'Codex', root: '.agents' },
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

  return { passed: errors.length === 0, errors };
}
