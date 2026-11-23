import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readJsonFile, writeJsonAtomic } from './atomic-json'

let directory: string

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-test-')))
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('atomic-json', () => {
  it('writes and reads a value round-trip', async () => {
    const file = path.join(directory, 'data.json')
    const value = { name: '会话', nested: { count: 2, tags: ['a', 'b'] } }

    await writeJsonAtomic(file, value)
    await expect(readJsonFile(file)).resolves.toEqual(value)
  })

  it('creates parent directories', async () => {
    const file = path.join(directory, 'deep', 'nested', 'data.json')
    await writeJsonAtomic(file, { ok: true })
    await expect(readJsonFile(file)).resolves.toEqual({ ok: true })
  })

  it('overwrites existing files', async () => {
    const file = path.join(directory, 'data.json')
    await writeJsonAtomic(file, { version: 1 })
    await writeJsonAtomic(file, { version: 2 })
    await expect(readJsonFile(file)).resolves.toEqual({ version: 2 })
  })

  it('returns null for invalid JSON', async () => {
    const file = path.join(directory, 'broken.json')
    await fs.writeFile(file, '{not json')
    await expect(readJsonFile(file)).resolves.toBeNull()
  })

  it('returns null for a missing file', async () => {
    await expect(readJsonFile(path.join(directory, 'missing.json'))).resolves.toBeNull()
  })

  it('writes files with owner-only permissions on POSIX', async () => {
    if (process.platform === 'win32') return
    const file = path.join(directory, 'secret.json')
    await writeJsonAtomic(file, { ok: true })
    const stat = await fs.stat(file)
    expect(stat.mode & 0o777).toBe(0o600)
  })
})
