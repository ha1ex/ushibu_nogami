import { BlobPreconditionFailedError, get, put } from '@vercel/blob';

const MAX_STORED_JSON_BYTES = 2 * 1024 * 1024;

export class CasConflictError extends Error {
  constructor() {
    super('conditional write conflict');
    this.name = 'CasConflictError';
  }
}

async function readStreamJson(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_STORED_JSON_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error('stored JSON is too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export function createBlobJsonAdapter(dependencies = {}) {
  const blobGet = dependencies.get || get;
  const blobPut = dependencies.put || put;
  const PreconditionError = dependencies.PreconditionError || BlobPreconditionFailedError;

  async function read(pathname) {
    const result = await blobGet(pathname, { access: 'private', useCache: false });
    if (result === null) return { exists: false, etag: null, value: null };
    if (result.statusCode !== 200 || !result.stream || !result.blob || typeof result.blob.etag !== 'string') {
      throw new Error('invalid Blob get result');
    }
    return { exists: true, etag: result.blob.etag, value: await readStreamJson(result.stream) };
  }

  async function create(pathname, value) {
    try {
      await blobPut(pathname, JSON.stringify(value), {
        access: 'private',
        addRandomSuffix: false,
        contentType: 'application/json',
        allowOverwrite: false
      });
    } catch (error) {
      if (error instanceof PreconditionError) throw new CasConflictError();
      try {
        const latest = await read(pathname);
        if (latest.exists) throw new CasConflictError();
      } catch (rereadError) {
        if (rereadError instanceof CasConflictError) throw rereadError;
      }
      throw error;
    }
  }

  async function replace(pathname, etag, value) {
    try {
      await blobPut(pathname, JSON.stringify(value), {
        access: 'private',
        addRandomSuffix: false,
        contentType: 'application/json',
        allowOverwrite: true,
        ifMatch: etag
      });
    } catch (error) {
      if (error instanceof PreconditionError) throw new CasConflictError();
      throw error;
    }
  }

  return {
    read,
    create,
    replace,
    isConflict(error) { return error instanceof CasConflictError; }
  };
}

export const blobJsonAdapter = createBlobJsonAdapter();
