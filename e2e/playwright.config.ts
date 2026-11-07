import { defineConfig, devices } from '@playwright/test';

const CI = Boolean(process.env.CI);

/**
 * TeamFlow end-to-end tests. They drive the real stack (Next.js -> NestJS ->
 * Postgres) through the browser, so an agent cannot pass them by mocking its
 * own mistakes. `@smoke` runs on every PR; the full suite runs nightly.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 45_000,
  reporter: CI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  expect: {
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' },
  },
  // A screen without a baseline records one instead of failing. CI uploads new
  // baselines as an artifact; commit them to start comparing that screen.
  updateSnapshots: 'missing',
  // Fonts render differently per OS, so baselines are kept per platform. CI's are the linux ones.
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{testFilePath}/{arg}{ext}',

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
    timezoneId: 'UTC',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
});
