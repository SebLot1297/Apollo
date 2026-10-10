import { spawnSync } from 'node:child_process'
import { root } from './backend.mjs'

const result = spawnSync(
  'uv',
  ['sync', '--project', 'backend', '--extra', 'dev', '--frozen'],
  { cwd: root, stdio: 'inherit' },
)
if (result.error) {
  console.error(
    'uv is required for Python 3.12+ setup. Install uv, then rerun npm run setup. See README.md.',
  )
  process.exit(1)
}
process.exit(result.status ?? 1)
