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

function hasMandatoryAutomaticMainPush(content) {
  return withoutHtmlComments(content).split('\n').some((line) => {
    if (!/git\s+push\s+origin\s+HEAD:main/i.test(line)) return false;
    return !/(?:\bnever\b|\bdo\s+not\b|\bdon't\b|\bmust\s+not\b|\bwithout\s+explicit\b|\bno\s+automatic\b|\bзапрещ|\bникогда\b|\bбез\s+явн|\bне\s+(?:выполня|пуш|дела))/i.test(line);
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

function hookCommands(value, commands = []) {
  if (Array.isArray(value)) {
    for (const item of value) hookCommands(item, commands);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'command' && typeof item === 'string') commands.push(item);
      else hookCommands(item, commands);
    }
  }
  return commands;
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

  const commands = hookCommands(config);
  for (const script of ['session-start-context.mjs', 'write-guard.mjs']) {
    if (!commands.some((command) => command.includes(script))) {
      errors.push(`${label} hooks must reference ${script}.`);
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
