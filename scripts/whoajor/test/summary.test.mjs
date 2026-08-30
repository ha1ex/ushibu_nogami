import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSourceSummary } from '../lib/summary.mjs';

const ROOT_HASH = 'a'.repeat(64);
const DATA_FINGERPRINT = 'b'.repeat(64);

function fixtureSummaryInput() {
  return {
    snapshotName: '2026-08-30-full-snapshot',
    date: '2026-08-30',
    rawPath: '/01_raw/whoajor/2026-08-30-full-snapshot',
    sourceUrl: 'https://stats.whoajor.com',
    sourceRange: {
      minDate: '2026-08-01',
      maxDate: '2026-08-30',
      artifact: `responses/${'c'.repeat(64)}.json`,
    },
    report: {
      status: 'complete',
      errors: [],
      rootHash: ROOT_HASH,
      counts: {
        requests: 25,
        matches: 2,
        matchDetails: 2,
        players: 3,
        weapons: 2,
        tags: 1,
      },
      discrepancies: [
        {
          code: 'META_MAP_SUM_MISMATCH',
          location: '/api/meta.maps',
          message: 'map sum 1 differs from meta.matches 2',
        },
        {
          code: 'WINS_LOSSES_LT_MATCHES',
          location: 'manifest.requests[4][0]',
          message: 'wins + losses (1) is below matches (2)',
        },
      ],
    },
    database: {
      counts: {
        requests: 25,
        matches: 2,
        matchDetails: 2,
        players: 3,
        weapons: 2,
        tags: 1,
      },
      dataFingerprint: DATA_FINGERPRINT,
      artifact: 'whoajor.sqlite.gz',
      artifactSha256: 'e'.repeat(64),
      decompressedSha256: 'd'.repeat(64),
    },
  };
}

test('summary содержит полный frontmatter, provenance, exact counts и fingerprints', () => {
  const markdown = renderSourceSummary(fixtureSummaryInput());

  assert.match(markdown, /^---\ntype: source-summary\n/);
  for (const field of ['title:', 'date: 2026-08-30', 'raw:', 'source:', 'confidence:', 'tags:']) {
    assert.match(markdown, new RegExp(`^${field}`, 'm'));
  }
  assert.match(markdown, /FACT: Снимок содержит ровно 25 HTTP-ответов, 2 матчей, 2 карточек матчей, 3 игроков, 2 видов оружия и 1 тегов\./);
  assert.match(markdown, new RegExp(`root hash: \`${ROOT_HASH}\``));
  assert.match(markdown, new RegExp(`data fingerprint SQLite: \`${DATA_FINGERPRINT}\``));
  assert.match(markdown, new RegExp(`SHA-256 распакованной SQLite: \`${'d'.repeat(64)}\``));
  assert.match(markdown, new RegExp(`SHA-256 файла whoajor\\.sqlite\\.gz: \`${'e'.repeat(64)}\``));
  assert.match(markdown, /\[source: \/01_raw\/whoajor\/2026-08-30-full-snapshot\/whoajor\.sqlite\.gz\]/);
  assert.match(markdown, /временной диапазон источника: `2026-08-01` — `2026-08-30`/);
  assert.ok(markdown.includes(
    `[source: /01_raw/whoajor/2026-08-30-full-snapshot/responses/${'c'.repeat(64)}.json]`,
  ));
  assert.match(markdown, /\[source: \/01_raw\/whoajor\/2026-08-30-full-snapshot\/manifest\.json\]/);
});

test('summary сохраняет каждую discrepancy без сглаживания и маркирует выводы', () => {
  const markdown = renderSourceSummary(fixtureSummaryInput());

  assert.match(markdown, /META_MAP_SUM_MISMATCH \| `\/api\/meta\.maps` \| map sum 1 differs from meta\.matches 2/);
  assert.match(markdown, /WINS_LOSSES_LT_MATCHES \| `manifest\.requests\[4\]\[0\]` \| wins \+ losses \(1\) is below matches \(2\)/);
  assert.match(markdown, /INFERENCE:/);
  assert.match(markdown, /UNKNOWN:/);
  assert.match(markdown, /SteamID[^\n]*TEXT/);
  assert.match(markdown, /индивидуальн[^\n]*не доказывают сыгранность пятёрки/i);
  for (const line of markdown.split('\n').filter((row) => /^(?:- )?(FACT|INFERENCE|UNKNOWN):/.test(row))) {
    assert.match(line, /\[source: \/01_raw\/whoajor\/2026-08-30-full-snapshot\//);
  }
});

test('summary отклоняет stale counts и invalid fingerprints', () => {
  const stale = fixtureSummaryInput();
  stale.database.counts.matches = 1;
  assert.throws(() => renderSourceSummary(stale), /counts.*match/i);

  const invalid = fixtureSummaryInput();
  invalid.database.dataFingerprint = 'not-a-hash';
  assert.throws(() => renderSourceSummary(invalid), /dataFingerprint/i);

  const invalidArtifact = fixtureSummaryInput();
  invalidArtifact.database.artifact = '../whoajor.sqlite';
  assert.throws(() => renderSourceSummary(invalidArtifact), /artifact/i);

  const invalidDatabaseHash = fixtureSummaryInput();
  invalidDatabaseHash.database.decompressedSha256 = 'not-a-hash';
  assert.throws(() => renderSourceSummary(invalidDatabaseHash), /decompressedSha256/i);

  const invalidArtifactHash = fixtureSummaryInput();
  invalidArtifactHash.database.artifactSha256 = 'not-a-hash';
  assert.throws(() => renderSourceSummary(invalidArtifactHash), /artifactSha256/i);
});
