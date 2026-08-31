export class HttpInputError extends Error {
  constructor(code) {
    super(code);
    this.name = 'HttpInputError';
    this.code = code;
  }
}

export function hasSameOrigin(request) {
  const origin = request.headers.get('origin');
  return typeof origin === 'string' && origin === new URL(request.url).origin;
}

export function safeLocalPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\u0000-\u0020\u007f]/.test(value)) return '/';
  try {
    const parsed = new URL(value, 'https://local.invalid');
    return parsed.origin === 'https://local.invalid' ? value : '/';
  } catch {
    return '/';
  }
}

export async function readLimitedUtf8(request, maxBytes = 32768) {
  const declared = request.headers.get('content-length');
  if (/^\d+$/.test(declared || '') && Number(declared) > maxBytes) throw new HttpInputError('payload_too_large');
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new HttpInputError('bad_request');
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new HttpInputError('payload_too_large');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof HttpInputError) throw error;
    throw new HttpInputError('bad_request');
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new HttpInputError('bad_request');
  }
}

export async function readLimitedJson(request, maxBytes = 32768) {
  const text = await readLimitedUtf8(request, maxBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpInputError('bad_request');
  }
}
