import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WORKSPACE_FILE_LIMITS } from '@ateam/shared'
import {
  findWorkspaceFiles,
  grepWorkspaceFiles,
  listWorkspaceFiles,
  readWorkspaceFile,
  resolveWorkspacePath
} from './workspace-files'

let root: string
let outside: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-files-'))
  outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-files-outside-'))
  await fs.mkdir(path.join(root, 'src/nested'), { recursive: true })
  await fs.mkdir(path.join(root, 'node_modules'))
  await fs.mkdir(path.join(root, '.hidden'))
  await fs.writeFile(path.join(root, 'README.md'), '# readme\n')
  await fs.writeFile(path.join(root, 'src/main.ts'), 'const value = 1\n// TODO: fix\n')
  await fs.writeFile(path.join(root, 'src/nested/deep.ts'), 'export const deep = true\n')
  await fs.writeFile(path.join(root, 'node_modules/dep.js'), 'module.exports = {}\n')
  await fs.writeFile(path.join(root, '.hidden/secret.txt'), 'hidden\n')
  await fs.writeFile(path.join(outside, 'secret.txt'), 'top secret\n')
  await fs.symlink(outside, path.join(root, 'escape'))
  await fs.symlink(path.join(root, 'README.md'), path.join(root, 'readme-link.md'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(outside, { recursive: true, force: true })
})

describe('resolveWorkspacePath', () => {
  it('resolves paths inside the workspace and rejects escapes', async () => {
    await expect(resolveWorkspacePath(root, 'src/main.ts')).resolves.toMatchObject({
      relative: 'src/main.ts'
    })
    await expect(resolveWorkspacePath(root, '')).resolves.toMatchObject({ relative: '' })

    await expect(resolveWorkspacePath(root, '../outside.txt')).rejects.toThrow(
      'FILE_PATH_ESCAPES_WORKSPACE'
    )
    await expect(resolveWorkspacePath(root, path.join(outside, 'secret.txt'))).rejects.toThrow(
      'FILE_PATH_ESCAPES_WORKSPACE'
    )
    await expect(resolveWorkspacePath(root, 'escape/secret.txt')).rejects.toThrow(
      'FILE_PATH_ESCAPES_WORKSPACE'
    )
    await expect(resolveWorkspacePath(root, 'escape')).rejects.toThrow(
      'FILE_PATH_ESCAPES_WORKSPACE'
    )
    await expect(resolveWorkspacePath(root, 'missing.txt')).rejects.toThrow('FILE_NOT_FOUND')
    await expect(resolveWorkspacePath(root, 'bad\0name')).rejects.toThrow('FILE_INVALID_PATH')
  })
})

describe('listWorkspaceFiles', () => {
  it('lists entries by depth without following links or ignored directories', async () => {
    const flat = await listWorkspaceFiles(root)
    const names = flat.entries.map((entry) => entry.name)

    expect(flat).toMatchObject({ path: '', truncated: false })
    expect(names).toEqual(expect.arrayContaining(['.hidden', 'README.md', 'src']))
    expect(names).not.toContain('node_modules')
    expect(names).not.toContain('escape')
    expect(names).not.toContain('readme-link.md')
    expect(flat.entries.find((entry) => entry.name === 'README.md')).toMatchObject({
      path: 'README.md',
      type: 'file',
      size: 9
    })
    expect(flat.entries.find((entry) => entry.name === 'src')).toMatchObject({
      path: 'src',
      type: 'directory',
      size: null
    })

    const deep = await listWorkspaceFiles(root, { depth: 3 })
    const deepPaths = deep.entries.map((entry) => entry.path)
    expect(deepPaths).toEqual(
      expect.arrayContaining(['src/main.ts', 'src/nested', 'src/nested/deep.ts'])
    )
    expect(deepPaths.every((entry) => !entry.startsWith('node_modules'))).toBe(true)

    const scoped = await listWorkspaceFiles(root, { path: 'src', depth: 2 })
    expect(scoped).toMatchObject({ path: 'src', truncated: false })
    expect(scoped.entries.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(['src/main.ts', 'src/nested', 'src/nested/deep.ts'])
    )
  })

  it('truncates at the entry limit and validates the target', async () => {
    const limited = await listWorkspaceFiles(root, { depth: 3, limit: 2 })
    expect(limited.entries).toHaveLength(2)
    expect(limited.truncated).toBe(true)

    await expect(listWorkspaceFiles(root, { path: 'README.md' })).rejects.toThrow(
      'FILE_NOT_A_DIRECTORY'
    )
    await expect(listWorkspaceFiles(root, { path: 'missing' })).rejects.toThrow('FILE_NOT_FOUND')
  })
})

describe('readWorkspaceFile', () => {
  it('reads text files and truncates at the byte limit', async () => {
    const result = await readWorkspaceFile(root, 'src/main.ts')
    expect(result).toMatchObject({
      path: 'src/main.ts',
      content: 'const value = 1\n// TODO: fix\n',
      truncated: false
    })
    expect(result.size).toBe(Buffer.byteLength(result.content))

    const big = 'x'.repeat(WORKSPACE_FILE_LIMITS.readBytes + 10)
    await fs.writeFile(path.join(root, 'big.txt'), big)
    const truncated = await readWorkspaceFile(root, 'big.txt')
    expect(truncated.size).toBe(big.length)
    expect(truncated.content).toHaveLength(WORKSPACE_FILE_LIMITS.readBytes)
    expect(truncated.truncated).toBe(true)
  })

  it('rejects binary files, directories and escaping paths', async () => {
    await fs.writeFile(path.join(root, 'binary.bin'), Buffer.from([0x41, 0x00, 0x42]))

    await expect(readWorkspaceFile(root, 'binary.bin')).rejects.toThrow('FILE_BINARY')
    await expect(readWorkspaceFile(root, 'src')).rejects.toThrow('FILE_NOT_A_FILE')
    await expect(readWorkspaceFile(root, '../etc/passwd')).rejects.toThrow(
      'FILE_PATH_ESCAPES_WORKSPACE'
    )
    await expect(readWorkspaceFile(root, 'escape/secret.txt')).rejects.toThrow(
      'FILE_PATH_ESCAPES_WORKSPACE'
    )
  })
})

describe('findWorkspaceFiles', () => {
  it('finds files by glob pattern', async () => {
    const all = await findWorkspaceFiles(root, { pattern: '**/*.ts' })
    expect(all).toMatchObject({ root: '', pattern: '**/*.ts', truncated: false })
    expect(all.matches).toEqual(['src/main.ts', 'src/nested/deep.ts'])
    expect(all.matches.some((entry) => entry.startsWith('node_modules'))).toBe(false)
    expect(all.matches).not.toContain('.hidden/secret.txt')

    const scoped = await findWorkspaceFiles(root, { path: 'src', pattern: '*.ts' })
    expect(scoped).toMatchObject({ root: 'src' })
    expect(scoped.matches).toEqual(['src/main.ts'])

    const limited = await findWorkspaceFiles(root, { pattern: '**/*.ts', limit: 1 })
    expect(limited.matches).toHaveLength(1)
    expect(limited.truncated).toBe(true)

    await expect(findWorkspaceFiles(root, { pattern: '  ' })).rejects.toThrow(
      'FILE_INVALID_PATTERN'
    )
    await expect(findWorkspaceFiles(root, { path: 'README.md', pattern: '*.md' })).rejects.toThrow(
      'FILE_NOT_A_DIRECTORY'
    )
  })
})

describe('grepWorkspaceFiles', () => {
  it('searches contents with regex, literal, include and case filters', async () => {
    await fs.writeFile(path.join(root, 'src/lower.ts'), 'todo lower\n')

    const insensitive = await grepWorkspaceFiles(root, { pattern: 'todo' })
    expect(insensitive).toMatchObject({ root: '', pattern: 'todo', truncated: false })
    expect(insensitive.matches).toEqual([
      { path: 'src/lower.ts', line: 1, text: 'todo lower' },
      { path: 'src/main.ts', line: 2, text: '// TODO: fix' }
    ])

    const sensitive = await grepWorkspaceFiles(root, { pattern: 'todo', caseSensitive: true })
    expect(sensitive.matches).toEqual([{ path: 'src/lower.ts', line: 1, text: 'todo lower' }])

    const regex = await grepWorkspaceFiles(root, { pattern: 'const (value|deep)' })
    expect(regex.matches.map((match) => match.path)).toEqual(['src/main.ts', 'src/nested/deep.ts'])

    const literal = await grepWorkspaceFiles(root, { pattern: 'const (value', literal: true })
    expect(literal.matches).toEqual([])

    const included = await grepWorkspaceFiles(root, {
      path: 'src',
      pattern: 'deep',
      include: '*.ts'
    })
    expect(included.matches).toEqual([
      { path: 'src/nested/deep.ts', line: 1, text: 'export const deep = true' }
    ])

    const limited = await grepWorkspaceFiles(root, { pattern: 'e', limit: 1 })
    expect(limited.matches).toHaveLength(1)
    expect(limited.truncated).toBe(true)
  })

  it('skips binary and oversized files and rejects invalid patterns', async () => {
    await fs.writeFile(path.join(root, 'src/blob.bin'), Buffer.from([0x41, 0x00, 0x42]))
    await fs.writeFile(
      path.join(root, 'src/huge.ts'),
      `needle ${'x'.repeat(WORKSPACE_FILE_LIMITS.grepFileBytes)}`
    )

    const result = await grepWorkspaceFiles(root, { pattern: 'needle', path: 'src' })
    expect(result.matches).toEqual([])

    await expect(grepWorkspaceFiles(root, { pattern: '(' })).rejects.toThrow('FILE_INVALID_PATTERN')
    await expect(grepWorkspaceFiles(root, { pattern: '   ' })).rejects.toThrow(
      'FILE_INVALID_PATTERN'
    )
  })
})
