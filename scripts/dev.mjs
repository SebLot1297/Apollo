import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync } from 'node:fs'
import { root, python, requirePython } from './backend.mjs'

requirePython()
const npmCli = process.env.npm_execpath
if (!npmCli || !existsSync(npmCli)) {
  console.error('Start with npm run dev from the Apollo repository.')
  process.exit(1)
}
for (const port of [8000, 5173]) {
  await new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => {
      console.error(
        `Port ${port} is already in use. Stop that server or use separate dev:backend/dev:frontend commands.`,
      )
      process.exit(1)
    })
    probe.listen(port, '127.0.0.1', () => probe.close(resolve))
  })
}
const children = []
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  process.exitCode = code
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {}
    }
  }
}
function start(binary, args) {
  const child = spawn(binary, args, {
    cwd: root,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
    windowsHide: true,
  })
  children.push(child)
  child.on('error', () => {
    console.error('A development service could not start.')
    stop(1)
  })
  child.on('exit', (code) => {
    if (!stopping) stop(code ?? 1)
  })
}
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
start(python, [
  '-m',
  'uvicorn',
  'app.main:app',
  '--host',
  '127.0.0.1',
  '--port',
  '8000',
  '--workers',
  '1',
])
// Wait for real backend readiness before starting Vite.
let ready = false
for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
  try {
    const response = await fetch('http://127.0.0.1:8000/ready', {
      signal: AbortSignal.timeout(1000),
    })
    if (response.ok) {
      ready = true
      break
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500))
}
if (!ready) {
  console.error(
    'Backend readiness failed. Check database configuration and migrations in the output above.',
  )
  stop(1)
} else {
  start(process.execPath, [npmCli, 'run', 'dev:frontend'])
}
