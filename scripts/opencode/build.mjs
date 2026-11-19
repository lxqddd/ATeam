import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const cliDir = path.join(repoRoot, 'packages/cli')
const outputDir = path.join(repoRoot, 'apps/desktop/resources/opencode')

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(' ')}`)
  execFileSync(command, args, { stdio: 'inherit', ...options })
}

const platform = process.platform
const arch = os.arch()
run(process.execPath, ['--import', 'tsx', 'script/build-node.ts', '--single'], { cwd: cliDir })

const binary = path.join(cliDir, 'dist', 'node', `cli-node-${platform}-${arch}`, 'bin', 'opencode2-node')
await fs.access(binary)
await fs.mkdir(outputDir, { recursive: true })
// Replace rather than overwrite in place: macOS caches code-signing state per inode, and an
// overwritten ad-hoc-signed binary can be killed on launch.
const destination = path.join(outputDir, 'opencode')
await fs.rm(destination, { force: true })
await fs.copyFile(binary, destination)
await fs.chmod(destination, 0o755)
console.log(`ATeam kernel built: ${destination}`)
