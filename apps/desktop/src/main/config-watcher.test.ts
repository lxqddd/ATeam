import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConfigFileChange } from '@ateam/shared'
import { ConfigWatcher } from './config-watcher'

let userData: string
let workspace: string
let watcher: ConfigWatcher | null = null
let changes: ConfigFileChange[] = []

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(check: () => boolean, timeoutMs = 8_000): Promise<void> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for a change')
    await delay(20)
  }
}

async function createWatcher(): Promise<ConfigWatcher> {
  watcher = new ConfigWatcher({
    userDataPath: userData,
    debounceMs: 150,
    onChange: (change) => changes.push(change)
  })
  // `fs.watch` needs a moment before the platform starts delivering events.
  await delay(200)
  return watcher
}

async function track(instance: ConfigWatcher, target: string): Promise<void> {
  await instance.trackWorkspace(target)
  await delay(200)
}

beforeEach(async () => {
  userData = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-watch-')))
  workspace = path.join(userData, 'project')
  await fs.mkdir(path.join(workspace, '.git'), { recursive: true })
  changes = []
})

afterEach(async () => {
  watcher?.dispose()
  watcher = null
  await fs.rm(userData, { recursive: true, force: true })
})

describe('ConfigWatcher', () => {
  it('reports external edits of the global config file', async () => {
    await createWatcher()
    const file = path.join(userData, 'agent', 'config.json')

    await fs.writeFile(file, '{"snapshots":false}')

    await waitFor(() => changes.length > 0)
    expect(changes[0]).toMatchObject({ global: true, files: [file] })
    expect(changes[0].workspaces).toEqual([])
  })

  it('reports external edits of a tracked project config', async () => {
    const instance = await createWatcher()
    await track(instance, workspace)
    const file = path.join(workspace, 'ateam.json')

    await fs.writeFile(file, '{"snapshots":true}')

    await waitFor(() => changes.length > 0)
    expect(changes[0]).toMatchObject({ global: false, workspaces: [workspace], files: [file] })
  })

  it('ignores the jsonc sibling that did not change', async () => {
    const instance = await createWatcher()
    await track(instance, workspace)

    await fs.writeFile(path.join(workspace, 'ateam.json'), '{}')

    await waitFor(() => changes.length > 0)
    await delay(500)
    expect(
      changes.every((change) => change.files.includes(path.join(workspace, 'ateam.json')))
    ).toBe(true)
  })

  it('does not report a write recorded with noteSelfWrite', async () => {
    const instance = await createWatcher()
    const file = path.join(userData, 'agent', 'config.json')

    await fs.writeFile(file, '{"snapshots":false}')
    instance.noteSelfWrite(file)

    await delay(700)
    expect(changes).toEqual([])
  })

  it('still reports a later external edit after a self write', async () => {
    const instance = await createWatcher()
    const file = path.join(userData, 'agent', 'config.json')

    await fs.writeFile(file, '{"snapshots":false}')
    instance.noteSelfWrite(file)
    await delay(500)
    changes = []

    await fs.writeFile(file, '{"snapshots":true}')

    await waitFor(() => changes.length > 0)
    expect(changes[0]).toMatchObject({ global: true })
  })

  it('watches one project root once even when tracked repeatedly', async () => {
    const instance = await createWatcher()
    await track(instance, workspace)
    await track(instance, path.join(workspace, 'nested'))
    await track(instance, workspace)

    await fs.writeFile(path.join(workspace, 'ateam.json'), '{}')

    await waitFor(() => changes.length > 0)
    await delay(500)
    expect(changes).toHaveLength(1)
  })

  it('stops reporting after dispose', async () => {
    const instance = await createWatcher()
    instance.dispose()

    await fs.writeFile(path.join(userData, 'agent', 'config.json'), '{}')

    await delay(500)
    expect(changes).toEqual([])
  })

  it('reports global permissions and mcp files as global changes', async () => {
    await createWatcher()
    const permissions = path.join(userData, 'agent', 'permissions.json')
    const mcp = path.join(userData, 'agent', 'mcp.json')

    await fs.writeFile(permissions, '{"version":1,"rules":[]}')
    await waitFor(() => changes.length > 0)
    expect(changes[0]).toMatchObject({ global: true, workspaces: [], files: [permissions] })

    changes = []
    await fs.writeFile(mcp, '{"servers":[]}')
    await waitFor(() => changes.length > 0)
    expect(changes[0]).toMatchObject({ global: true, workspaces: [], files: [mcp] })
  })

  it('ignores agent files outside the watched set', async () => {
    await createWatcher()

    await fs.writeFile(path.join(userData, 'agent', 'policy.json'), '{}')

    await delay(500)
    expect(changes).toEqual([])
  })

  it('debounces repeated writes of a global agent file', async () => {
    await createWatcher()
    const file = path.join(userData, 'agent', 'permissions.json')

    await fs.writeFile(file, '{"version":1,"rules":[]}')
    await fs.writeFile(file, '{"version":1,"rules":[{"id":"a"}]}')
    await fs.writeFile(file, '{"version":1,"rules":[]}')

    await waitFor(() => changes.length > 0)
    await delay(500)
    expect(changes).toHaveLength(1)
    expect(changes[0].files).toEqual([file])
  })

  it('suppresses self writes of the global permissions and mcp files', async () => {
    const instance = await createWatcher()

    for (const name of ['permissions.json', 'mcp.json']) {
      const file = path.join(userData, 'agent', name)
      await fs.writeFile(file, '{}')
      instance.noteSelfWrite(file)
      await delay(500)
    }

    expect(changes).toEqual([])
  })

  it('stops reporting global agent files after dispose', async () => {
    const instance = await createWatcher()
    instance.dispose()

    await fs.writeFile(path.join(userData, 'agent', 'permissions.json'), '{"version":1,"rules":[]}')
    await fs.writeFile(path.join(userData, 'agent', 'mcp.json'), '{"servers":[]}')

    await delay(500)
    expect(changes).toEqual([])
  })

  it('leases project roots per session and releases them when the session moves', async () => {
    const instance = await createWatcher()
    const other = path.join(userData, 'other')
    await fs.mkdir(path.join(other, '.git'), { recursive: true })

    await instance.setSessionWorkspace('s1', workspace)
    await delay(200)
    await fs.writeFile(path.join(workspace, 'ateam.json'), '{}')
    await waitFor(() => changes.length > 0)
    expect(changes[0]).toMatchObject({ global: false, workspaces: [workspace] })

    changes = []
    await instance.setSessionWorkspace('s1', other)
    await delay(200)
    await fs.writeFile(path.join(workspace, 'ateam.json'), '{"snapshots":true}')
    await delay(600)
    expect(changes).toEqual([])

    await fs.writeFile(path.join(other, 'ateam.json'), '{}')
    await waitFor(() => changes.length > 0)
    expect(changes[0]).toMatchObject({ global: false, workspaces: [other] })
  })

  it('keeps a shared root until the last session releases it', async () => {
    const instance = await createWatcher()
    await instance.setSessionWorkspace('s1', workspace)
    await instance.setSessionWorkspace('s2', workspace)
    await delay(200)

    await instance.setSessionWorkspace('s1', null)
    await delay(200)
    await fs.writeFile(path.join(workspace, 'ateam.json'), '{}')
    await waitFor(() => changes.length > 0)

    changes = []
    await instance.setSessionWorkspace('s2', null)
    await delay(200)
    await fs.writeFile(path.join(workspace, 'ateam.json'), '{"snapshots":true}')
    await delay(600)
    expect(changes).toEqual([])
  })

  it('keeps roots claimed by trackWorkspace after sessions release', async () => {
    const instance = await createWatcher()
    await track(instance, workspace)
    await instance.setSessionWorkspace('s1', workspace)
    await instance.setSessionWorkspace('s1', null)
    await delay(200)

    await fs.writeFile(path.join(workspace, 'ateam.json'), '{}')

    await waitFor(() => changes.length > 0)
  })
})
