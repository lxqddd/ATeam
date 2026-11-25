import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ToolOutputLimitsResolved } from '@ateam/shared'
import { DEFAULT_TOOL_OUTPUT_LIMITS } from '@ateam/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ToolOutputStore, toolOutputLimitsFor } from './tool-output-store'

let directory: string
let store: ToolOutputStore

function limits(patch: Partial<ToolOutputLimitsResolved> = {}): ToolOutputLimitsResolved {
  return { ...DEFAULT_TOOL_OUTPUT_LIMITS, ...patch }
}

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-output-')))
  store = new ToolOutputStore(directory)
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('ToolOutputStore', () => {
  it('leaves output within both limits unchanged', async () => {
    expect(await store.bound('s1', 'call-1', 'small', limits({ maxBytes: 10 }))).toEqual({
      output: 'small'
    })
    expect(
      await store.bound('s1', 'call-2', 'a\nbb', limits({ maxLines: 2, maxBytes: 4 }))
    ).toEqual({ output: 'a\nbb' })
  })

  it('keeps the head by lines and saves the full output', async () => {
    const output = ['line-1', 'line-2', 'line-3', 'line-4'].join('\n')

    const result = await store.bound(
      's1',
      'call-1',
      output,
      limits({ maxLines: 2, maxBytes: 1_000 })
    )

    expect(result.output).toContain('line-1')
    expect(result.output).toContain('line-2')
    expect(result.output).not.toContain('line-3')
    expect(result.output).toContain('showing first 2 of 4 lines')
    expect(result.output).toContain('Use the read tool')
    expect(result.output).toContain(result.path ?? '')
    expect(await fs.readFile(result.path ?? '', 'utf8')).toBe(output)
  })

  it('keeps the tail by lines when configured', async () => {
    const output = ['line-1', 'line-2', 'line-3', 'line-4'].join('\n')

    const result = await store.bound(
      's1',
      'call-1',
      output,
      limits({ maxLines: 2, maxBytes: 1_000, mode: 'tail' })
    )

    expect(result.output).not.toContain('line-1')
    expect(result.output).not.toContain('line-2')
    expect(result.output).toContain('line-3')
    expect(result.output).toContain('line-4')
    expect(result.output).toContain('showing last 2 of 4 lines')
    expect(await fs.readFile(result.path ?? '', 'utf8')).toBe(output)
  })

  it('cuts the head at a UTF-8 boundary', async () => {
    const output = '😀'.repeat(10)

    const result = await store.bound(
      's1',
      'call-1',
      output,
      limits({ maxLines: 100, maxBytes: 10 })
    )
    const body = result.output.split('\n[output truncated')[0]

    expect(body).toBe('😀😀')
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(10)
    expect(result.output).not.toContain('�')
    expect(result.output).toContain('10 B limit reached')
  })

  it('cuts the tail at a UTF-8 boundary', async () => {
    const output = '😀'.repeat(10)

    const result = await store.bound(
      's1',
      'call-1',
      output,
      limits({ maxLines: 100, maxBytes: 10, mode: 'tail' })
    )
    const body = result.output.split('\n[output truncated')[0]

    expect(body).toBe('😀😀')
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(10)
    expect(result.output).not.toContain('�')
  })

  it('sanitizes ids in the stored path', async () => {
    const result = await store.bound(
      '../session',
      '../../call',
      'y'.repeat(50),
      limits({ maxBytes: 10 })
    )

    expect(result.path).toContain(path.join('agent', 'tool-output'))
    expect(result.path).not.toContain('..')
  })

  it('removes expired outputs and their empty session directory', async () => {
    const old = await store.bound('old-session', 'old', 'x'.repeat(100), limits({ maxBytes: 10 }))
    const keep = await store.bound(
      'keep-session',
      'keep',
      'y'.repeat(100),
      limits({ maxBytes: 10 })
    )
    const expired = new Date(Date.now() - 10_000)
    await fs.utimes(old.path ?? '', expired, expired)

    expect(await store.cleanup({ maxAgeMs: 5_000 })).toBe(1)
    await expect(fs.stat(old.path ?? '')).rejects.toThrow()
    await expect(fs.stat(keep.path ?? '')).resolves.toBeTruthy()
    await expect(fs.stat(path.dirname(old.path ?? ''))).rejects.toThrow()
  })

  it('leaves fresh files and unrelated extensions alone', async () => {
    const session = path.join(directory, 'agent', 'tool-output', 's1')
    await fs.mkdir(session, { recursive: true })
    const oldOutput = path.join(session, 'old.txt')
    const oldNote = path.join(session, 'notes.md')
    const fresh = path.join(session, 'fresh.txt')
    await fs.writeFile(oldOutput, 'old')
    await fs.writeFile(oldNote, 'note')
    await fs.writeFile(fresh, 'fresh')
    const expired = new Date(Date.now() - 10_000)
    await fs.utimes(oldOutput, expired, expired)
    await fs.utimes(oldNote, expired, expired)

    expect(await store.cleanup({ maxAgeMs: 5_000 })).toBe(1)
    await expect(fs.stat(oldOutput)).rejects.toThrow()
    await expect(fs.stat(oldNote)).resolves.toBeTruthy()
    await expect(fs.stat(fresh)).resolves.toBeTruthy()
  })
})

describe('toolOutputLimitsFor', () => {
  const config = {
    maxLines: 100,
    maxBytes: 1_000,
    mode: 'tail' as const,
    tools: { shell: { maxLines: 10, mode: 'head' as const } }
  }

  it('applies per-tool overrides over the global limits', () => {
    expect(toolOutputLimitsFor(config, 'shell')).toEqual({
      maxLines: 10,
      maxBytes: 1_000,
      mode: 'head'
    })
  })

  it('falls back to the global limits for other tools', () => {
    expect(toolOutputLimitsFor(config, 'read')).toEqual({
      maxLines: 100,
      maxBytes: 1_000,
      mode: 'tail'
    })
  })

  it('uses defaults when no configuration exists', () => {
    expect(toolOutputLimitsFor(undefined, 'read')).toEqual(DEFAULT_TOOL_OUTPUT_LIMITS)
  })
})
