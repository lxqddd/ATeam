import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ToolOutputStore } from './tool-output-store'

let directory: string
let store: ToolOutputStore

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-output-')))
  store = new ToolOutputStore(directory)
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('ToolOutputStore', () => {
  it('leaves small output unchanged', async () => {
    expect(await store.bound('s1', 'call-1', 'small', 10)).toEqual({ output: 'small' })
  })

  it('stores large output and returns a truncated model view', async () => {
    const output = 'x'.repeat(100)

    const result = await store.bound('s1', 'call-1', output, 20)

    expect(result.output).toContain('x'.repeat(20))
    expect(result.output).toContain('full output')
    expect(result.path).toBeTruthy()
    expect(await fs.readFile(result.path ?? '', 'utf8')).toBe(output)
  })

  it('sanitizes ids in the stored path', async () => {
    const result = await store.bound('../session', '../../call', 'y'.repeat(50), 10)

    expect(result.path).toContain(path.join('agent', 'tool-output'))
    expect(result.path).not.toContain('..')
  })
})
