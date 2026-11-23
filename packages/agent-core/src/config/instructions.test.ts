import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  discoverInstructionFiles,
  discoverNestedInstructions,
  formatInstructions,
  loadConfiguredInstructions,
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
  it('loads global, then workspace rules from nearest to project root', async () => {
    const repo = path.join(directory, 'repo')
    await fs.mkdir(path.join(repo, '.git'))
    await write(path.join(globalDirectory, 'AGENTS.md'), 'global rules')
    await write(path.join(repo, 'AGENTS.md'), 'root rules')
    await write(path.join(repo, 'packages', 'AGENTS.md'), 'packages rules')
    await write(path.join(workspace, 'AGENTS.md'), 'web rules')

    const files = await discoverInstructionFiles(workspace, globalDirectory)

    expect(files.map((file) => path.relative(directory, file.path))).toEqual([
      'global/AGENTS.md',
      'repo/packages/web/AGENTS.md',
      'repo/packages/AGENTS.md',
      'repo/AGENTS.md'
    ])
    expect(files.map((file) => file.content)).toEqual([
      'global rules',
      'web rules',
      'packages rules',
      'root rules'
    ])
  })

  it('prefers AGENTS.md and falls back to CLAUDE.md in the same directory', async () => {
    const repo = path.join(directory, 'repo')
    await fs.mkdir(path.join(repo, '.git'))
    await write(path.join(repo, 'AGENTS.md'), 'agents root')
    await write(path.join(repo, 'CLAUDE.md'), 'claude root')
    await write(path.join(workspace, 'CLAUDE.md'), 'claude web')

    const files = await discoverInstructionFiles(workspace, globalDirectory)

    expect(files.map((file) => file.content)).toEqual(['claude web', 'agents root'])
  })

  it('stops at the workspace when there is no Git project root outside home', async () => {
    await write(path.join(directory, 'repo', 'AGENTS.md'), 'parent rules')
    await write(path.join(workspace, 'AGENTS.md'), 'web rules')

    const files = await discoverInstructionFiles(workspace, globalDirectory)

    expect(files.map((file) => file.content)).toEqual(['web rules'])
  })

  it('walks toward home when there is no Git project root inside home', async () => {
    const home = path.join(directory, 'home')
    const projectWorkspace = path.join(home, 'project', 'web')
    await fs.mkdir(projectWorkspace, { recursive: true })
    await write(path.join(home, 'AGENTS.md'), 'home rules')
    await write(path.join(home, 'project', 'AGENTS.md'), 'project rules')
    await write(path.join(projectWorkspace, 'AGENTS.md'), 'web rules')

    const files = await discoverInstructionFiles(projectWorkspace, globalDirectory, home)

    expect(files.map((file) => file.content)).toEqual(['web rules', 'project rules', 'home rules'])
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

describe('discoverNestedInstructions', () => {
  it('loads nested instructions once, nearest directory first', async () => {
    await write(path.join(workspace, 'sub', 'AGENTS.md'), 'sub rules')
    await write(path.join(workspace, 'sub', 'deep', 'AGENTS.md'), 'deep rules')
    const seen = new Set<string>()

    const first = await discoverNestedInstructions(workspace, 'sub/deep/a.txt', seen)
    const second = await discoverNestedInstructions(workspace, 'sub/deep/a.txt', seen)

    expect(first.map((file) => file.content)).toEqual(['deep rules', 'sub rules'])
    expect(second).toEqual([])
  })

  it('falls back to CLAUDE.md and ignores paths outside the workspace', async () => {
    await write(path.join(workspace, 'sub', 'CLAUDE.md'), 'claude sub')

    const nested = await discoverNestedInstructions(workspace, 'sub/a.txt', new Set())
    const outside = await discoverNestedInstructions(workspace, '../outside.txt', new Set())

    expect(nested.map((file) => file.content)).toEqual(['claude sub'])
    expect(outside).toEqual([])
  })
})

describe('loadConfiguredInstructions', () => {
  it('loads relative, absolute and home-relative files', async () => {
    const home = path.join(directory, 'home')
    await write(path.join(workspace, 'custom.md'), 'custom rules')
    await write(path.join(directory, 'absolute.md'), 'absolute rules')
    await write(path.join(home, 'rule.md'), 'home rules')

    const files = await loadConfiguredInstructions(
      ['custom.md', path.join(directory, 'absolute.md'), '~/rule.md'],
      workspace,
      home
    )

    expect(files.map((file) => file.content)).toEqual([
      'custom rules',
      'absolute rules',
      'home rules'
    ])
  })

  it('loads glob patterns and deduplicates files', async () => {
    await write(path.join(workspace, 'docs', 'a.md'), 'a rules')
    await write(path.join(workspace, 'docs', 'b.md'), 'b rules')

    const files = await loadConfiguredInstructions(
      ['docs/*.md', 'docs/a.md'],
      workspace,
      path.join(directory, 'home')
    )

    expect(files.map((file) => file.content)).toEqual(['a rules', 'b rules'])
  })

  it('loads remote instruction URLs', async () => {
    const fetchMock = vi.fn(async () => new Response('remote rules', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const files = await loadConfiguredInstructions(
      ['https://example.com/rules.md'],
      workspace,
      path.join(directory, 'home')
    )

    expect(files).toEqual([{ path: 'https://example.com/rules.md', content: 'remote rules' }])
    vi.unstubAllGlobals()
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
