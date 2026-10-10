import { defineConfig, devices } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
const testData = mkdtempSync(path.join(tmpdir(), 'commandgrid-e2e-'))
const apiPort = Number(process.env.COMMANDGRID_TEST_API_PORT ?? 8000)
const frontendPort = Number(process.env.COMMANDGRID_TEST_FRONTEND_PORT ?? 5173)
const frontendURL = `http://127.0.0.1:${frontendPort}`
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: frontendURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `node scripts/backend.mjs -m uvicorn app.main:app --host 127.0.0.1 --port ${apiPort} --workers 1`,
      url: `http://127.0.0.1:${apiPort}/ready`,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: `sqlite:///${path.join(testData, 'e2e.db').replaceAll('\\', '/')}`,
        DATA_DIR: testData,
        APP_ENV: 'test',
        ENABLE_AI: 'false',
        CORS_ORIGINS: frontendURL,
      },
    },
    {
      command: `npm run dev --workspace frontend -- --host 127.0.0.1 --port ${frontendPort} --strictPort`,
      url: frontendURL,
      reuseExistingServer: false,
      env: { COMMANDGRID_API_PROXY: `http://127.0.0.1:${apiPort}` },
    },
  ],
})
