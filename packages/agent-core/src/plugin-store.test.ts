import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isPluginCompatible, PluginStore } from './plugin-store'

let directory: string
let userData: string
let workspace: string

async function writePlugin(name: string, engines?: string): Promise<string> {
  const root = path.join(workspace, 'plugins', name)
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: `@acme/${name}`,
      version: '1.2.3',
      ...(engines ? { engines: { ateam: engines } } : {})
    })
  )
  await fs.writeFile(path.join(root, 'index.mjs'), 'export default () => ({})')
  return path.relative(workspace, root)
}

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-plugin-store-')))
  userData = path.join(directory, 'user-data')
  workspace = path.join(directory, 'workspace')
  await fs.mkdir(userData, { recursive: true })
  await fs.mkdir(workspace, { recursive: true })
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('isPluginCompatible', () => {
  it('supports caret, tilde, comparison and exact versions', () => {
    expect(isPluginCompatible('^0.1.0', '0.1.5')).toBe(true)
    expect(isPluginCompatible('^0.1.0', '0.2.0')).toBe(false)
    expect(isPluginCompatible('^1.2.0', '1.9.0')).toBe(true)
    expect(isPluginCompatible('^1.2.0', '2.0.0')).toBe(false)
    expect(isPluginCompatible('~1.2.0', '1.2.9')).toBe(true)
    expect(isPluginCompatible('>=1.0.0', '1.0.0')).toBe(true)
    expect(isPluginCompatible('1.2.3', '1.2.3')).toBe(true)
    expect(isPluginCompatible('*', '9.9.9')).toBe(true)
  })
})

describe('PluginStore', () => {
  it('installs a local plugin and persists metadata', async () => {
    const relative = await writePlugin('alpha', '^0.1.0')
    const store = new PluginStore(userData)

    const entries = await store.install(
      { spec: relative, directory: workspace },
      workspace,
      '0.1.1'
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      name: '@acme/alpha',
      version: '1.2.3',
      source: 'local',
      enabled: true,
      compatibility: 'compatible'
    })
    const raw = JSON.parse(
      await fs.readFile(path.join(userData, 'agent', 'plugins.json'), 'utf8')
    ) as { plugins: unknown[] }
    expect(raw.plugins).toHaveLength(1)
    expect(await store.enabledSpecs()).toHaveLength(1)
  })

  it('rejects incompatible and missing local plugins', async () => {
    const relative = await writePlugin('beta', '>=2.0.0')
    const store = new PluginStore(userData)

    await expect(
      store.install({ spec: relative, directory: workspace }, workspace, '0.1.1')
    ).rejects.toThrow('PLUGIN_INCOMPATIBLE')
    await expect(
      store.install({ spec: './missing', directory: workspace }, workspace, '0.1.1')
    ).rejects.toThrow('PLUGIN_SPEC_NOT_FOUND')
  })

  it('accepts npm specs without local files', async () => {
    const store = new PluginStore(userData)
    const entries = await store.install(
      { spec: '@acme/tools@2.1.0', directory: workspace },
      workspace,
      '0.1.1'
    )

    expect(entries[0]).toMatchObject({
      name: '@acme/tools',
      version: '2.1.0',
      source: 'npm',
      compatibility: 'unknown'
    })
  })

  it('toggles, removes and reloads entries', async () => {
    const relative = await writePlugin('gamma', '^0.1.0')
    const store = new PluginStore(userData)
    const [entry] = await store.install(
      { spec: relative, directory: workspace },
      workspace,
      '0.1.1'
    )
    expect(entry).toBeDefined()

    const disabled = await store.update(entry.id, { enabled: false })
    expect(disabled[0].enabled).toBe(false)
    expect(await store.enabledSpecs()).toEqual([])

    const reloaded = new PluginStore(userData)
    expect(await reloaded.list()).toHaveLength(1)
    expect((await reloaded.list())[0].enabled).toBe(false)

    await reloaded.remove(entry.id)
    expect(await reloaded.list()).toEqual([])
  })
})
