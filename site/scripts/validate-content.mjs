import Ajv from 'ajv/dist/2020.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(await readFile(path.join(siteRoot, 'assets/data/operations.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addFormat('date', {
  type: 'string',
  validate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }
});
const validateSchema = ajv.compile(schema);

function allEntities(data) {
  return [...data.matches, ...data.training, ...data.maps, ...data.opponents];
}

export function validateOperations(data) {
  const errors = [];
  if (!validateSchema(data)) {
    errors.push(...validateSchema.errors.map((error) => `${error.instancePath || '/'} ${error.message}`));
    return { valid: false, errors };
  }

  const entities = allEntities(data);
  const cards = entities.flatMap((entity) => entity.cards);
  const knownIds = new Set();
  for (const item of [...entities, ...cards]) {
    if (knownIds.has(item.id)) errors.push(`Повтор ID: ${item.id}`);
    knownIds.add(item.id);
  }
  const cardIds = new Set(cards.map((card) => card.id));
  const matchById = new Map(data.matches.map((match) => [match.id, match]));
  const opponentIds = new Set(data.opponents.map((opponent) => opponent.id));
  const mapIds = new Set(data.maps.map((map) => map.id));

  for (const match of data.matches) {
    if (!opponentIds.has(match.opponentId)) errors.push(`${match.id}: неизвестный opponentId ${match.opponentId}`);
    if (match.cards.filter((card) => card.type === 'action').length > 3) errors.push(`${match.id}: разрешено не более трёх действий`);
  }
  for (const session of data.training) {
    if (!mapIds.has(session.mapId)) errors.push(`${session.id}: неизвестный mapId ${session.mapId}`);
  }
  for (const opponent of data.opponents) {
    const match = matchById.get(opponent.matchId);
    if (!match) errors.push(`${opponent.id}: неизвестный matchId ${opponent.matchId}`);
    else if (match.date !== opponent.matchDate || match.opponentId !== opponent.id) errors.push(`${opponent.id}: матч и дата не согласованы`);
  }
  for (const card of cards) {
    const refs = card.type === 'decision' ? card.evidenceIds : card.type === 'action' ? card.dependsOn : [];
    for (const id of refs) if (!cardIds.has(id)) errors.push(`${card.id}: неизвестная ссылка ${id}`);
  }
  return { valid: errors.length === 0, errors };
}

async function main() {
  const data = JSON.parse(await readFile(path.join(siteRoot, 'assets/data/operations.json'), 'utf8'));
  const result = validateOperations(data);
  if (!result.valid) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(`operations.json: OK — ${data.matches.length} матча, ${data.training.length} тренировка, ${data.maps.length} карт, ${data.opponents.length} соперника`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
