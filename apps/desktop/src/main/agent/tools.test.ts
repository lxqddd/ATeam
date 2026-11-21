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
let loadNested: Mock<(targetPath: string) => Promise<string>>

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-test-')))
  askPermission = vi.fn<ToolContext['askPermission']>(async () => true)
  loadNested = vi.fn(async () => '')
  tools = createTools({
    workspace: directory,
    signal: new AbortController().signal,
    askPermission,
    loadNestedInstructions: loadNested
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

  it('honours read permission denials', async () => {
    await fs.writeFile(path.join(directory, 'a.txt'), 'one')
    askPermission.mockResolvedValue(false)

    await expect(execute(tools.read, { path: 'a.txt' })).resolves.toBe(
      'Permission denied; the file was not read.'
    )
    expect(askPermission).toHaveBeenCalledWith('read', 'a.txt', 'read', 'call-1')
  })

  it('appends nested project instructions to the read result', async () => {
    await fs.mkdir(path.join(directory, 'sub'))
    await fs.writeFile(path.join(directory, 'sub', 'a.txt'), 'one')
    loadNested.mockResolvedValue('## Instructions from sub/AGENTS.md\n\nnested rule')

    const result = await execute(tools.read, { path: 'sub/a.txt' })

    expect(result).toContain('nested rule')
    expect(loadNested).toHaveBeenCalledWith('sub/a.txt')
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

  it('honours list permission denials', async () => {
    await seedTree()
    askPermission.mockResolvedValue(false)

    await expect(execute(tools.list, { path: '.' })).resolves.toBe(
      'Permission denied; the directory was not listed.'
    )
    expect(askPermission).toHaveBeenCalledWith('list', '.', 'list', 'call-1')
  })

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

  it('honours grep permission denials', async () => {
    askPermission.mockResolvedValue(false)

    await expect(execute(tools.grep, { pattern: 'beta' })).resolves.toBe(
      'Permission denied; the search was not run.'
    )
    expect(askPermission).toHaveBeenCalledWith('grep', 'beta', 'grep', 'call-1')
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
      'Permission denied; the file was not written.'
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
    ).resolves.toBe('Permission denied; the file was not edited.')
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
      'Permission denied; the command was not run.'
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

describe('tool limits and edge cases', () => {
  it('truncates very large file reads', async () => {
    await fs.writeFile(path.join(directory, 'big.txt'), 'a'.repeat(250_000))

    const result = await execute(tools.read, { path: 'big.txt' })

    expect(result).toContain('[output truncated at 200000 characters]')
  })

  it('blocks writes through symlinked parents', async () => {
    const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-outside-')))
    try {
      await fs.symlink(outside, path.join(directory, 'link'))

      await expect(execute(tools.write, { path: 'link/new.txt', content: 'x' })).resolves.toBe(
        'Error: Path escapes workspace: link/new.txt'
      )
      await expect(fs.stat(path.join(outside, 'new.txt'))).rejects.toMatchObject({
        code: 'ENOENT'
      })
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it('caps very large directory listings', async () => {
    await Promise.all(
      Array.from({ length: 505 }, (_, index) =>
        fs.writeFile(path.join(directory, `f${String(index).padStart(3, '0')}.txt`), 'x')
      )
    )

    const result = await execute(tools.list, {})

    expect(result.split('\n')).toHaveLength(500)
  })

  it('returns string errors for directory escapes', async () => {
    await expect(execute(tools.list, { path: '..' })).resolves.toBe(
      'Error: Path escapes workspace: ..'
    )
  })

  it('returns a string error for invalid grep patterns', async () => {
    const result = await execute(tools.grep, { pattern: '(' })

    expect(result.startsWith('Error:')).toBe(true)
  })

  it('searches nested directories and skips ignored folders', async () => {
    await fs.mkdir(path.join(directory, 'nested', 'deep'), { recursive: true })
    await fs.writeFile(path.join(directory, 'nested', 'deep', 'found.txt'), 'needle')
    await fs.mkdir(path.join(directory, '.git'))
    await fs.writeFile(path.join(directory, '.git', 'hidden.txt'), 'needle')
    await fs.mkdir(path.join(directory, 'node_modules'))
    await fs.writeFile(path.join(directory, 'node_modules', 'pkg.js'), 'needle')

    const result = await execute(tools.grep, { pattern: 'needle' })

    expect(result).toContain('nested/deep/found.txt:1: needle')
    expect(result).not.toContain('.git')
    expect(result).not.toContain('node_modules')
  })

  it('stops walking very deep trees', async () => {
    let current = directory
    for (let index = 0; index < 10; index += 1) {
      current = path.join(current, `d${index}`)
      await fs.mkdir(current)
    }
    await fs.writeFile(path.join(current, 'deep.txt'), 'needle')

    await expect(execute(tools.grep, { pattern: 'needle' })).resolves.toBe('No matches')
  })

  it('skips binary files during grep', async () => {
    await fs.writeFile(
      path.join(directory, 'bin.dat'),
      Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0x00])
    )
    await fs.writeFile(path.join(directory, 'a.txt'), 'needle')

    await expect(execute(tools.grep, { pattern: 'needle' })).resolves.toBe('a.txt:1: needle')
  })

  it('matches plain include substrings', async () => {
    await fs.writeFile(path.join(directory, 'a.txt'), 'needle')
    await fs.writeFile(path.join(directory, 'b.md'), 'needle')

    await expect(execute(tools.grep, { pattern: 'needle', include: 'md' })).resolves.toBe(
      'b.md:1: needle'
    )
  })

  it('rejects files over 1 MB', async () => {
    await expect(
      execute(tools.write, { path: 'big.txt', content: 'a'.repeat(1_000_001) })
    ).resolves.toBe('Error: file content exceeds 1 MB')
  })

  it('rejects oversized edit searches', async () => {
    await fs.writeFile(path.join(directory, 'a.txt'), 'x')

    await expect(
      execute(tools.edit, { path: 'a.txt', oldText: 'a'.repeat(200_001), newText: 'b' })
    ).resolves.toBe('Error: oldText is too large')
  })

  it('blocks edits outside the workspace', async () => {
    await expect(
      execute(tools.edit, { path: '../outside.txt', oldText: 'a', newText: 'b' })
    ).resolves.toBe('Error: Path escapes workspace: ../outside.txt')
  })

  it('truncates large command output', async () => {
    const command = `node -e "process.stdout.write('a'.repeat(300000))"`

    const result = await execute(tools.shell, { command })

    expect(result).toContain('[output truncated at 200000 characters]')
  })
})
