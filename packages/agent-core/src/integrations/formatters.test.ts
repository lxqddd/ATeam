import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FORMATTERS,
  discoverFormatters,
  formatFile,
  selectFormatter,
  type FormatterDefinition,
  type FormatterSpawn,
  type FormatterSpawnChild
} from './formatters'

let workspace: string

beforeEach(async () => {
  workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-fmt-')))
})

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true })
})

const PRETTIER = FORMATTERS.find((formatter) => formatter.id === 'prettier') as FormatterDefinition
const GOFMT = FORMATTERS.find((formatter) => formatter.id === 'gofmt') as FormatterDefinition

interface FakeChild extends EventEmitter {
  stderr: PassThrough
  killed: boolean
  kill: () => boolean
}

function fakeChild(code: number | null, stderr = ''): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stderr = new PassThrough()
  child.killed = false
  child.kill = () => {
    child.killed = true
    child.emit('exit', null)
    return true
  }
  setImmediate(() => {
    if (stderr) child.stderr.write(stderr)
    setTimeout(() => child.emit('exit', code), 5)
  })
  return child
}

function hangingChild(): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stderr = new PassThrough()
  child.killed = false
  child.kill = () => {
    child.killed = true
    child.emit('exit', null)
    return true
  }
  return child
}

describe('discoverFormatters', () => {
  it('finds formatters from config files', async () => {
    await fs.writeFile(path.join(workspace, '.prettierrc'), '{}')
    await expect(discoverFormatters(workspace)).resolves.toEqual([PRETTIER])
  })

  it('finds prettier when it is a declared dependency', async () => {
    await fs.writeFile(
      path.join(workspace, 'package.json'),
      JSON.stringify({ devDependencies: { prettier: '^3.0.0' } })
    )
    await expect(discoverFormatters(workspace)).resolves.toEqual([PRETTIER])
  })

  it('finds biome and gofmt', async () => {
    await fs.writeFile(path.join(workspace, 'biome.json'), '{}')
    await fs.writeFile(path.join(workspace, 'go.mod'), 'module example.com/app')
    const found = await discoverFormatters(workspace)
    expect(found.map((formatter) => formatter.id)).toEqual(['biome', 'gofmt'])
  })

  it('finds ruff from pyproject configuration', async () => {
    await fs.writeFile(path.join(workspace, 'pyproject.toml'), '[tool.ruff]\nline-length = 100\n')
    const found = await discoverFormatters(workspace)
    expect(found.map((formatter) => formatter.id)).toEqual(['ruff'])
  })

  it('returns no formatters for a project without configuration', async () => {
    await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({ name: 'app' }))
    await expect(discoverFormatters(workspace)).resolves.toEqual([])
  })
})

describe('selectFormatter', () => {
  it('honours per-extension overrides', () => {
    const combined = [
      PRETTIER,
      { id: 'biome', extensions: ['.ts'], configFiles: [], command: () => ['biome'] }
    ]

    expect(selectFormatter(path.join(workspace, 'a.ts'), combined, { '.ts': 'biome' })?.id).toBe(
      'biome'
    )
    expect(
      selectFormatter(path.join(workspace, 'a.ts'), [PRETTIER], { '.ts': 'none' })
    ).toBeUndefined()
    expect(
      selectFormatter(path.join(workspace, 'a.ts'), [PRETTIER], { '.ts': 'gofmt' })
    ).toBeUndefined()
  })

  it('matches by extension', () => {
    expect(selectFormatter(path.join(workspace, 'src', 'a.ts'), [PRETTIER])?.id).toBe('prettier')
    expect(selectFormatter(path.join(workspace, 'main.go'), [PRETTIER, GOFMT])?.id).toBe('gofmt')
    expect(selectFormatter(path.join(workspace, 'main.rs'), [PRETTIER, GOFMT])).toBeUndefined()
  })
})

describe('formatFile', () => {
  it('runs the formatter with the resolved executable', async () => {
    const file = path.join(workspace, 'src', 'a.ts')
    const spawn = vi.fn<FormatterSpawn>(() => fakeChild(0) as unknown as FormatterSpawnChild)

    const result = await formatFile(file, [PRETTIER], workspace, {
      spawn,
      resolveExecutable: async () => path.join(workspace, 'node_modules', '.bin', 'prettier')
    })

    expect(result).toEqual({ formatted: true, formatter: 'prettier' })
    expect(spawn).toHaveBeenCalledWith(
      path.join(workspace, 'node_modules', '.bin', 'prettier'),
      ['--write', file],
      expect.objectContaining({ cwd: workspace })
    )
  })

  it('skips files without a matching formatter', async () => {
    const spawn = vi.fn<FormatterSpawn>()
    const result = await formatFile(path.join(workspace, 'notes.txt'), [PRETTIER], workspace, {
      spawn,
      resolveExecutable: async () => '/bin/prettier'
    })

    expect(result).toEqual({ formatted: false })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('skips when the formatter executable is unavailable', async () => {
    const spawn = vi.fn<FormatterSpawn>()
    const result = await formatFile(path.join(workspace, 'a.ts'), [PRETTIER], workspace, {
      spawn,
      resolveExecutable: async () => null
    })

    expect(result).toEqual({ formatted: false })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reports failures without throwing', async () => {
    const spawn = vi.fn<FormatterSpawn>(
      () => fakeChild(1, 'parse error') as unknown as FormatterSpawnChild
    )
    const result = await formatFile(path.join(workspace, 'a.ts'), [PRETTIER], workspace, {
      spawn,
      resolveExecutable: async () => '/bin/prettier'
    })

    expect(result).toEqual({ formatted: false, formatter: 'prettier', error: 'parse error' })
  })

  it('reports spawn errors without throwing', async () => {
    const child = hangingChild()
    const spawn = vi.fn<FormatterSpawn>(() => {
      setImmediate(() => child.emit('error', new Error('spawn ENOENT')))
      return child as unknown as FormatterSpawnChild
    })
    const result = await formatFile(path.join(workspace, 'a.ts'), [PRETTIER], workspace, {
      spawn,
      resolveExecutable: async () => '/bin/prettier'
    })

    expect(result).toEqual({ formatted: false, formatter: 'prettier', error: 'spawn ENOENT' })
  })

  it('kills a formatter that exceeds the timeout', async () => {
    const child = hangingChild()
    const spawn = vi.fn<FormatterSpawn>(() => child as unknown as FormatterSpawnChild)
    const result = await formatFile(path.join(workspace, 'a.ts'), [PRETTIER], workspace, {
      spawn,
      resolveExecutable: async () => '/bin/prettier',
      timeoutMs: 20
    })

    expect(result).toEqual({
      formatted: false,
      formatter: 'prettier',
      error: 'Formatter timed out'
    })
    expect(child.killed).toBe(true)
  })
})
