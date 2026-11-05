import { defineConfig, devices } from '@playwright/test'

const origin = 'http://localhost:5189'
const outDir = 'node_modules/.cache/tai-hub-e2e'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: { baseURL: origin, trace: 'retain-on-failure' },
  webServer: {
    command: `npm run build -- --outDir ${outDir} && npm run preview -- --outDir ${outDir} --port 5189 --strictPort`,
    env: { VITE_GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com' },
    url: `${origin}/tai-hub/`,
    timeout: 90_000,
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 16'] } },
  ],
})
