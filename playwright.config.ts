import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: ['ui.spec.ts', 'recording.ui.ts', 'area-recovery.ui.spec.ts'], fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:5178', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5178 --strictPort', url: 'http://127.0.0.1:5178', reuseExistingServer: false },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'android', use: { ...devices['Pixel 5'] } },
    { name: 'small-android', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 640 } } },
    { name: 'android-landscape', use: { ...devices['Pixel 5'], viewport: { width: 740, height: 360 } } },
  ],
});
