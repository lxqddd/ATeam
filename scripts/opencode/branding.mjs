import fs from 'node:fs/promises'
import path from 'node:path'

const PRODUCT_BRAND = 'OpenCode'
const PRODUCT_REPLACEMENT = 'ATeam'

// These are upstream hosted services and SDK names, not the product brand.
const PROTECTED_PHRASES = [
  'OpenCode Console',
  'OpenCode Go',
  'OpenCode Free',
  'OpenCode Zen',
  'OpenCode SDK',
  'OpenCode Anomaly',
]

const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const COPY_EXTENSIONS = new Set(['.txt', '.md'])

function placeholder(index) {
  return `\u0000OC_BRAND_${index}\u0000`
}

function brand(value) {
  let result = value
  PROTECTED_PHRASES.forEach((phrase, index) => {
    result = result.split(phrase).join(placeholder(index))
  })
  result = result.replaceAll(PRODUCT_BRAND, PRODUCT_REPLACEMENT)
  PROTECTED_PHRASES.forEach((phrase, index) => {
    result = result.split(placeholder(index)).join(phrase)
  })
  return result
}

function brandStringLiterals(source) {
  return source
    .replace(/"(?:[^"\\]|\\.)*"/g, (literal) => brand(literal))
    .replace(/'(?:[^'\\]|\\.)*'/g, (literal) => brand(literal))
    .replace(/`(?:[^`\\]|\\.)*`/g, (literal) => brand(literal))
}

function brandJson(value) {
  if (typeof value === 'string') {
    return brand(value)
  }
  if (Array.isArray(value)) {
    return value.map(brandJson)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, brandJson(item)]))
  }
  return value
}

async function brandFile(file) {
  const extension = path.extname(file)
  if (!TEXT_EXTENSIONS.has(extension) && !COPY_EXTENSIONS.has(extension) && extension !== '.json') {
    return
  }
  const source = await fs.readFile(file, 'utf8')
  let next = source
  if (extension === '.json') {
    try {
      next = JSON.stringify(brandJson(JSON.parse(source)), null, 2) + '\n'
    } catch {
      next = brand(source)
    }
  } else if (COPY_EXTENSIONS.has(extension)) {
    next = brand(source)
  } else {
    next = brandStringLiterals(source)
  }
  if (next !== source) {
    await fs.writeFile(file, next)
  }
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
      continue
    }
    const target = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(target)
    } else {
      await brandFile(target)
    }
  }
}

export async function applyBranding(sourceDir) {
  const roots = ['cli', 'core', 'server', 'tui', 'app', 'ui'].map((name) =>
    path.join(sourceDir, name, 'src'),
  )
  for (const root of roots) {
    try {
      await walk(root)
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error
      }
    }
  }

  // Product identity used in prompts, user agents, assistant self-description
  // and the CLI's user-facing name.
  const buildFile = path.join(sourceDir, 'cli', 'script', 'build.ts')
  try {
    let source = await fs.readFile(buildFile, 'utf8')
    source = source.replace('OPENCODE_CLI_NAME: "\'opencode\'"', 'OPENCODE_CLI_NAME: "\'ateam\'"')
    await fs.writeFile(buildFile, source)
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }

  const appFile = path.join(sourceDir, 'core', 'src', 'app.ts')
  try {
    let source = await fs.readFile(appFile, 'utf8')
    source = source.replace(
      'name: input.name ?? "opencode"',
      'name: input.name ?? "ateam"',
    )
    source = source.replace(
      'return `opencode/${app.channel}/${app.version}/${app.name}`',
      'return `ateam/${app.channel}/${app.version}/${app.name}`',
    )
    await fs.writeFile(appFile, source)
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }
}
