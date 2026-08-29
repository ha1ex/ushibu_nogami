import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { auditRepository } from './repository-check.mjs';
import { listSkillsWithEvals } from '../skillopt/evals/loader.mjs';

const sharedSkills = ['kb-ingest', 'decision-log', 'interviewer-agent'];

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
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'repository-check-'));
  await write(root, 'AGENTS.md', `${agentRule}\n`);
  await write(root, 'CLAUDE.md', claude);
  await write(root, '.claude/settings.json', JSON.stringify(claudeSettings ?? {
    hooks: {
      SessionStart: [{ hooks: [{ command: 'node scripts/session-start-context.mjs' }] }],
      PostToolUse: [{ hooks: [{ command: 'node scripts/agent/write-guard.mjs' }] }],
    },
  }));
  await write(root, '.codex/hooks.json', JSON.stringify(codexHooks ?? {
    hooks: {
      SessionStart: [{ hooks: [{ command: 'node scripts/session-start-context.mjs' }] }],
      PostToolUse: [{ hooks: [{ command: 'node scripts/agent/write-guard.mjs' }] }],
    },
  }));
  if (linkSkills) await linkSharedSkills(root);
  return root;
}

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

test('rejects every host skill that does not resolve to its canonical SKILL.md', async () => {
  const root = await makeFixture();
  await replaceHostSkillWithCopy(root, '.agents', 'decision-log');

  const result = await auditRepository(root);

  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /decision-log.*Claude.*Codex/i);
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
