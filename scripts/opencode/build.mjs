import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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

const commit = (await fs.readFile(path.join(repoRoot, 'SOURCE_COMMIT'), 'utf8')).trim()
if (!/^[0-9a-f]{7,40}$/.test(commit)) {
  throw new Error(`SOURCE_COMMIT does not look like a commit hash: ${JSON.stringify(commit)}`)
}

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

const version = execFileSync(destination, ['--version'], { encoding: 'utf8' }).trim()
if (!version) throw new Error('ATeam kernel --version printed nothing')
const help = execFileSync(destination, ['--help'], { encoding: 'utf8' })
if (!help.includes('ATeam')) throw new Error('ATeam kernel help does not mention ATeam')
// Hosted service names (OpenCode Console/Go/Free/Zen/SDK) are legitimate; a bare upstream brand is not.
const upstream = help.match(/OpenCode(?![ -](Console|Go|Free|Zen|SDK|Anomaly))/)
if (upstream) {
  const at = upstream.index ?? 0
  throw new Error(`ATeam kernel help still shows the upstream brand near: ${help.slice(Math.max(0, at - 40), at + 40)}`)
}

const digest = createHash('sha256').update(await fs.readFile(destination)).digest('hex')
await fs.writeFile(path.join(outputDir, 'SHA256SUMS'), `${digest}  opencode\n`)

console.log(`ATeam kernel built: ${destination}`)
console.log(`  source commit: ${commit}`)
console.log(`  version: ${version}`)
console.log(`  sha256: ${digest}`)
