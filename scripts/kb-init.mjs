#!/usr/bin/env node
// kb-init.mjs — bootstrap-параметризация клона шаблона (B1).
//
// Делает за пользователя ручную таблицу «Параметризация под свой проект» из README:
//   1. Вписывает цель проекта в AGENTS.md § Project purpose и .remember/core.md § Цель проекта —
//      эти файлы подмешиваются в СИСТЕМНЫЙ ПРОМПТ агента (think.mjs / mcp-server.mjs);
//      без init каждый форк сохраняет цель исходного проекта.
//   2. --strip-demo: удаляет демо-корпус (4 библиотеки навыков + _skills-index.md) и отчёты
//      docs/examples/*; walkthrough-пример удаляется тоже, если не указан --keep-walkthrough.
//      mcp-catalog СОХРАНЯЕТСЯ (курируемый каталог MCP полезен любому проекту).
//   3. --level 0..3: уровень принятия оснастки (см. README § Уровни принятия):
//      L0/L1 — только поиск/MCP: выключает общий PostToolUse guard и снимает CI-workflows;
//      L2/L3 — дисциплина+гейты: включает общий PostToolUse guard (дефолт: 2).
//   4. Пишет строку в log.md, чистит walkthrough-блок из index.md при удалении примера.
//
// Использование:
//   node scripts/kb-init.mjs                                  # интерактивно (TTY)
//   node scripts/kb-init.mjs --name "Аудит ниши X" --purpose "…" --strip-demo --level 2
//   флаги: --name S  --purpose S  --strip-demo | --keep-demo  --keep-walkthrough  --level N  --yes
//
// После init: corepack pnpm kb:index && corepack pnpm kb:eval --update-baseline.

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...s) => join(REPO_ROOT, ...s);

// ---------- аргументы ----------

const argv = process.argv.slice(2);
const flags = { level: 2, stripDemo: null, keepWalkthrough: false, name: null, purpose: null, yes: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--name') flags.name = argv[++i];
  else if (a === '--purpose') flags.purpose = argv[++i];
  else if (a === '--strip-demo') flags.stripDemo = true;
  else if (a === '--keep-demo') flags.stripDemo = false;
  else if (a === '--keep-walkthrough') flags.keepWalkthrough = true;
  else if (a === '--level') {
    const value = argv[++i];
    if (!/^[0-3]$/.test(value ?? '')) {
      console.error('kb-init: --level должен быть целым числом от 0 до 3.');
      process.exit(2);
    }
    flags.level = Number(value);
  }
  else if (a === '--yes' || a === '-y') flags.yes = true;
  else if (a === '--help' || a === '-h') {
    console.log('kb-init: параметризация клона. Флаги: --name S --purpose S --strip-demo|--keep-demo --keep-walkthrough --level 0..3 --yes');
    process.exit(0);
  }
}

// ---------- интерактив (только если чего-то не хватает и есть TTY) ----------

const needAsk = flags.name == null || flags.stripDemo == null;
if (needAsk && process.stdin.isTTY && !flags.yes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  if (flags.name == null) flags.name = (await rl.question('Название проекта: ')).trim() || null;
  if (flags.purpose == null) flags.purpose = (await rl.question('Цель проекта (1-3 предложения): ')).trim() || null;
  if (flags.stripDemo == null) {
    const ans = (await rl.question('Удалить демо-корпус (736 карточек) и walkthrough-пример? [Y/n]: ')).trim().toLowerCase();
    flags.stripDemo = ans !== 'n' && ans !== 'no' && ans !== 'нет';
  }
  rl.close();
}
if (flags.stripDemo == null) flags.stripDemo = false;

const summaryOps = [];

// ---------- 1. цель проекта → AGENTS.md + .remember/core.md ----------

if (flags.name || flags.purpose) {
  const purposeText = [
    flags.name ? `**${flags.name}.**` : null,
    flags.purpose || 'Цель проекта: заполните 1-3 предложениями (что за проект, для кого, что считается результатом).',
  ].filter(Boolean).join(' ');

  const agentsPath = p('AGENTS.md');
  let agents = readFileSync(agentsPath, 'utf8');
  // Заменяем тело § Project purpose (от заголовка до следующего blockquote/заголовка).
  const re = /(## Project purpose\n\n)[\s\S]*?(\n\n> Внутреннее устройство|\n\n## )/;
  if (re.test(agents)) {
    agents = agents.replace(re, `$1${purposeText}$2`);
    writeFileSync(agentsPath, agents);
    summaryOps.push('AGENTS.md § Project purpose — вписана цель проекта');
  } else {
    console.error('⚠ AGENTS.md: секция «## Project purpose» не найдена — впишите цель вручную.');
  }

  const corePath = p('.remember', 'core.md');
  if (existsSync(corePath)) {
    let core = readFileSync(corePath, 'utf8');
    const coreRe = /(## Цель проекта\n\n)[\s\S]*?(\n\n## )/;
    if (coreRe.test(core)) {
      core = core.replace(coreRe, `$1${purposeText}$2`);
      writeFileSync(corePath, core);
      summaryOps.push('.remember/core.md § Цель проекта — вписана цель проекта');
    }
  }
}

// ---------- 2. strip demo ----------

const SKILL_LIBRARY_DIRS = ['anthropics-skills', 'claude-cookbooks', 'cybos-cases', 'fabric-patterns'];
const WALKTHROUGH_PATHS = [
  '00_context/walkthrough-product.md',
  '01_raw/walkthrough',
  '02_sources/2026-06-30-walkthrough-interview-cto.md',
  '03_wiki/walkthrough-deflection-rate.md',
  '04_synthesis/walkthrough-pilot-hypotheses.md',
  '05_decisions/walkthrough-decision-pilot-scope.md',
];
const DEMO_REPORTS = [
  'docs/examples/audit-report-2026-05-29.md',
  'docs/examples/dedup-report.md',
  'docs/examples/eval-report.md',
  'docs/examples/search-quality-report.md',
];

function rmIfExists(rel) {
  const abs = p(rel);
  if (!existsSync(abs)) return false;
  rmSync(abs, { recursive: true, force: true });
  return true;
}

if (flags.stripDemo) {
  let removed = 0;
  for (const d of SKILL_LIBRARY_DIRS) if (rmIfExists(join('06_outputs', d))) removed++;
  if (rmIfExists('06_outputs/_skills-index.md')) removed++;
  for (const r of DEMO_REPORTS) if (rmIfExists(r)) removed++;
  summaryOps.push(`демо-корпус удалён (${removed} путей); mcp-catalog сохранён`);

  if (!flags.keepWalkthrough) {
    let wt = 0;
    for (const w of WALKTHROUGH_PATHS) if (rmIfExists(w)) wt++;
    // Вычистить walkthrough-блок из index.md.
    const idxPath = p('index.md');
    if (existsSync(idxPath)) {
      let idx = readFileSync(idxPath, 'utf8');
      idx = idx.replace(/## Walkthrough-пример[\s\S]*?(?=\n## )/, '');
      writeFileSync(idxPath, idx);
    }
    summaryOps.push(`walkthrough-пример удалён (${wt} путей)`);
  }
}

// ---------- 3. уровень принятия ----------

const COMMON_GUARD_SCRIPT = 'scripts/agent/write-guard.mjs';
const canonicalPostToolUse = {
  claude: {
    matcher: 'Write|Edit|MultiEdit',
    hooks: [{
      type: 'command',
      command: 'node "$CLAUDE_PROJECT_DIR/scripts/agent/write-guard.mjs"',
      timeout: 10,
    }],
  },
  codex: {
    matcher: 'apply_patch|Edit|Write',
    hooks: [{
      type: 'command',
      command: 'node "$(git rev-parse --show-toplevel)/scripts/agent/write-guard.mjs"',
      timeout: 10,
    }],
  },
};

function isCommonGuard(hook) {
  return hook && typeof hook.command === 'string' && hook.command.includes(COMMON_GUARD_SCRIPT);
}

function withoutCommonGuard(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    if (!entry || !Array.isArray(entry.hooks)) return [entry];
    const hooks = entry.hooks.filter((hook) => !isCommonGuard(hook));
    return hooks.length > 0 ? [{ ...entry, hooks }] : [];
  });
}

function configurePostToolUse(path, label, canonical, enabled) {
  if (!existsSync(path)) {
    console.error(`⚠ ${label} не найден — настройте PostToolUse вручную.`);
    return;
  }
  try {
    const config = JSON.parse(readFileSync(path, 'utf8'));
    if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) config.hooks = {};
    const remaining = withoutCommonGuard(config.hooks.PostToolUse);
    if (enabled) remaining.push(canonical);
    if (remaining.length > 0) config.hooks.PostToolUse = remaining;
    else delete config.hooks.PostToolUse;
    writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
    summaryOps.push(`${label} — общий PostToolUse guard ${enabled ? 'включён' : 'снят'} (L${flags.level})`);
  } catch (error) {
    console.error(`⚠ ${label} не разобран (${error.message}) — настройте PostToolUse вручную.`);
  }
}

configurePostToolUse(
  p('.claude', 'settings.json'),
  '.claude/settings.json',
  canonicalPostToolUse.claude,
  flags.level >= 2,
);
configurePostToolUse(
  p('.codex', 'hooks.json'),
  '.codex/hooks.json',
  canonicalPostToolUse.codex,
  flags.level >= 2,
);

if (flags.level < 2) {
  // L0/L1: только поиск/MCP — без общего guard и CI-гейтов.
  for (const wf of ['.github/workflows/kb-ci.yml', '.github/workflows/ci.yml']) {
    if (rmIfExists(wf)) summaryOps.push(`${wf} — снят (L${flags.level})`);
  }
}

const harness = { version: 1, level: flags.level };
if (harness.version !== 1 || !Number.isInteger(harness.level) || harness.level < 0 || harness.level > 3) {
  throw new Error('internal error: invalid harness manifest');
}
const harnessPath = p('agent-config', 'harness.json');
const harnessTemp = `${harnessPath}.tmp-${process.pid}-${Date.now()}`;
try {
  writeFileSync(harnessTemp, JSON.stringify(harness, null, 2) + '\n');
  renameSync(harnessTemp, harnessPath);
} catch (error) {
  rmSync(harnessTemp, { force: true });
  throw error;
}
summaryOps.push(`agent-config/harness.json — сохранён level=${flags.level}`);

// ---------- 4. log.md ----------

const logPath = p('log.md');
if (existsSync(logPath)) {
  const today = new Date().toISOString().slice(0, 10);
  const line = `\n## ${today}\n\n- (init) kb:init: ${flags.name ? `проект «${flags.name}», ` : ''}` +
    `${flags.stripDemo ? 'демо вычищено' : 'демо сохранено'}, level=${flags.level}.\n`;
  writeFileSync(logPath, readFileSync(logPath, 'utf8').trimEnd() + '\n' + line);
  summaryOps.push('log.md — записана строка init');
}

// ---------- итог ----------

console.log('\nkb-init: готово.');
for (const s of summaryOps) console.log(`  • ${s}`);
console.log(`
Дальше:
  1. corepack pnpm kb:index                 # пересобрать индекс под новый состав
  2. corepack pnpm kb:eval --update-baseline # переснять baseline (состав проб изменился)
  3. Проверить AGENTS.md / .remember/core.md / .remember/preferences.md руками.
${flags.level >= 2 ? '  4. git config core.hooksPath scripts/git-hooks   # локальный pre-push гейт цитат' : ''}`);
