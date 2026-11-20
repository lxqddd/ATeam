import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const roots = ['apps/web/src', 'apps/desktop/src']
const extensions = new Set(['.ts', '.tsx', '.css'])

// Hosted service names (OpenCode Console/Go/Free/Zen/SDK) are identifiers we keep; a bare upstream
// product name in user-facing code is a leak.
const PROTECTED = /OpenCode(?![ -](Console|Go|Free|Zen|SDK|Anomaly))/

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const failures = []

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      walk(file)
      continue
    }
    if (!extensions.has(path.extname(entry.name))) continue
    const match = stripComments(fs.readFileSync(file, 'utf8')).match(PROTECTED)
    if (match) failures.push(`${path.relative(repoRoot, file)}: ${match[0]}`)
  }
}

for (const root of roots) {
  const directory = path.join(repoRoot, root)
  if (fs.existsSync(directory)) walk(directory)
}

const binary = path.join(repoRoot, 'apps/desktop/resources/kernel/ateam')
if (fs.existsSync(binary)) {
  const help = execFileSync(binary, ['--help'], { encoding: 'utf8' })
  if (!help.includes('ATeam')) failures.push('kernel --help does not mention ATeam')
  const bare = help.match(PROTECTED)
  if (bare) failures.push(`kernel --help: ${bare[0]}`)

  const version = execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim()
  if (!/ateam/i.test(version)) failures.push(`kernel --version: ${version}`)
}

if (failures.length > 0) {
  console.error('Brand check failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('Brand check passed')
