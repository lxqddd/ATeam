import { execFileSync } from 'node:child_process'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyBranding } from './branding.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const vendoredSource = path.join(repoRoot, 'apps/desktop/src/runtime/opencode')
const sourceDir =
  process.env.OPENCODE_SOURCE ||
  (fsSync.existsSync(vendoredSource) ? vendoredSource : path.join(repoRoot, '.opencode-src'))
const outputDir = path.join(repoRoot, 'apps/desktop/resources/opencode')
const ref = process.env.OPENCODE_REF || 'dev'
const bun = process.env.BUN_BIN || 'bun'
const bunPath = bun.includes(path.sep)
  ? path.resolve(bun)
  : execFileSync('sh', ['-c', 'command -v bun'], { encoding: 'utf8' }).trim()
const childEnv = {
  ...process.env,
  PATH: `${path.dirname(bunPath)}${path.delimiter}${process.env.PATH ?? ''}`,
}

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(' ')}`)
  execFileSync(command, args, { stdio: 'inherit', env: childEnv, ...options })
}

function bunVersion() {
  try {
    return execFileSync(bun, ['--version'], { encoding: 'utf8' }).trim()
  } catch {
    throw new Error(`Bun is required to build the OpenCode kernel. Set BUN_BIN or install Bun >= 1.4.4.`)
  }
}

const version = bunVersion()
const [major, minor] = version.split('.').map(Number)
if (major < 1 || (major === 1 && minor < 4)) {
  throw new Error(`OpenCode requires Bun >= 1.4.4, found ${version}. Set BUN_BIN to a newer Bun.`)
}

const hasGit = await fs.access(path.join(sourceDir, '.git')).then(() => true).catch(() => false)
const hasSource = await fs.access(path.join(sourceDir, 'packages')).then(() => true).catch(() => false)
if (hasGit) {
  run('git', ['fetch', '--depth', '1', 'origin', ref], { cwd: sourceDir })
  run('git', ['checkout', '--detach', 'FETCH_HEAD'], { cwd: sourceDir })
  run('git', ['reset', '--hard', 'FETCH_HEAD'], { cwd: sourceDir })
} else if (!hasSource) {
  await fs.rm(sourceDir, { recursive: true, force: true })
  run('git', ['clone', '--depth', '1', '--branch', ref, 'https://github.com/anomalyco/opencode.git', sourceDir])
}

await applyBranding(sourceDir)

if (!(await fs.stat(path.join(sourceDir, 'node_modules')).catch(() => null))) {
  run(bun, ['install'], { cwd: sourceDir })
}

const buildDir = path.join(repoRoot, '.opencode-build')
await fs.rm(buildDir, { recursive: true, force: true })
run(
  bun,
  [
    'run',
    '--cwd',
    'packages/cli',
    'build',
    '--single',
    '--skip-web-ui',
    '--skip-install',
    `--outdir=${buildDir}`,
  ],
  { cwd: sourceDir },
)

const platform = process.platform
const arch = os.arch()
const binary = path.join(buildDir, `cli-${platform}-${arch}`, 'bin', 'opencode')
await fs.access(binary)
await fs.mkdir(outputDir, { recursive: true })
await fs.copyFile(binary, path.join(outputDir, 'opencode'))
await fs.chmod(path.join(outputDir, 'opencode'), 0o755)
console.log(`OpenCode source kernel built: ${path.join(outputDir, 'opencode')}`)
