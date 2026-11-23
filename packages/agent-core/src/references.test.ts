import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isInsideReferences,
  referencesPrompt,
  resolveReferences,
  type ResolvedReference
} from './references'

let directory: string
let workspace: string
let globalDirectory: string
let cacheDirectory: string

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-refs-')))
  workspace = path.join(directory, 'workspace')
  globalDirectory = path.join(directory, 'global')
  cacheDirectory = path.join(directory, 'cache')
  await fs.mkdir(workspace, { recursive: true })
  await fs.mkdir(globalDirectory, { recursive: true })
  await fs.mkdir(cacheDirectory, { recursive: true })
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

async function makeDirectory(relative: string): Promise<string> {
  const target = path.join(directory, relative)
  await fs.mkdir(target, { recursive: true })
  return target
}

describe('resolveReferences', () => {
  it('resolves global and project references with descriptions', async () => {
    const docs = await makeDirectory('docs')
    const projectDocs = await makeDirectory('project-docs')
    await fs.mkdir(path.join(workspace, '.opencode'), { recursive: true })
    await fs.writeFile(
      path.join(workspace, '.opencode', 'references.json'),
      JSON.stringify({ project: { path: projectDocs, description: 'Project docs' } })
    )

    const references = await resolveReferences({
      references: [{ alias: 'docs', path: path.relative(globalDirectory, docs) }],
      workspacePath: workspace,
      globalDirectory,
      cacheDirectory
    })

    expect(references).toMatchObject([
      { alias: 'docs', root: docs, source: 'path' },
      { alias: 'project', root: projectDocs, description: 'Project docs', source: 'path' }
    ])
  })

  it('lets project references override global aliases', async () => {
    const first = await makeDirectory('first')
    const second = await makeDirectory('second')
    await fs.mkdir(path.join(workspace, '.opencode'), { recursive: true })
    await fs.writeFile(
      path.join(workspace, '.opencode', 'references.json'),
      JSON.stringify({ docs: second })
    )

    const references = await resolveReferences({
      references: [{ alias: 'docs', path: first }],
      workspacePath: workspace,
      globalDirectory,
      cacheDirectory
    })

    expect(references).toHaveLength(1)
    expect(references[0].root).toBe(second)
  })

  it('skips missing directories', async () => {
    const references = await resolveReferences({
      references: [{ alias: 'missing', path: path.join(directory, 'nope') }],
      workspacePath: workspace,
      globalDirectory,
      cacheDirectory
    })

    expect(references).toEqual([])
  })

  it('clones repositories into the cache', async () => {
    const exec = vi.fn(async (_file: string, args: string[]) => {
      const target = args[args.length - 1]
      await fs.mkdir(path.join(target, '.git'), { recursive: true })
      return { stdout: '', stderr: '' }
    })

    const references = await resolveReferences({
      references: [{ alias: 'sdk', repository: 'owner/repo', branch: 'main' }],
      workspacePath: workspace,
      globalDirectory,
      cacheDirectory,
      exec
    })

    expect(references).toMatchObject([
      { alias: 'sdk', source: 'repository', root: path.join(cacheDirectory, 'sdk-main') }
    ])
    expect(exec).toHaveBeenCalledWith('git', [
      'clone',
      '--depth',
      '1',
      '--branch',
      'main',
      'https://github.com/owner/repo.git',
      path.join(cacheDirectory, 'sdk-main')
    ])
  })
})

describe('referencesPrompt', () => {
  const references: ResolvedReference[] = [
    { alias: 'docs', root: '/refs/docs', description: 'Product docs', source: 'path' },
    { alias: 'sdk', root: '/refs/sdk', source: 'repository' }
  ]

  it('lists reference roots and descriptions', () => {
    expect(referencesPrompt(references)).toContain('- docs: /refs/docs — Product docs')
    expect(referencesPrompt(references)).toContain('- sdk: /refs/sdk')
    expect(referencesPrompt([])).toBe('')
  })

  it('checks containment', () => {
    expect(isInsideReferences('/refs/docs/guide.md', references, workspace)).toBe(true)
    expect(isInsideReferences('/refs/docs', references, workspace)).toBe(true)
    expect(isInsideReferences('/refs/other/file', references, workspace)).toBe(false)
  })
})
