#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

// Measures what the renderer loads before the first paint: the entry script
// plus every modulepreload in out/renderer/index.html. Route chunks and other
// lazy imports are reported separately and are not part of the budget.
//
// Usage:
//   node scripts/bundle-report.mjs                  compare with the baseline
//   node scripts/bundle-report.mjs --check          fail when the budget is exceeded
//   node scripts/bundle-report.mjs --write-baseline record the current sizes
//   node scripts/bundle-report.mjs --json           machine-readable output

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(scriptDir, '..')
const rendererDir = join(appDir, 'out', 'renderer')
const indexPath = join(rendererDir, 'index.html')
const baselinePath = join(scriptDir, 'bundle-baseline.json')

const BUDGET_TOLERANCE = 0.02

const args = new Set(process.argv.slice(2))
const writeBaseline = args.has('--write-baseline')
const check = args.has('--check')
const asJson = args.has('--json')

function fail(message) {
  console.error(`bundle-report: ${message}`)
  process.exit(1)
}

function parseAttributes(tag) {
  const attributes = {}
  for (const match of tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
    attributes[match[1]] = match[2]
  }
  return attributes
}

function tags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((match) =>
    parseAttributes(match[0])
  )
}

function toFile(href) {
  if (!href || /^(https?:)?\/\//.test(href) || href.startsWith('data:')) return null
  const clean = href.split(/[?#]/)[0].replace(/^\.\//, '')
  const file = resolve(rendererDir, clean)
  const insideOutput = relative(rendererDir, file)
  if (!insideOutput || insideOutput.startsWith('..') || isAbsolute(insideOutput)) {
    fail(`asset escapes renderer output: ${href}`)
  }
  return file
}

function describe(file) {
  const bytes = readFileSync(file)
  return {
    file: relative(rendererDir, file),
    rawBytes: bytes.length,
    gzipBytes: gzipSync(bytes, { level: 9 }).length
  }
}

function sum(entries) {
  return entries.reduce(
    (total, entry) => ({
      rawBytes: total.rawBytes + entry.rawBytes,
      gzipBytes: total.gzipBytes + entry.gzipBytes
    }),
    { rawBytes: 0, gzipBytes: 0 }
  )
}

const formatSize = (bytes) => `${(bytes / 1024).toFixed(1)} kB`
const formatPercent = (value) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`

function readBaseline() {
  if (!existsSync(baselinePath)) return null
  try {
    return JSON.parse(readFileSync(baselinePath, 'utf8'))
  } catch (error) {
    fail(`cannot read ${relative(appDir, baselinePath)}: ${error.message}`)
  }
}

function writeBaselineFile(report, existing) {
  const history = existing?.history ?? []
  if (existing) {
    history.unshift({
      recordedAt: existing.recordedAt,
      initialJs: {
        rawBytes: existing.initialJs.rawBytes,
        gzipBytes: existing.initialJs.gzipBytes
      },
      initialCss: {
        rawBytes: existing.initialCss.rawBytes,
        gzipBytes: existing.initialCss.gzipBytes
      }
    })
  }
  const baseline = {
    note: 'First-screen renderer JS budget. Regenerate with: pnpm --filter @ateam/desktop bundle:report -- --write-baseline',
    recordedAt: new Date().toISOString().slice(0, 10),
    initialJs: report.initialJs,
    initialCss: report.initialCss,
    history: history.slice(0, 10)
  }
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)
}

if (!existsSync(indexPath)) {
  fail('out/renderer/index.html not found; run `pnpm --filter @ateam/desktop build` first')
}

const html = readFileSync(indexPath, 'utf8')
const initialJsFiles = new Set()
for (const script of tags(html, 'script')) {
  const file = toFile(script.src)
  if (file) initialJsFiles.add(file)
}

const initialCssFiles = new Set()
for (const link of tags(html, 'link')) {
  const rels = (link.rel ?? '').split(/\s+/)
  const file = toFile(link.href)
  if (!file) continue
  if (rels.includes('modulepreload')) initialJsFiles.add(file)
  if (rels.includes('stylesheet')) initialCssFiles.add(file)
}

const initialJs = [...initialJsFiles].map(describe)
const initialCss = [...initialCssFiles].map(describe)
const assetsDir = join(rendererDir, 'assets')
const allJs = existsSync(assetsDir)
  ? readdirSync(assetsDir)
      .filter((file) => file.endsWith('.js'))
      .map((file) => describe(join(assetsDir, file)))
      .sort((a, b) => b.rawBytes - a.rawBytes)
  : []
const lazyJs = allJs.filter((asset) => !initialJsFiles.has(resolve(rendererDir, asset.file)))

const report = {
  initialJs: { ...sum(initialJs), assets: initialJs },
  initialCss: { ...sum(initialCss), assets: initialCss },
  lazyJs: { ...sum(lazyJs), assets: lazyJs }
}

let baseline = readBaseline()

if (writeBaseline) {
  writeBaselineFile(report, baseline)
  baseline = readBaseline()
  if (!asJson) {
    console.log(
      `bundle-report: baseline written to ${relative(appDir, baselinePath)} (first-screen JS ${formatSize(report.initialJs.gzipBytes)} gzip)`
    )
  }
}

if (asJson) {
  console.log(JSON.stringify({ ...report, baseline }, null, 2))
  process.exit(0)
}

console.log('Renderer bundle report')
console.log('First-screen JS (entry + modulepreload):')
for (const asset of initialJs) {
  console.log(
    `  ${asset.file.padEnd(44)} ${formatSize(asset.rawBytes).padStart(10)} raw ${formatSize(asset.gzipBytes).padStart(10)} gzip`
  )
}
console.log(
  `  ${'total'.padEnd(44)} ${formatSize(report.initialJs.rawBytes).padStart(10)} raw ${formatSize(report.initialJs.gzipBytes).padStart(10)} gzip`
)
console.log(
  `First-screen CSS: ${formatSize(report.initialCss.rawBytes)} raw / ${formatSize(report.initialCss.gzipBytes)} gzip`
)
if (lazyJs.length > 0) {
  console.log('Lazy JS chunks (loaded on demand):')
  for (const asset of lazyJs) {
    console.log(
      `  ${asset.file.padEnd(44)} ${formatSize(asset.rawBytes).padStart(10)} raw ${formatSize(asset.gzipBytes).padStart(10)} gzip`
    )
  }
}

if (!baseline) {
  if (check) fail('no baseline recorded; run with --write-baseline first')
  console.log('\nNo baseline recorded yet. Run with --write-baseline to record it.')
} else {
  const budget = baseline.initialJs.gzipBytes
  const delta = report.initialJs.gzipBytes - budget
  console.log(
    `\nBaseline: ${formatSize(budget)} gzip (recorded ${baseline.recordedAt}); current ${formatSize(report.initialJs.gzipBytes)} gzip (${formatPercent(delta / budget)}).`
  )
  if (check && delta > budget * BUDGET_TOLERANCE) {
    fail(
      `first-screen JS exceeds the baseline by more than ${BUDGET_TOLERANCE * 100}% (${formatSize(delta)} over ${formatSize(budget)} gzip)`
    )
  }
}
