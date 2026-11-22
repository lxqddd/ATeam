import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { searchFilesWithReferences, searchWorkspaceFiles } from './search'

let workspace: string

beforeEach(async () => {
  workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-files-')))
})

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true })
})

async function write(relative: string, content = ''): Promise<void> {
  const target = path.join(workspace, relative)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content)
}

describe('searchWorkspaceFiles', () => {
  it('matches paths case-insensitively and ranks basename hits first', async () => {
    await write('app.ts')
    await write('src/app/helper.ts')
    await write('docs/plan.md')

    await expect(searchWorkspaceFiles(workspace, 'APP')).resolves.toEqual([
      'app.ts',
      'src/app/helper.ts'
    ])
    await expect(searchWorkspaceFiles(workspace, 'plan')).resolves.toEqual(['docs/plan.md'])
  })

  it('ignores dependencies, build output and hidden directories', async () => {
    await write('src/index.ts')
    await write('node_modules/pkg/index.ts')
    await write('dist/index.js')
    await write('.git/config')
    await write('.cache/index.ts')

    await expect(searchWorkspaceFiles(workspace, 'index')).resolves.toEqual(['src/index.ts'])
  })

  it('returns nothing for empty queries and honours the limit', async () => {
    await write('a/one.ts')
    await write('a/two.ts')
    await write('a/three.ts')

    await expect(searchWorkspaceFiles(workspace, '  ')).resolves.toEqual([])
    await expect(searchWorkspaceFiles(workspace, 'a/', 2)).resolves.toHaveLength(2)
  })

  it('keeps results relative to the workspace', async () => {
    await write('src/main/index.ts')

    const [result] = await searchWorkspaceFiles(workspace, 'main')
    expect(result).toBe('src/main/index.ts')
  })
})

describe('searchFilesWithReferences', () => {
  it('suggests aliases and searches inside a referenced directory', async () => {
    const reference = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-reference-'))
    )
    try {
      await fs.mkdir(path.join(reference, 'api'), { recursive: true })
      await fs.writeFile(path.join(reference, 'guide.md'), '# guide')
      await fs.writeFile(path.join(reference, 'api', 'ref.md'), '# ref')
      await write('src/app.ts')
      await write('docs/readme.md')
      const references = [{ alias: 'docs', root: reference }]

      await expect(searchFilesWithReferences(workspace, 'doc', references)).resolves.toContain(
        'docs/'
      )
      await expect(searchFilesWithReferences(workspace, 'docs/gu', references)).resolves.toEqual([
        'docs/guide.md'
      ])
      const listed = await searchFilesWithReferences(workspace, 'docs/', references)
      expect(listed).toContain('docs/guide.md')
      expect(listed).toContain('docs/api/ref.md')
      expect(listed).toContain('docs/readme.md')
      await expect(searchFilesWithReferences(workspace, 'app', references)).resolves.toEqual([
        'src/app.ts'
      ])
    } finally {
      await fs.rm(reference, { recursive: true, force: true })
    }
  })
})
