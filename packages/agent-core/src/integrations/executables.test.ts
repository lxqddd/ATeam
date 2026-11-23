import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveExecutable } from './executables'

let directory: string

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-exe-')))
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

async function writeExecutable(file: string): Promise<string> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  return file
}

describe('resolveExecutable', () => {
  it('prefers the project node_modules/.bin directory', async () => {
    const local = await writeExecutable(
      path.join(directory, 'node_modules', '.bin', 'fake-formatter')
    )
    const bin = await writeExecutable(path.join(directory, 'bin', 'fake-formatter'))

    await expect(
      resolveExecutable('fake-formatter', directory, { PATH: path.dirname(bin) }, 'darwin')
    ).resolves.toBe(local)
  })

  it('falls back to PATH entries', async () => {
    const bin = await writeExecutable(path.join(directory, 'bin', 'fake-formatter'))
    const empty = path.join(directory, 'empty')
    await fs.mkdir(empty)

    await expect(
      resolveExecutable(
        'fake-formatter',
        directory,
        {
          PATH: [empty, path.dirname(bin)].join(path.delimiter)
        },
        'darwin'
      )
    ).resolves.toBe(bin)
  })

  it('resolves explicit relative paths', async () => {
    const local = await writeExecutable(path.join(directory, 'tools', 'run.sh'))
    await expect(resolveExecutable('./tools/run.sh', directory, {}, 'darwin')).resolves.toBe(local)
  })

  it('returns null when the binary is missing', async () => {
    await expect(
      resolveExecutable('missing-tool', directory, { PATH: directory }, 'darwin')
    ).resolves.toBeNull()
  })
})
