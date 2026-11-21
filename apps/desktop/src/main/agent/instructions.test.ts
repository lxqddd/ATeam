import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  discoverInstructionFiles,
  formatInstructions,
  systemWithInstructions
} from './instructions'

let directory: string
let globalDirectory: string
let workspace: string

async function write(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf8')
}

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-instructions-')))
  globalDirectory = path.join(directory, 'global')
  workspace = path.join(directory, 'repo', 'packages', 'web')
  await fs.mkdir(globalDirectory, { recursive: true })
  await fs.mkdir(workspace, { recursive: true })
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('discoverInstructionFiles', () => {
  it('loads global, project root and workspace files in order', async () => {
    const repo = path.join(directory, 'repo')
    await fs.mkdir(path.join(repo, '.git'))
    await write(path.join(globalDirectory, 'AGENTS.md'), 'global rules')
    await write(path.join(repo, 'AGENTS.md'), 'root rules')
    await write(path.join(repo, 'packages', 'AGENTS.md'), 'packages rules')
    await write(path.join(workspace, 'AGENTS.md'), 'web rules')

    const files = await discoverInstructionFiles(workspace, globalDirectory)

    expect(files.map((file) => path.relative(directory, file.path))).toEqual([
      'global/AGENTS.md',
      'repo/AGENTS.md',
      'repo/packages/AGENTS.md',
      'repo/packages/web/AGENTS.md'
    ])
    expect(files.map((file) => file.content)).toEqual([
      'global rules',
      'root rules',
      'packages rules',
      'web rules'
    ])
  })

  it('prefers AGENTS.md and falls back to CLAUDE.md in the same directory', async () => {
    const repo = path.join(directory, 'repo')
    await fs.mkdir(path.join(repo, '.git'))
    await write(path.join(repo, 'AGENTS.md'), 'agents root')
    await write(path.join(repo, 'CLAUDE.md'), 'claude root')
    await write(path.join(workspace, 'CLAUDE.md'), 'claude web')

    const files = await discoverInstructionFiles(workspace, globalDirectory)

    expect(files.map((file) => file.content)).toEqual(['agents root', 'claude web'])
  })

  it('stops at the workspace when there is no Git project root', async () => {
    await write(path.join(directory, 'repo', 'AGENTS.md'), 'parent rules')
    await write(path.join(workspace, 'AGENTS.md'), 'web rules')

    const files = await discoverInstructionFiles(workspace, globalDirectory)

    expect(files.map((file) => file.content)).toEqual(['web rules'])
  })

  it('deduplicates symlinked instruction files', async () => {
    const repo = path.join(directory, 'repo')
    await fs.mkdir(path.join(repo, '.git'))
    await write(path.join(repo, 'AGENTS.md'), 'shared rules')
    await fs.symlink(path.join(repo, 'AGENTS.md'), path.join(globalDirectory, 'AGENTS.md'))

    const files = await discoverInstructionFiles(workspace, globalDirectory)

    expect(files).toHaveLength(1)
    expect(files[0].content).toBe('shared rules')
  })

  it('returns no files when nothing exists', async () => {
    expect(await discoverInstructionFiles(workspace, globalDirectory)).toEqual([])
  })
})

describe('formatInstructions', () => {
  it('labels each file and skips empty content', () => {
    const text = formatInstructions([
      { path: '/repo/AGENTS.md', content: 'root rules' },
      { path: '/repo/packages/web/AGENTS.md', content: '   ' },
      { path: '/repo/CLAUDE.md', content: 'claude rules' }
    ])

    expect(text).toContain('## Instructions from /repo/AGENTS.md')
    expect(text).toContain('root rules')
    expect(text).toContain('## Instructions from /repo/CLAUDE.md')
    expect(text).toContain('claude rules')
    expect(text).not.toContain('/repo/packages/web/AGENTS.md')
  })

  it('returns an empty string without usable files', () => {
    expect(formatInstructions([])).toBe('')
  })
})

describe('systemWithInstructions', () => {
  it('appends labelled project instructions to the system prompt', () => {
    const system = systemWithInstructions('Base prompt', [
      { path: '/repo/AGENTS.md', content: 'Run bun test' }
    ])

    expect(system).toContain('Base prompt')
    expect(system).toContain('Project instructions')
    expect(system).toContain('Run bun test')
  })

  it('leaves the system prompt unchanged without instructions', () => {
    expect(systemWithInstructions('Base prompt', [])).toBe('Base prompt')
    expect(
      systemWithInstructions('Base prompt', [{ path: '/repo/AGENTS.md', content: '  ' }])
    ).toBe('Base prompt')
  })
})
