import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'
import { loadEnv } from 'vite'

const projectDirectory = fileURLToPath(new URL('.', import.meta.url))
const fixtureEnv = loadEnv('development', projectDirectory, '')
const projectId = process.env.VITE_WC_PROJECT_ID ?? fixtureEnv.VITE_WC_PROJECT_ID
if (projectId) process.env.VITE_WC_PROJECT_ID = projectId

export default defineConfig({
  fullyParallel: true,
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  reporter: 'list',
  testDir: './specs',
  testMatch: '*.e2e.ts',
  use: { baseURL: 'http://127.0.0.1:4175' },
  webServer: {
    command: 'vite fixture --config fixture/vite.config.ts',
    reuseExistingServer: !process.env.CI,
    url: 'http://127.0.0.1:4175',
  },
})
