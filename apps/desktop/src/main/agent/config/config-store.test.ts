import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentConfigStore, readAgentConfig } from './config-store'

let directory: string
let store: AgentConfigStore

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-config-')))
  store = new AgentConfigStore(directory)
  await store.init()
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('AgentConfigStore', () => {
  it('uses defaults when no config file exists', async () => {
    expect(store.get()).toEqual({
      snapshots: true,
      instructions: [],
      lsp: true,
      formatters: true,
      formatterOverrides: {}
    })
    expect(await readAgentConfig(directory)).toEqual({
      snapshots: true,
      instructions: [],
      lsp: true,
      formatters: true,
      formatterOverrides: {}
    })
  })

  it('persists snapshots, lsp and formatter switches with normalized instructions', async () => {
    const updated = await store.update({
      snapshots: false,
      lsp: false,
      formatters: false,
      instructions: [' AGENTS.md ', '', 'AGENTS.md', 'https://example.com/rules.md']
    })

    expect(updated).toEqual({
      snapshots: false,
      lsp: false,
      formatters: false,
      instructions: ['AGENTS.md', 'https://example.com/rules.md'],
      formatterOverrides: {}
    })
    const reloaded = new AgentConfigStore(directory)
    await reloaded.init()
    expect(reloaded.get()).toEqual(updated)
  })

  it('normalizes formatter overrides', async () => {
    const updated = await store.update({
      formatterOverrides: { ts: 'prettier', '.PY': 'none', '.md': 'bad value!' }
    })

    expect(updated.formatterOverrides).toEqual({ '.ts': 'prettier', '.py': 'none' })
  })

  it('ignores invalid config files', async () => {
    const file = path.join(directory, 'agent', 'config.json')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify({ snapshots: 'no', instructions: 'bad', lsp: 1 }))

    expect(await readAgentConfig(directory)).toEqual({
      snapshots: true,
      instructions: [],
      lsp: true,
      formatters: true,
      formatterOverrides: {}
    })
  })
})
