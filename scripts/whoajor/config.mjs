export const WHOAJOR_BASE_URL = 'https://stats.whoajor.com';
export const CONTRACT_VERSION = '1.0.0';
export const DEFAULT_DELAY_MS = 250;
export const DEFAULT_MAX_RETRIES = 5;
export const DEFAULT_USER_AGENT = 'ushibu-nogami-whoajor-import/1.0';

export const WHOAJOR_CONFIG = Object.freeze({
  baseUrl: WHOAJOR_BASE_URL,
  contractVersion: CONTRACT_VERSION,
  delayMs: DEFAULT_DELAY_MS,
  maxRetries: DEFAULT_MAX_RETRIES,
  userAgent: DEFAULT_USER_AGENT,
});
