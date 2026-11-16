import { defineConfig, devices } from '@playwright/test';

// The site is tested as GitHub Pages serves it: built, under a sub-path.
const base = process.env.BASE_PATH ?? '/aws-emulator-wasm/';
const port = 4173;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: `http://localhost:${port}${base}`,
    // The Japanese UI, as the browser language picks it; i18n.spec.js switches to English.
    locale: 'ja-JP',
    // The emulator starts as on a return visit; start.spec.js covers the first visit's button.
    storageState: 'e2e/autostart.json',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npx vite preview --port ${port} --strictPort --base ${base}`,
    url: `http://localhost:${port}${base}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
