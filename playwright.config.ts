import { defineConfig } from '@playwright/test';
// Workers inherit this value, so every journey in one invocation shares the same run directory.
const runDirectory = (process.env.CLEARDESK_BROWSER_RUN ??=
  'artifacts/runs/browser/' +
  new Date().toISOString().replaceAll(/[:.]/g, '-') +
  '-' +
  process.pid);

export default defineConfig({
  testDir: './verification/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  retries: 0,
  reporter: [['list'], ['json', { outputFile: runDirectory + '/results.json' }]],
  outputDir: runDirectory + '/details',
  use: {
    baseURL: 'http://127.0.0.1:4280',
    headless: true,
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
  },
});
