import { defineConfig } from '@playwright/test'

export default defineConfig({
  fullyParallel: true,
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  reporter: 'list',
  testDir: './specs',
  testMatch: '*.e2e.ts',
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'vite fixture --config fixture/vite.config.ts',
    reuseExistingServer: !process.env.CI,
    url: 'http://127.0.0.1:4173',
  },
})
