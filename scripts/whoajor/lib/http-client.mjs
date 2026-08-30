import {
  DEFAULT_DELAY_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_USER_AGENT,
} from '../config.mjs';
import { buildUrl } from './contract.mjs';

const RETRY_BACKOFF_MS = [250, 500, 1000, 2000, 4000];

const defaultSleep = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

function observedHeaders(headers) {
  if (!headers) return {};
  if (typeof headers.entries === 'function') return Object.fromEntries(headers.entries());
  return Object.fromEntries(Object.entries(headers));
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const expected = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === expected);
  return entry?.[1] ?? null;
}

function retryAfterMs(headers) {
  const value = headerValue(headers, 'retry-after');
  if (value === null || value === undefined) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) return null;
  return Math.max(0, retryAt - Date.now());
}

function backoffMs(retryNumber) {
  return RETRY_BACKOFF_MS[Math.min(retryNumber, RETRY_BACKOFF_MS.length - 1)];
}

function isJsonContentType(headers) {
  const contentType = headerValue(headers, 'content-type');
  return typeof contentType === 'string'
    && /^(?:application\/json|application\/[a-z0-9.+-]+\+json)(?:\s*;|\s*$)/i.test(contentType);
}

function requestError({ url, status, attempts, cause, reason }) {
  const error = new Error(
    `GET ${url} failed after ${attempts} attempts with status ${status ?? 'unavailable'}${
      reason ? `: ${reason}` : ''
    }`,
    cause === undefined ? undefined : { cause },
  );
  error.url = url;
  error.status = status ?? null;
  error.attempts = attempts;
  return error;
}

function isSuccessStatus(status) {
  return Number.isInteger(status) && status >= 200 && status < 300;
}

function isRetryableStatus(status) {
  return status === 429 || status === 503;
}

function validateMaxRetries(maxRetries) {
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > RETRY_BACKOFF_MS.length) {
    throw new RangeError(`maxRetries must be an integer from 0 to ${RETRY_BACKOFF_MS.length}`);
  }
  return maxRetries;
}

export function createHttpClient({
  baseUrl,
  fetchImpl = globalThis.fetch,
  delayMs = DEFAULT_DELAY_MS,
  maxRetries = DEFAULT_MAX_RETRIES,
  sleep = defaultSleep,
  userAgent = DEFAULT_USER_AGENT,
} = {}) {
  const retryLimit = validateMaxRetries(maxRetries);
  let queue = Promise.resolve();
  let previousRequestSucceeded = false;

  async function fetchWithRetry(url, path, query) {
    const startedAt = Date.now();
    let attempts = 0;

    while (true) {
      attempts += 1;
      let response;
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            'user-agent': userAgent,
          },
        });
        if (!response || !Number.isInteger(response.status)) {
          throw new TypeError('fetch returned an invalid response');
        }
      } catch (error) {
        if (attempts > retryLimit) {
          throw requestError({
            url: url.href,
            status: null,
            attempts,
            cause: error,
            reason: 'network error',
          });
        }
        await sleep(backoffMs(attempts - 1));
        continue;
      }

      if (isSuccessStatus(response.status)) {
        if (!isJsonContentType(response.headers)) {
          throw requestError({
            url: url.href,
            status: response.status,
            attempts,
            reason: 'expected JSON content-type',
          });
        }
        let body;
        try {
          body = Buffer.from(await response.arrayBuffer());
        } catch (error) {
          if (attempts > retryLimit) {
            throw requestError({
              url: url.href,
              status: response.status,
              attempts,
              cause: error,
              reason: 'network error while reading response body',
            });
          }
          await sleep(backoffMs(attempts - 1));
          continue;
        }
        return {
          path,
          query: { ...query },
          url: url.href,
          status: response.status,
          headers: observedHeaders(response.headers),
          body,
          durationMs: Date.now() - startedAt,
        };
      }

      if (!isRetryableStatus(response.status) || attempts > retryLimit) {
        throw requestError({
          url: url.href,
          status: response.status,
          attempts,
        });
      }

      await sleep(retryAfterMs(response.headers) ?? backoffMs(attempts - 1));
    }
  }

  function get(path, query = {}) {
    const request = queue.then(async () => {
      const url = buildUrl(baseUrl, path, query);
      if (previousRequestSucceeded && delayMs > 0) await sleep(delayMs);
      const record = await fetchWithRetry(url, path, query);
      previousRequestSucceeded = true;
      return record;
    });

    queue = request.then(() => undefined, () => undefined);
    return request;
  }

  return Object.freeze({ get });
}
