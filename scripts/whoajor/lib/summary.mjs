const COUNT_KEYS = Object.freeze([
  'requests', 'matches', 'matchDetails', 'players', 'weapons', 'tags',
]);

function requireHash(value, name) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${name} must be a lowercase SHA-256 hash`);
  }
  return value;
}

function requireCounts(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} counts are required`);
  }
  const keys = Object.keys(value).sort();
  const expected = [...COUNT_KEYS].sort();
  if (
    keys.length !== expected.length
      || keys.some((key, index) => key !== expected[index])
      || keys.some((key) => !Number.isInteger(value[key]) || value[key] < 0)
  ) {
    throw new TypeError(`${name} counts must contain exactly ${expected.join(', ')}`);
  }
  return value;
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function markdownCode(value) {
  return String(value).replaceAll('`', '\\`');
}

function rawCitation(rawPath, artifact) {
  return `[source: ${rawPath}/${artifact}]`;
}

export function renderSourceSummary(input) {
  if (!input || typeof input !== 'object') throw new TypeError('summary input is required');
  const {
    snapshotName, date, rawPath, sourceUrl, sourceRange, report, database,
  } = input;
  if (typeof snapshotName !== 'string' || snapshotName.length === 0) {
    throw new TypeError('snapshotName is required');
  }
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new TypeError('date must be YYYY-MM-DD');
  }
  if (typeof rawPath !== 'string' || !rawPath.startsWith('/')) {
    throw new TypeError('rawPath must be a repository-absolute path');
  }
  if (typeof sourceUrl !== 'string' || !/^https?:\/\//.test(sourceUrl)) {
    throw new TypeError('sourceUrl must be an HTTP(S) URL');
  }
  if (
    typeof sourceRange?.minDate !== 'string'
      || typeof sourceRange?.maxDate !== 'string'
      || typeof sourceRange?.artifact !== 'string'
      || !sourceRange.artifact.startsWith('responses/')
  ) throw new TypeError('sourceRange must contain minDate, maxDate, and response artifact');
  if (report?.status !== 'complete' || !Array.isArray(report.errors) || report.errors.length !== 0) {
    throw new Error('summary requires a complete validation report without errors');
  }
  if (!Array.isArray(report.discrepancies)) {
    throw new TypeError('validation report discrepancies must be an array');
  }
  const reportCounts = requireCounts(report.counts, 'validation report');
  const databaseCounts = requireCounts(database?.counts, 'database');
  for (const key of COUNT_KEYS) {
    if (reportCounts[key] !== databaseCounts[key]) {
      throw new Error(`database counts mismatch for ${key}: ${databaseCounts[key]} != ${reportCounts[key]}`);
    }
  }
  const rootHash = requireHash(report.rootHash, 'rootHash');
  const dataFingerprint = requireHash(database.dataFingerprint, 'dataFingerprint');
  if (!['whoajor.sqlite', 'whoajor.sqlite.gz'].includes(database.artifact)) {
    throw new TypeError('database artifact must be whoajor.sqlite or whoajor.sqlite.gz');
  }
  const decompressedSha256 = requireHash(
    database.decompressedSha256,
    'decompressedSha256',
  );
  const manifestCitation = rawCitation(rawPath, 'manifest.json');
  const reportCitation = rawCitation(rawPath, 'validation-report.json');
  const databaseCitation = rawCitation(rawPath, database.artifact);
  const contractCitation = rawCitation(rawPath, 'contract.json');

  const lines = [
    '---',
    'type: source-summary',
    `title: ${yamlString(`Полный снимок stats.whoajor.com — ${snapshotName}`)}`,
    `date: ${date}`,
    `raw: ${yamlString(rawPath)}`,
    `source: ${yamlString(sourceUrl)}`,
    'confidence: high',
    'tags: [whoajor, cs2, full-snapshot]',
    '---',
    '',
    `# Полный снимок stats.whoajor.com — ${snapshotName}`,
    '',
    '## Provenance и полнота',
    '',
    `FACT: Снимок содержит ровно ${reportCounts.requests} HTTP-ответов, ${reportCounts.matches} матчей, ${reportCounts.matchDetails} карточек матчей, ${reportCounts.players} игроков, ${reportCounts.weapons} видов оружия и ${reportCounts.tags} тегов. ${reportCitation}`,
    '',
    `FACT: Точный временной диапазон источника: \`${sourceRange.minDate}\` — \`${sourceRange.maxDate}\`. ${rawCitation(rawPath, sourceRange.artifact)}`,
    '',
    `FACT: Валидатор подтвердил статус \`complete\`; root hash: \`${rootHash}\`. ${reportCitation}`,
    '',
    `FACT: Нормализованная SQLite сохранила те же exact counts; data fingerprint SQLite: \`${dataFingerprint}\`; SHA-256 распакованной SQLite: \`${decompressedSha256}\`. ${databaseCitation}`,
    '',
    `FACT: Канонический raw evidence — manifest и content-addressed exact HTTP bodies в каталоге \`${rawPath}\`. ${manifestCitation}`,
    '',
    'INFERENCE: Совпадение counts в независимом validation report и SQLite позволяет использовать базу как производное представление raw-снимка, но не заменяет raw evidence. '
      + `${reportCitation} ${databaseCitation}`,
    '',
    '## Методологические ограничения',
    '',
    `FACT: SteamID хранится в SQLite только как TEXT, без числового преобразования. ${databaseCitation}`,
    '',
    'UNKNOWN: Индивидуальные агрегаты игроков не доказывают сыгранность пятёрки; контракт снимка не содержит отдельного измерения командной когезии. '
      + `${contractCitation}`,
    '',
    '## Расхождения источника',
    '',
  ];

  if (report.discrepancies.length === 0) {
    lines.push(`FACT: Валидатор не зафиксировал source discrepancies. ${reportCitation}`);
  } else {
    lines.push(`FACT: Валидатор сохранил ${report.discrepancies.length} source discrepancies без исправления или сглаживания. ${reportCitation}`);
    lines.push('');
    for (const discrepancy of report.discrepancies) {
      if (
        typeof discrepancy?.code !== 'string'
          || typeof discrepancy?.location !== 'string'
          || typeof discrepancy?.message !== 'string'
      ) throw new TypeError('each discrepancy must contain code, location, and message strings');
      lines.push(
        `- FACT: ${markdownCode(discrepancy.code)} | \`${markdownCode(discrepancy.location)}\` | ${discrepancy.message} ${reportCitation}`,
      );
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
