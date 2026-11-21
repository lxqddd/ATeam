import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const INSTRUCTION_FILE = 'AGENTS.md'
const FALLBACK_INSTRUCTION_FILE = 'CLAUDE.md'

export interface InstructionFile {
  path: string
  content: string
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile()
  } catch {
    return false
  }
}

async function hasGitEntry(directory: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(directory, '.git'))
    return stat.isDirectory() || stat.isFile()
  } catch {
    return false
  }
}

async function findProjectRoot(workspacePath: string): Promise<string | null> {
  let directory = path.resolve(workspacePath)
  for (;;) {
    if (await hasGitEntry(directory)) return directory
    const parent = path.dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

async function chooseInstructionFile(directory: string): Promise<string | null> {
  for (const name of [INSTRUCTION_FILE, FALLBACK_INSTRUCTION_FILE]) {
    const candidate = path.join(directory, name)
    if (await isFile(candidate)) return candidate
  }
  return null
}

async function readInstruction(
  filePath: string,
  seen: Set<string>
): Promise<InstructionFile | null> {
  try {
    const realPath = await fs.realpath(filePath)
    if (seen.has(realPath)) return null
    seen.add(realPath)
    return { path: realPath, content: await fs.readFile(realPath, 'utf8') }
  } catch {
    return null
  }
}

export async function instructionSearchDirectories(
  workspacePath: string,
  homeDirectory = os.homedir()
): Promise<string[]> {
  const workspace = path.resolve(workspacePath)
  const root = await findProjectRoot(workspace)
  const home = path.resolve(homeDirectory)
  const stop =
    root ?? (workspace === home || workspace.startsWith(`${home}${path.sep}`) ? home : null)
  if (stop === null) return [workspace]

  const chain: string[] = []
  let directory = workspace
  for (;;) {
    chain.push(directory)
    if (directory === stop) break
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return chain
}

/**
 * Loads the global instruction file followed by instruction files from the
 * workspace toward the project root (or home when no Git root exists), nearest
 * first. AGENTS.md wins over CLAUDE.md in the same directory.
 */
export async function discoverInstructionFiles(
  workspacePath: string,
  globalDirectory: string,
  homeDirectory = os.homedir()
): Promise<InstructionFile[]> {
  const seen = new Set<string>()
  const files: InstructionFile[] = []

  const globalFile = await chooseInstructionFile(globalDirectory)
  if (globalFile) {
    const loaded = await readInstruction(globalFile, seen)
    if (loaded) files.push(loaded)
  }

  for (const entry of await instructionSearchDirectories(workspacePath, homeDirectory)) {
    const instructionFile = await chooseInstructionFile(entry)
    if (!instructionFile) continue
    const loaded = await readInstruction(instructionFile, seen)
    if (loaded) files.push(loaded)
  }

  return files
}

export async function discoverNestedInstructions(
  workspacePath: string,
  targetPath: string,
  seen: Set<string>
): Promise<InstructionFile[]> {
  const workspace = path.resolve(workspacePath)
  const target = path.resolve(workspace, targetPath)
  if (target !== workspace && !target.startsWith(`${workspace}${path.sep}`)) return []

  let directory: string
  try {
    const stat = await fs.stat(target)
    directory = stat.isDirectory() ? target : path.dirname(target)
  } catch {
    directory = path.dirname(target)
  }

  const chain: string[] = []
  let current = directory
  for (;;) {
    chain.push(current)
    if (current === workspace) break
    const parent = path.dirname(current)
    if (parent === current || !parent.startsWith(`${workspace}${path.sep}`)) break
    current = parent
  }

  const files: InstructionFile[] = []
  for (const entry of chain) {
    const instructionFile = await chooseInstructionFile(entry)
    if (!instructionFile) continue
    const loaded = await readInstruction(instructionFile, seen)
    if (loaded) files.push(loaded)
  }
  return files
}

function matchGlob(pattern: string, value: string): boolean {
  const expression = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${expression}$`).test(value)
}

async function expandGlob(target: string): Promise<string[]> {
  if (!/[*?]/.test(target)) {
    return (await isFile(target)) ? [target] : []
  }
  const parsed = path.parse(target)
  const segments = target.slice(parsed.root.length).split(path.sep)
  const wildcardIndex = segments.findIndex((segment) => /[*?]/.test(segment))
  if (wildcardIndex < 0) return []
  const base = path.join(parsed.root, ...segments.slice(0, wildcardIndex))
  const pattern = segments.slice(wildcardIndex).join('/')
  const matches: string[] = []

  async function walk(directory: string, relative: string, depth: number): Promise<void> {
    if (depth > 8) return
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const next = relative ? `${relative}/${entry.name}` : entry.name
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute, next, depth + 1)
      } else if (entry.isFile() && matchGlob(pattern, next)) {
        matches.push(absolute)
      }
    }
  }

  await walk(base, '', 0)
  return matches.sort()
}

async function configuredCandidates(
  entry: string,
  directories: string[],
  homeDirectory: string
): Promise<string[]> {
  if (entry.startsWith('~/')) {
    return expandGlob(path.join(homeDirectory, entry.slice(2)))
  }
  if (path.isAbsolute(entry)) return expandGlob(entry)

  const candidates: string[] = []
  for (const directory of directories) {
    candidates.push(...(await expandGlob(path.join(directory, entry))))
  }
  return candidates
}

export async function loadConfiguredInstructions(
  entries: string[],
  workspacePath: string,
  homeDirectory = os.homedir()
): Promise<InstructionFile[]> {
  if (entries.length === 0) return []
  const directories = await instructionSearchDirectories(workspacePath, homeDirectory)
  const seen = new Set<string>()
  const files: InstructionFile[] = []

  for (const raw of entries) {
    const entry = raw.trim()
    if (!entry) continue
    if (/^https?:\/\//i.test(entry)) {
      try {
        const response = await fetch(entry, { signal: AbortSignal.timeout(5_000) })
        if (response.ok) files.push({ path: entry, content: await response.text() })
      } catch {
        /* remote instructions are best effort */
      }
      continue
    }
    for (const candidate of await configuredCandidates(entry, directories, homeDirectory)) {
      const loaded = await readInstruction(candidate, seen)
      if (loaded) files.push(loaded)
    }
  }

  return files
}

export function formatInstructions(files: InstructionFile[]): string {
  return files
    .filter((file) => file.content.trim())
    .map((file) => `## Instructions from ${file.path}\n\n${file.content.trim()}`)
    .join('\n\n')
}

export function systemWithInstructions(system: string, files: InstructionFile[]): string {
  const instructions = formatInstructions(files)
  if (!instructions) return system
  return `${system}\n\n# Project instructions\n\n${instructions}`
}
