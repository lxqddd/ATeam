import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PermissionsStore } from './permissions-store'

let directory: string
let store: PermissionsStore

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-permissions-')))
  store = new PermissionsStore(directory)
  await store.init()
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('PermissionsStore', () => {
  it('starts empty', () => {
    expect(store.list()).toEqual([])
  })

  it('persists rules across reloads', async () => {
    const created = await store.add({
      action: 'write',
      resource: 'src/*',
      effect: 'allow',
      sessionId: 's1'
    })

    const reloaded = new PermissionsStore(directory)
    await reloaded.init()

    expect(reloaded.list()).toEqual([created])
  })

  it('stores always rules for every permission action', async () => {
    for (const action of ['mcp', 'webfetch', 'websearch', 'skill', 'subagent'] as const) {
      await expect(
        store.add({ action, resource: 'demo/*', effect: 'allow', sessionId: 's1' })
      ).resolves.toMatchObject({ action, effect: 'allow' })
    }
  })

  it('deduplicates identical rules', async () => {
    const first = await store.add({
      action: 'shell',
      resource: 'bun test',
      effect: 'allow',
      sessionId: 's1'
    })
    const second = await store.add({
      action: 'shell',
      resource: 'bun test',
      effect: 'allow',
      sessionId: 's1'
    })

    expect(second.id).toBe(first.id)
    expect(store.list()).toHaveLength(1)
  })

  it('filters by session while keeping global rules', async () => {
    await store.add({ action: 'write', resource: '*', effect: 'deny', sessionId: null })
    await store.add({ action: 'write', resource: 'a/*', effect: 'allow', sessionId: 's1' })
    await store.add({ action: 'write', resource: 'b/*', effect: 'allow', sessionId: 's2' })

    expect(store.list('s1').map((rule) => rule.sessionId)).toEqual([null, 's1'])
    expect(store.list('s2').map((rule) => rule.sessionId)).toEqual([null, 's2'])
    expect(store.list()).toHaveLength(3)
  })

  it('removes rules by id and by session', async () => {
    const one = await store.add({
      action: 'write',
      resource: 'a/*',
      effect: 'allow',
      sessionId: 's1'
    })
    await store.add({ action: 'write', resource: 'b/*', effect: 'allow', sessionId: 's1' })
    await store.add({ action: 'write', resource: '*', effect: 'deny', sessionId: null })

    expect(await store.remove(one.id)).toBe(true)
    expect(await store.remove('missing')).toBe(false)
    expect(await store.removeForSession('s1')).toBe(1)

    const remaining = store.list()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].sessionId).toBeNull()
  })

  it('ignores invalid entries in the stored file', async () => {
    const file = path.join(directory, 'agent', 'permissions.json')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 1,
        rules: [
          {
            id: 'valid',
            action: 'write',
            resource: '*',
            effect: 'allow',
            sessionId: null,
            createdAt: '2026-01-01T00:00:00.000Z'
          },
          { id: 'bad-effect', action: 'write', resource: '*', effect: 'maybe' },
          { id: 'bad-action', action: 'network', resource: '*', effect: 'allow' }
        ]
      })
    )
    const reloaded = new PermissionsStore(directory)
    await reloaded.init()

    expect(reloaded.list().map((rule) => rule.id)).toEqual(['valid'])
  })

  it('re-reads external edits on reload', async () => {
    await store.add({ action: 'write', resource: 'a/*', effect: 'allow', sessionId: null })
    const file = path.join(directory, 'agent', 'permissions.json')
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 1,
        rules: [
          {
            id: 'external',
            action: 'shell',
            resource: 'bun test',
            effect: 'allow',
            sessionId: null,
            createdAt: '2026-01-01T00:00:00.000Z'
          }
        ]
      })
    )

    await expect(store.reload()).resolves.toBe(true)
    expect(store.list().map((rule) => rule.id)).toEqual(['external'])
  })

  it('clears rules on reload when the file is removed', async () => {
    await store.add({ action: 'write', resource: '*', effect: 'allow', sessionId: null })
    await fs.rm(path.join(directory, 'agent', 'permissions.json'))

    await expect(store.reload()).resolves.toBe(true)
    expect(store.list()).toEqual([])
  })

  it('keeps the current rules when the file is malformed', async () => {
    const rule = await store.add({
      action: 'write',
      resource: '*',
      effect: 'allow',
      sessionId: null
    })
    await fs.writeFile(path.join(directory, 'agent', 'permissions.json'), '{"version":1,')

    await expect(store.reload()).resolves.toBe(false)
    expect(store.list().map((entry) => entry.id)).toEqual([rule.id])
  })

  it('orders reloads after pending writes', async () => {
    const adding = store.add({
      action: 'read',
      resource: 'src/*',
      effect: 'allow',
      sessionId: null
    })
    const reloading = store.reload()

    const [rule] = await Promise.all([adding, reloading])
    expect(store.list().map((entry) => entry.id)).toEqual([rule.id])
  })
})
