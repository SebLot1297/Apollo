import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const root = fileURLToPath(new URL('../', import.meta.url))
export const python = path.join(
  root,
  'backend',
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
)
export function requirePython() {
  if (!existsSync(python)) {
    console.error(
      'Backend environment missing. Run npm run setup from the Apollo repository.',
    )
    process.exit(1)
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  requirePython()
  const child = spawn(python, process.argv.slice(2), {
    cwd: root,
    stdio: 'inherit',
  })
  child.on('error', () => {
    console.error('Could not start the backend Python environment.')
    process.exitCode = 1
  })
  child.on('exit', (code) => {
    process.exitCode = code ?? 1
  })
}
