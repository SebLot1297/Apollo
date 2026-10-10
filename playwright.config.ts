import { defineConfig, devices } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
const testData = mkdtempSync(path.join(tmpdir(), 'commandgrid-e2e-'))
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev:backend',
      url: 'http://127.0.0.1:8000/ready',
      reuseExistingServer: false,
      env: {
        DATABASE_URL: `sqlite:///${path.join(testData, 'e2e.db').replaceAll('\\', '/')}`,
        DATA_DIR: testData,
        APP_ENV: 'test',
        ENABLE_AI: 'false',
      },
    },
    {
      command: 'npm run dev:frontend',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
    },
  ],
})
