import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import base from '../playwright.config'

const servers = base.webServer
if (!Array.isArray(servers) || servers.length !== 2)
  throw new Error(
    'Expected the existing isolated backend and frontend servers.',
  )
const cwd = fileURLToPath(new URL('..', import.meta.url))
export default defineConfig({
  ...base,
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: 'mock-ai.smoke.ts',
  outputDir: '../test-results/mock-ai',
  webServer: [
    {
      ...servers[0],
      cwd,
      env: {
        ...servers[0].env,
        ENABLE_AI: 'true',
        DEMO_MODE: 'true',
        AI_PRIMARY_PROVIDER: 'mock',
        GEMINI_API_KEY: '',
        ENABLE_QWEN: 'false',
        QWEN_API_KEY: '',
      },
    },
    { ...servers[1], cwd },
  ],
})
