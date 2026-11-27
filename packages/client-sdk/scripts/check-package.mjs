#!/usr/bin/env node
/**
 * Verifies that the package is publishable: the tarball npm would upload
 * contains the ESM, CJS and type outputs plus README/LICENSE, and the type
 * declarations do not depend on the private `@ateam/shared` workspace package.
 *
 * Run with `pnpm pack:check` (builds first) or `node scripts/check-package.mjs`.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const REQUIRED_FILES = [
  'package.json',
  'README.md',
  'LICENSE',
  'dist/index.js',
  'dist/index.cjs',
  'dist/index.d.ts'
]

const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: root,
  encoding: 'utf8'
})
const [tarball] = JSON.parse(output)
const files = new Set(tarball.files.map((file) => file.path))
const problems = []

for (const file of REQUIRED_FILES) {
  if (!files.has(file)) problems.push(`missing from tarball: ${file}`)
}

for (const [condition, target] of Object.entries(packageJson.exports?.['.'] ?? {})) {
  const relative = String(target).replace(/^\.\//, '')
  if (!files.has(relative)) problems.push(`export "${condition}" points to missing ${target}`)
}

const declarations = readFileSync(join(root, 'dist/index.d.ts'), 'utf8')
for (const dependency of ['@ateam/shared']) {
  const pattern = new RegExp(`from ['"]${dependency}['"]`)
  if (pattern.test(declarations)) {
    problems.push(`dist/index.d.ts still imports ${dependency}; inline it with tsup dts.resolve`)
  }
}
for (const exported of ['AteamClient', 'AteamApiError']) {
  if (!declarations.includes(exported))
    problems.push(`dist/index.d.ts does not declare ${exported}`)
}

if (problems.length > 0) {
  console.error(`Package check failed for ${packageJson.name}:`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(
  `Package check passed for ${packageJson.name}@${packageJson.version}: ` +
    `${files.size} files, ${tarball.size} bytes packed.`
)
