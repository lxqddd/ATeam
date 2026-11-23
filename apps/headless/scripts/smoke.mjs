import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

for (const name of ['cli', 'server', 'acp']) {
  const entry = path.join(root, 'dist', `${name}.js`)
  const result = spawnSync(process.execPath, [entry, '--help'], {
    encoding: 'utf8',
    timeout: 30_000
  })
  if (result.status !== 0) {
    console.error(`headless smoke failed for ${name} (exit ${result.status})`)
    console.error(result.stdout)
    console.error(result.stderr)
    process.exit(1)
  }
  if (!`${result.stdout}${result.stderr}`.includes('Usage:')) {
    console.error(`headless smoke failed for ${name}: missing usage output`)
    process.exit(1)
  }
}

console.log('headless smoke passed')
