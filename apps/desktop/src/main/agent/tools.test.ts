import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ToolExecutionOptions } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createTools, type ToolContext } from './tools'

function execute(
  tool: unknown,
  input: Record<string, unknown>,
  options: { toolCallId?: string; signal?: AbortSignal } = {}
): Promise<string> {
  const executable = tool as {
    execute: (
      input: Record<string, unknown>,
      executionOptions: ToolExecutionOptions<never>
    ) => Promise<string>
  }
  return executable.execute(input, {
    toolCallId: options.toolCallId ?? 'call-1',
    messages: [],
    abortSignal: options.signal,
    context: undefined as never
  })
}

let directory: string
let tools: ReturnType<typeof createTools>
let askPermission: Mock<ToolContext['askPermission']>

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-test-')))
  askPermission = vi.fn<ToolContext['askPermission']>(async () => true)
  tools = createTools({
    workspace: directory,
    signal: new AbortController().signal,
    askPermission
  })
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('read tool', () => {
  it('returns numbered lines', async () => {
    await fs.writeFile(path.join(directory, 'a.txt'), 'one\ntwo\nthree')
    await expect(execute(tools.read, { path: 'a.txt' })).resolves.toBe(
      '    1  one\n    2  two\n    3  three'
    )
  })

  it('honours offset and limit', async () => {
    await fs.writeFile(path.join(directory, 'a.txt'), 'one\ntwo\nthree')
    await expect(execute(tools.read, { path: 'a.txt', offset: 2, limit: 1 })).resolves.toBe(
      '    2  two\n[showing lines 2-2 of 3]'
    )
  })

  it('rejects binary files', async () => {
    await fs.writeFile(path.join(directory, 'image.bin'), Buffer.from([0x89, 0x00, 0x01]))
    await expect(execute(tools.read, { path: 'image.bin' })).resolves.toBe(
      'Error: Binary files are not supported'
    )
  })

  it('returns errors as strings for missing files', async () => {
    const result = await execute(tools.read, { path: 'missing.txt' })
    expect(result.startsWith('Error:')).toBe(true)
  })

  it('blocks paths outside the workspace', async () => {
    await expect(execute(tools.read, { path: '../outside.txt' })).resolves.toBe(
      'Error: Path escapes workspace: ../outside.txt'
    )
  })

  it('blocks symlink escapes', async () => {
    const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-outside-')))
    try {
      await fs.writeFile(path.join(outside, 'secret.txt'), 'secret')
      await fs.symlink(outside, path.join(directory, 'link'))
      await expect(execute(tools.read, { path: 'link/secret.txt' })).resolves.toBe(
        'Error: Path escapes workspace: link/secret.txt'
      )
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })
})

describe('list tool', () => {
  async function seedTree(): Promise<void> {
    await fs.writeFile(path.join(directory, 'a.txt'), 'a')
    await fs.mkdir(path.join(directory, 'sub'))
    await fs.writeFile(path.join(directory, 'sub', 'b.txt'), 'b')
    await fs.mkdir(path.join(directory, '.git'))
    await fs.writeFile(path.join(directory, '.git', 'config'), 'x')
    await fs.mkdir(path.join(directory, 'node_modules'))
    await fs.writeFile(path.join(directory, 'node_modules', 'pkg.js'), 'x')
  }

  it('lists one level with directory markers and sorted entries', async () => {
    await seedTree()
    await expect(execute(tools.list, {})).resolves.toBe('a.txt\nsub/')
  })

  it('recurses when depth is greater than one', async () => {
    await seedTree()
    await expect(execute(tools.list, { depth: 2 })).resolves.toBe('a.txt\nsub/\nsub/b.txt')
  })

  it('reports empty directories', async () => {
    await fs.mkdir(path.join(directory, 'empty'))
    await expect(execute(tools.list, { path: 'empty' })).resolves.toBe('(empty directory)')
  })
})

describe('grep tool', () => {
  beforeEach(async () => {
    await fs.writeFile(path.join(directory, 'a.txt'), 'alpha\nbeta\ngamma')
    await fs.writeFile(path.join(directory, 'b.md'), 'beta')
  })

  it('reports matching lines with file and line number', async () => {
    const result = await execute(tools.grep, { pattern: 'beta' })
    expect(result).toContain('a.txt:2: beta')
    expect(result).toContain('b.md:1: beta')
  })

  it('filters by include pattern', async () => {
    await expect(execute(tools.grep, { pattern: 'beta', include: '*.md' })).resolves.toBe(
      'b.md:1: beta'
    )
  })

  it('stops at maxResults', async () => {
    const result = await execute(tools.grep, { pattern: 'beta', maxResults: 1 })
    expect(result.startsWith('[stopped at 1 matches]\n')).toBe(true)
    expect(result.split('\n').filter((line) => line.includes('beta'))).toHaveLength(1)
  })

  it('reports when nothing matches', async () => {
    await expect(execute(tools.grep, { pattern: 'nothing-here' })).resolves.toBe('No matches')
  })
})

describe('write tool', () => {
  it('writes after approval and creates parent directories', async () => {
    await expect(execute(tools.write, { path: 'nested/x.txt', content: 'data' })).resolves.toBe(
      'Wrote 4 bytes to nested/x.txt'
    )

    await expect(fs.readFile(path.join(directory, 'nested', 'x.txt'), 'utf8')).resolves.toBe('data')
    expect(askPermission).toHaveBeenCalledWith('write', 'nested/x.txt', 'write', 'call-1')
  })

  it('does not write when permission is denied', async () => {
    askPermission.mockResolvedValue(false)

    await expect(execute(tools.write, { path: 'x.txt', content: 'data' })).resolves.toBe(
      'Permission denied by user; the file was not written.'
    )
    await expect(fs.stat(path.join(directory, 'x.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('edit tool', () => {
  it('replaces a unique occurrence', async () => {
    await fs.writeFile(path.join(directory, 'a.txt'), 'hello world')

    await expect(
      execute(tools.edit, { path: 'a.txt', oldText: 'world', newText: 'there' })
    ).resolves.toBe('Replaced 1 occurrence(s) in a.txt')
    await expect(fs.readFile(path.join(directory, 'a.txt'), 'utf8')).resolves.toBe('hello there')
    expect(askPermission).toHaveBeenCalledWith('edit', 'a.txt', 'edit', 'call-1')
  })

  it('requires replaceAll for multiple occurrences', async () => {
    await fs.writeFile(path.join(directory, 'a.txt'), 'foo foo')

    await expect(
      execute(tools.edit, { path: 'a.txt', oldText: 'foo', newText: 'bar' })
    ).resolves.toBe('Error: oldText occurs 2 times; pass replaceAll or use a unique match')
  })

  it('replaces all occurrences when asked', async () => {
    await fs.writeFile(path.join(directory, 'a.txt'), 'foo foo')

    await expect(
      execute(tools.edit, { path: 'a.txt', oldText: 'foo', newText: 'bar', replaceAll: true })
    ).resolves.toBe('Replaced 2 occurrence(s) in a.txt')
    await expect(fs.readFile(path.join(directory, 'a.txt'), 'utf8')).resolves.toBe('bar bar')
  })

  it('reports missing text', async () => {
    await fs.writeFile(path.join(directory, 'a.txt'), 'hello')

    await expect(
      execute(tools.edit, { path: 'a.txt', oldText: 'absent', newText: 'x' })
    ).resolves.toBe('Error: oldText was not found')
  })

  it('does not edit when permission is denied', async () => {
    await fs.writeFile(path.join(directory, 'a.txt'), 'hello')
    askPermission.mockResolvedValue(false)

    await expect(
      execute(tools.edit, { path: 'a.txt', oldText: 'hello', newText: 'bye' })
    ).resolves.toBe('Permission denied by user; the file was not edited.')
    await expect(fs.readFile(path.join(directory, 'a.txt'), 'utf8')).resolves.toBe('hello')
  })
})

describe('shell tool', () => {
  it('runs commands inside the workspace after approval', async () => {
    await expect(execute(tools.shell, { command: 'printf hello' })).resolves.toBe('hello')
    expect(askPermission).toHaveBeenCalledWith('shell', 'printf hello', 'shell', 'call-1')
  })

  it('does not run commands when permission is denied', async () => {
    askPermission.mockResolvedValue(false)

    await expect(execute(tools.shell, { command: 'printf hi' })).resolves.toBe(
      'Permission denied by user; the command was not run.'
    )
  })

  it('rejects a working directory outside the workspace', async () => {
    await expect(execute(tools.shell, { command: 'pwd', cwd: '..' })).resolves.toBe(
      'Error: Path escapes workspace: ..'
    )
  })

  it('reports non-zero exit codes', async () => {
    if (process.platform === 'win32') return
    await expect(execute(tools.shell, { command: 'exit 3' })).resolves.toContain('[exit 3]')
  })

  it('interrupts running commands on abort', async () => {
    if (process.platform === 'win32') return
    const controller = new AbortController()
    const running = execute(tools.shell, { command: 'sleep 5' }, { signal: controller.signal })
    setTimeout(() => controller.abort(), 50)

    await expect(running).resolves.toContain('[command interrupted]')
  })

  it('times out long commands', async () => {
    if (process.platform === 'win32') return
    const result = await execute(tools.shell, { command: 'sleep 5', timeoutMs: 1_000 })
    expect(result).toContain('[command timed out after 1000ms]')
  })
})
