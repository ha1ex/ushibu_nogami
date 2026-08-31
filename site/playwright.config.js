import { defineConfig } from '@playwright/test';

const testPort = Number(process.env.PLAYWRIGHT_PORT || 4173);

export default defineConfig({
  testDir: './test/e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: `http://127.0.0.1:${testPort}`,
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node test/server.mjs',
    port: testPort,
    reuseExistingServer: true
  }
});
