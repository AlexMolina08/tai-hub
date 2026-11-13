import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.TAI_E2E_PORT ?? 5189)
if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new Error('TAI_E2E_PORT is not a valid port')
const origin = `http://localhost:${port}`
const outDir = `node_modules/.cache/tai-hub-e2e-${port}`

export default defineConfig({
  testDir: './e2e',
  outputDir: `test-results/${port}`,
  fullyParallel: true,
  use: { baseURL: origin, trace: 'retain-on-failure' },
  webServer: {
    command: `npm run build -- --outDir ${outDir} && npm run preview -- --outDir ${outDir} --port ${port} --strictPort`,
    env: { VITE_GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com' },
    url: `${origin}/tai-hub/`,
    timeout: 90_000,
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 16'], viewport: { width: 390, height: 844 } } },
  ],
})
