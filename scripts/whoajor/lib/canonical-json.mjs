import { createHash } from 'node:crypto';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export const canonicalStringify = (value) => JSON.stringify(canonicalize(value));
export const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
export const normalizeQuery = (entries) => new URLSearchParams(
  [...entries]
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [String(key), String(value)])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey < rightKey) return -1;
      if (leftKey > rightKey) return 1;
      if (leftValue < rightValue) return -1;
      if (leftValue > rightValue) return 1;
      return 0;
    }),
).toString();
export const requestKey = (path, query = {}) => {
  const normalized = normalizeQuery(Object.entries(query));
  return `GET ${path}${normalized ? `?${normalized}` : ''}`;
};
