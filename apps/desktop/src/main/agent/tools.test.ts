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
let baseContext: ToolContext
let askPermission: Mock<ToolContext['askPermission']>
let loadNested: Mock<(targetPath: string) => Promise<string>>
let storeOutput: Mock<NonNullable<ToolContext['storeOutput']>>
let onToolOutput: Mock<NonNullable<ToolContext['onToolOutput']>>
let backgroundOutputPath: Mock<NonNullable<ToolContext['backgroundOutputPath']>>
let onBackgroundFinished: Mock<NonNullable<ToolContext['onBackgroundFinished']>>
let formatFiles: Mock<NonNullable<ToolContext['formatFiles']>>
let diagnoseFiles: Mock<NonNullable<ToolContext['diagnoseFiles']>>
let runSubagent: Mock<NonNullable<ToolContext['runSubagent']>>
let fetchWeb: Mock<NonNullable<ToolContext['fetchWeb']>>
let webSearch: Mock<NonNullable<ToolContext['webSearch']>>
let loadSkill: Mock<NonNullable<ToolContext['loadSkill']>>

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-test-')))
  askPermission = vi.fn<ToolContext['askPermission']>(async () => true)
  loadNested = vi.fn(async () => '')
  storeOutput = vi.fn(async (_toolCallId: string, output: string) => ({ output }))
  onToolOutput = vi.fn()
  backgroundOutputPath = vi.fn(async () => path.join(directory, 'bg.log'))
  onBackgroundFinished = vi.fn()
  formatFiles = vi.fn(async () => '')
  diagnoseFiles = vi.fn(async () => '')
  runSubagent = vi.fn(async () => 'child result')
  fetchWeb = vi.fn(async () => 'fetched page')
  webSearch = vi.fn(async () => 'search results')
  loadSkill = vi.fn(async () => '# Skill instructions')
  baseContext = {
    workspace: directory,
    signal: new AbortController().signal,
    askPermission,
    loadNestedInstructions: loadNested,
    storeOutput,
    onToolOutput,
    backgroundOutputPath,
    onBackgroundFinished,
    formatFiles,
    diagnoseFiles,
    runSubagent,
    fetchWeb,
    webSearch,
    loadSkill
  }
  tools = createTools(baseContext)
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

  it('stores large tool output through the output store', async () => {
    await fs.writeFile(path.join(directory, 'a.txt'), 'one')
    storeOutput.mockResolvedValue({ output: 'stored output', path: '/tmp/full.txt' })

    await expect(execute(tools.read, { path: 'a.txt' })).resolves.toBe('stored output')
    expect(storeOutput).toHaveBeenCalledWith('call-1', expect.stringContaining('one'))
  })

  it('allows external files after external-directory approval', async () => {
    const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-outside-')))
    try {
      const file = path.join(outside, 'note.txt')
      await fs.writeFile(file, 'outside')

      await expect(execute(tools.read, { path: file })).resolves.toBe('    1  outside')
      expect(askPermission).toHaveBeenCalledWith('external_directory', file, 'read', 'call-1')
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it('denies external files when external-directory approval is denied', async () => {
    const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-outside-')))
    try {
      const file = path.join(outside, 'note.txt')
      await fs.writeFile(file, 'outside')
      askPermission.mockImplementation(async (action) => action !== 'external_directory')

      await expect(execute(tools.read, { path: file })).resolves.toBe(
        'Permission denied; the file was not read.'
      )
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
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

  it('supports literal and case-sensitive search options', async () => {
    await fs.writeFile(path.join(directory, 'literal.txt'), 'a.b\naxb')

    await expect(
      execute(tools.grep, { pattern: 'a.b', path: '.', literal: true })
    ).resolves.toContain('literal.txt:1: a.b')
    await expect(
      execute(tools.grep, { pattern: 'a.b', path: '.', literal: true })
    ).resolves.not.toContain('literal.txt:2: axb')

    await fs.writeFile(path.join(directory, 'case.txt'), 'Beta')
    await expect(
      execute(tools.grep, { pattern: 'beta', path: '.', caseSensitive: true })
    ).resolves.not.toContain('case.txt')
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

describe('glob tool', () => {
  beforeEach(async () => {
    await fs.mkdir(path.join(directory, 'src', 'nested'), { recursive: true })
    await fs.writeFile(path.join(directory, 'src', 'a.ts'), 'a')
    await fs.writeFile(path.join(directory, 'src', 'nested', 'b.ts'), 'b')
    await fs.writeFile(path.join(directory, 'src', 'c.js'), 'c')
    await fs.writeFile(path.join(directory, 'src', '.hidden.ts'), 'h')
    await fs.writeFile(path.join(directory, 'root.md'), 'r')
  })

  it('finds files by glob pattern', async () => {
    await expect(execute(tools.glob, { pattern: '**/*.ts' })).resolves.toBe(
      'src/a.ts\nsrc/nested/b.ts'
    )
  })

  it('supports path scoping, hidden files and limits', async () => {
    await expect(execute(tools.glob, { pattern: '*.ts', path: 'src' })).resolves.toBe('src/a.ts')
    await expect(execute(tools.glob, { pattern: '*.ts', path: 'src', hidden: true })).resolves.toBe(
      'src/.hidden.ts\nsrc/a.ts'
    )
    await expect(execute(tools.glob, { pattern: '**/*', limit: 2 })).resolves.toContain(
      '[stopped at 2 results]'
    )
  })

  it('honours list permission denial', async () => {
    askPermission.mockResolvedValue(false)

    await expect(execute(tools.glob, { pattern: '**/*.ts' })).resolves.toBe(
      'Permission denied; the file search was not run.'
    )
    expect(askPermission).toHaveBeenCalledWith('list', '**/*.ts', 'glob', 'call-1')
  })
})

describe('patch tool', () => {
  it('adds, updates and deletes files in one patch', async () => {
    await fs.writeFile(path.join(directory, 'existing.txt'), 'old')
    await fs.writeFile(path.join(directory, 'gone.txt'), 'gone')
    const patchText = [
      '*** Begin Patch',
      '*** Add File: added.txt',
      '+hello',
      '*** Update File: existing.txt',
      '@@',
      '-old',
      '+new',
      '*** Delete File: gone.txt',
      '*** End Patch'
    ].join('\n')

    const result = await execute(tools.patch, { patchText })

    expect(await fs.readFile(path.join(directory, 'added.txt'), 'utf8')).toBe('hello')
    expect(await fs.readFile(path.join(directory, 'existing.txt'), 'utf8')).toBe('new')
    await expect(fs.stat(path.join(directory, 'gone.txt'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    expect(result).toContain('added.txt')
    expect(result).toContain('existing.txt')
    expect(result).toContain('gone.txt')
  })

  it('asks edit permission for every file before applying anything', async () => {
    askPermission.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const patchText = [
      '*** Begin Patch',
      '*** Add File: one.txt',
      '+one',
      '*** Add File: two.txt',
      '+two',
      '*** End Patch'
    ].join('\n')

    await expect(execute(tools.patch, { patchText })).resolves.toBe(
      'Permission denied; the patch was not applied.'
    )
    await expect(fs.stat(path.join(directory, 'one.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(askPermission).toHaveBeenNthCalledWith(1, 'edit', 'one.txt', 'patch', 'call-1')
    expect(askPermission).toHaveBeenNthCalledWith(2, 'edit', 'two.txt', 'patch', 'call-1')
  })

  it('denies external paths when external-directory approval is denied', async () => {
    askPermission.mockImplementation(async (action) => action !== 'external_directory')
    const patchText = [
      '*** Begin Patch',
      '*** Add File: ../outside.txt',
      '+nope',
      '*** End Patch'
    ].join('\n')

    await expect(execute(tools.patch, { patchText })).resolves.toBe(
      'Permission denied; the patch was not applied.'
    )
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

  it('streams shell output deltas', async () => {
    await execute(tools.shell, { command: 'printf hello' })

    expect(onToolOutput).toHaveBeenCalledWith('call-1', 'hello')
  })

  it('runs background commands and notifies on completion', async () => {
    const result = await execute(tools.shell, {
      command: 'printf background-output',
      background: true
    })

    expect(result).toContain('Started background command')
    await vi.waitFor(() => expect(onBackgroundFinished).toHaveBeenCalled())
    const info = onBackgroundFinished.mock.calls[0][0]
    expect(info.exitCode).toBe(0)
    expect(info.outputPath).toBe(path.join(directory, 'bg.log'))
    expect(await fs.readFile(info.outputPath ?? '', 'utf8')).toContain('background-output')
  })

  it('does not run commands when permission is denied', async () => {
    askPermission.mockResolvedValue(false)

    await expect(execute(tools.shell, { command: 'printf hi' })).resolves.toBe(
      'Permission denied; the command was not run.'
    )
  })

  it('denies external working directories without external approval', async () => {
    askPermission.mockImplementation(async (action) => action !== 'external_directory')

    await expect(execute(tools.shell, { command: 'pwd', cwd: '..' })).resolves.toBe(
      'Permission denied; the command was not run.'
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

  it('denies directory escapes without external approval', async () => {
    askPermission.mockImplementation(async (action) => action !== 'external_directory')

    await expect(execute(tools.list, { path: '..' })).resolves.toBe(
      'Permission denied; the directory was not listed.'
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

  it('denies edits outside the workspace without external approval', async () => {
    askPermission.mockImplementation(async (action) => action !== 'external_directory')

    await expect(
      execute(tools.edit, { path: '../outside.txt', oldText: 'a', newText: 'b' })
    ).resolves.toBe('Permission denied; the file was not edited.')
  })

  it('truncates large command output', async () => {
    const command = `node -e "process.stdout.write('a'.repeat(300000))"`

    const result = await execute(tools.shell, { command })

    expect(result).toContain('[output truncated at 200000 characters]')
  })
})

describe('formatting and diagnostics', () => {
  it('appends diagnostics to read results', async () => {
    await fs.writeFile(path.join(directory, 'a.ts'), 'const x = 1')
    diagnoseFiles.mockResolvedValue('LSP diagnostics:\na.ts:1:1 error: x')

    await expect(execute(tools.read, { path: 'a.ts' })).resolves.toBe(
      '    1  const x = 1\n\nLSP diagnostics:\na.ts:1:1 error: x'
    )
    expect(diagnoseFiles).toHaveBeenCalledWith([path.join(directory, 'a.ts')])
  })

  it('leaves read results unchanged without diagnostics', async () => {
    await fs.writeFile(path.join(directory, 'a.txt'), 'one')
    await expect(execute(tools.read, { path: 'a.txt' })).resolves.toBe('    1  one')
  })

  it('formats and diagnoses files after write', async () => {
    formatFiles.mockResolvedValue('Formatted a.ts with prettier')
    diagnoseFiles.mockResolvedValue('LSP diagnostics:\na.ts:1:1 error: bad')

    const result = await execute(tools.write, { path: 'a.ts', content: 'x' })

    expect(result).toBe(
      'Wrote 1 bytes to a.ts\n\nFormatted a.ts with prettier\n\nLSP diagnostics:\na.ts:1:1 error: bad'
    )
    expect(formatFiles).toHaveBeenCalledWith([path.join(directory, 'a.ts')])
    expect(diagnoseFiles).toHaveBeenCalledWith([path.join(directory, 'a.ts')])
    expect(formatFiles.mock.invocationCallOrder[0]).toBeLessThan(
      diagnoseFiles.mock.invocationCallOrder[0]
    )
  })

  it('keeps diagnostics when formatting fails', async () => {
    formatFiles.mockResolvedValue('Formatter failed for a.ts: parse error')
    diagnoseFiles.mockResolvedValue('LSP diagnostics:\na.ts:1:1 error: bad')

    const result = await execute(tools.write, { path: 'a.ts', content: 'x' })

    expect(result).toBe(
      'Wrote 1 bytes to a.ts\n\nFormatter failed for a.ts: parse error\n\nLSP diagnostics:\na.ts:1:1 error: bad'
    )
  })

  it('formats and diagnoses files after edit', async () => {
    await fs.writeFile(path.join(directory, 'a.ts'), 'one two')
    formatFiles.mockResolvedValue('Formatted a.ts with prettier')
    diagnoseFiles.mockResolvedValue('LSP diagnostics:\na.ts:1:1 error: bad')

    const result = await execute(tools.edit, { path: 'a.ts', oldText: 'one', newText: 'three' })

    expect(result).toBe(
      'Replaced 1 occurrence(s) in a.ts\n\nFormatted a.ts with prettier\n\nLSP diagnostics:\na.ts:1:1 error: bad'
    )
    expect(diagnoseFiles).toHaveBeenCalledWith([path.join(directory, 'a.ts')])
  })

  it('formats and diagnoses added and updated patch files only', async () => {
    await fs.writeFile(path.join(directory, 'old.txt'), 'old')
    await fs.writeFile(path.join(directory, 'gone.txt'), 'gone')
    formatFiles.mockResolvedValue('Formatted files')
    diagnoseFiles.mockResolvedValue('LSP diagnostics: none')

    const result = await execute(tools.patch, {
      patchText: [
        '*** Begin Patch',
        '*** Add File: added.ts',
        '+const a = 1',
        '*** Update File: old.txt',
        '@@',
        '-old',
        '+new',
        '*** Delete File: gone.txt',
        '*** End Patch'
      ].join('\n')
    })

    expect(result).toContain('Formatted files')
    expect(result).toContain('LSP diagnostics: none')
    expect(formatFiles).toHaveBeenCalledWith([
      path.join(directory, 'added.ts'),
      path.join(directory, 'old.txt')
    ])
  })
})

describe('subagent tool', () => {
  it('delegates to the runtime callback', async () => {
    await expect(
      execute(tools.subagent, { prompt: 'Explore src', agent: 'explore' })
    ).resolves.toBe('child result')

    expect(runSubagent).toHaveBeenCalledWith({ prompt: 'Explore src', agent: 'explore' }, 'call-1')
  })

  it('reports unavailable subagents', async () => {
    const limited = createTools({ ...baseContext, runSubagent: undefined })

    await expect(execute(limited.subagent, { prompt: 'Explore src' })).resolves.toBe(
      'Error: subagents are not available.'
    )
  })
})

describe('web tools', () => {
  it('fetches pages after asking webfetch permission', async () => {
    await expect(execute(tools.webfetch, { url: 'https://example.com/page' })).resolves.toBe(
      'fetched page'
    )

    expect(askPermission).toHaveBeenCalledWith(
      'webfetch',
      'https://example.com/page',
      'webfetch',
      'call-1'
    )
    expect(fetchWeb).toHaveBeenCalledWith({
      url: 'https://example.com/page',
      format: 'markdown',
      timeoutMs: undefined
    })
  })

  it('honours webfetch denials', async () => {
    askPermission.mockResolvedValue(false)

    await expect(execute(tools.webfetch, { url: 'https://example.com' })).resolves.toBe(
      'Permission denied; the page was not fetched.'
    )
    expect(fetchWeb).not.toHaveBeenCalled()
  })

  it('searches the web after asking websearch permission', async () => {
    await expect(execute(tools.websearch, { query: 'ateam agents' })).resolves.toBe(
      'search results'
    )

    expect(askPermission).toHaveBeenCalledWith('websearch', 'ateam agents', 'websearch', 'call-1')
    expect(webSearch).toHaveBeenCalledWith({ query: 'ateam agents', count: 5 })
  })

  it('reports unavailable web tools', async () => {
    const limited = createTools({ ...baseContext, fetchWeb: undefined, webSearch: undefined })

    await expect(execute(limited.webfetch, { url: 'https://example.com' })).resolves.toBe(
      'Error: web fetching is not available.'
    )
    await expect(execute(limited.websearch, { query: 'x' })).resolves.toBe(
      'Error: web search is not available.'
    )
  })
})

describe('skill tool', () => {
  it('loads skills after asking permission', async () => {
    await expect(execute(tools.skill, { name: 'review' })).resolves.toBe('# Skill instructions')

    expect(askPermission).toHaveBeenCalledWith('skill', 'review', 'skill', 'call-1')
    expect(loadSkill).toHaveBeenCalledWith('review')
  })

  it('honours skill denials', async () => {
    askPermission.mockResolvedValue(false)

    await expect(execute(tools.skill, { name: 'review' })).resolves.toBe(
      'Permission denied; the skill was not loaded.'
    )
    expect(loadSkill).not.toHaveBeenCalled()
  })

  it('reports unavailable skills', async () => {
    const limited = createTools({ ...baseContext, loadSkill: undefined })

    await expect(execute(limited.skill, { name: 'review' })).resolves.toBe(
      'Error: skills are not available.'
    )
  })
})
