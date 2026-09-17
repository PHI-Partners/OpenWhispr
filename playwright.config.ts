import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',

  projects: [
    {
      name: 'electron',
      testMatch: /^(?!.*browser-preview)(?!.*smoke-real).*\.spec\.ts$/,
    },
    {
      name: 'browser-preview-light',
      testMatch: /browser-preview.*\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
        colorScheme: 'light',
      },
    },
    {
      name: 'browser-preview-dark',
      testMatch: /browser-preview.*\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
        colorScheme: 'dark',
      },
    },
    {
      name: 'smoke-real',
      testMatch: /smoke-real[/\\].*\.spec\.ts$/,
    },
  ],

  webServer: {
    command: 'npm run dev:browser',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
