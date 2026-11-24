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
      formatterOverrides: {},
      retry: { maxRetries: 4, maxDelayMs: 60_000, timeoutMs: 0 }
    })
    expect(await readAgentConfig(directory)).toEqual({
      snapshots: true,
      instructions: [],
      lsp: true,
      formatters: true,
      formatterOverrides: {},
      retry: { maxRetries: 4, maxDelayMs: 60_000, timeoutMs: 0 }
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
      formatterOverrides: {},
      retry: { maxRetries: 4, maxDelayMs: 60_000, timeoutMs: 0 }
    })
    const reloaded = new AgentConfigStore(directory)
    await reloaded.init()
    expect(reloaded.get()).toEqual(updated)
  })

  it('normalizes references', async () => {
    const updated = await store.update({
      references: [
        { alias: 'docs', path: '../docs', description: ' Product docs ' },
        { alias: 'sdk', repository: 'owner/repo', branch: 'main' },
        { alias: 'both', path: 'a', repository: 'b' },
        { alias: 'bad alias', path: 'a' }
      ]
    })

    expect(updated.references).toEqual([
      { alias: 'docs', path: '../docs', description: 'Product docs' },
      { alias: 'sdk', repository: 'owner/repo', branch: 'main' }
    ])
  })

  it('reads the object reference form', async () => {
    const file = path.join(directory, 'agent', 'config.json')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify({ references: { docs: '../docs', sdk: 'owner/repo' } }))

    expect(await readAgentConfig(directory)).toMatchObject({
      references: [
        { alias: 'docs', path: '../docs' },
        { alias: 'sdk', repository: 'owner/repo' }
      ]
    })
  })

  it('normalizes formatter overrides', async () => {
    const updated = await store.update({
      formatterOverrides: { ts: 'prettier', '.PY': 'none', '.md': 'bad value!' }
    })

    expect(updated.formatterOverrides).toEqual({ '.ts': 'prettier', '.py': 'none' })
  })

  it('normalizes retry settings', async () => {
    const updated = await store.update({
      retry: { maxRetries: 2, maxDelayMs: 5_000, timeoutMs: 120_000 }
    })

    expect(updated.retry).toEqual({ maxRetries: 2, maxDelayMs: 5_000, timeoutMs: 120_000 })
    const reloaded = new AgentConfigStore(directory)
    await reloaded.init()
    expect(reloaded.get().retry).toEqual({ maxRetries: 2, maxDelayMs: 5_000, timeoutMs: 120_000 })
  })

  it('clamps invalid retry settings back to the previous values', async () => {
    const file = path.join(directory, 'agent', 'config.json')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(
      file,
      JSON.stringify({ retry: { maxRetries: 99, maxDelayMs: -1, timeoutMs: 1.5 } })
    )

    expect((await readAgentConfig(directory)).retry).toEqual({
      maxRetries: 4,
      maxDelayMs: 60_000,
      timeoutMs: 0
    })
  })

  it('normalizes environment settings', async () => {
    const updated = await store.update({
      environment: { timezone: 'Asia/Shanghai', notes: ' Use bun for scripts. ' }
    })

    expect(updated.environment).toEqual({
      timezone: 'Asia/Shanghai',
      notes: 'Use bun for scripts.'
    })
    const reloaded = new AgentConfigStore(directory)
    await reloaded.init()
    expect(reloaded.get().environment).toEqual(updated.environment)
  })

  it('normalizes a system prompt override', async () => {
    const updated = await store.update({ systemPrompt: '  You are a reviewer.  ' })

    expect(updated.systemPrompt).toBe('You are a reviewer.')
    const reloaded = new AgentConfigStore(directory)
    await reloaded.init()
    expect(reloaded.get().systemPrompt).toBe('You are a reviewer.')

    const cleared = await store.update({ systemPrompt: undefined })
    expect(cleared.systemPrompt).toBeUndefined()
  })

  it('drops an invalid environment timezone', async () => {
    const file = path.join(directory, 'agent', 'config.json')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(
      file,
      JSON.stringify({ environment: { timezone: 'Not/AZone', notes: 'keep me' } })
    )

    expect((await readAgentConfig(directory)).environment).toEqual({ notes: 'keep me' })
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
      formatterOverrides: {},
      retry: { maxRetries: 4, maxDelayMs: 60_000, timeoutMs: 0 }
    })
  })
})

it('preserves layered document fields when updating global switches', async () => {
  const file = path.join(directory, 'agent', 'config.json')
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(
    file,
    JSON.stringify({
      lsp: { custom: { command: ['custom-lsp'], extensions: ['.ts'] } },
      providers: { 'provider-1': { type: 'openai', models: { 'model-1': {} } } },
      commands: { review: { template: 'Review' } },
      skills: ['skills']
    })
  )
  const reloaded = new AgentConfigStore(directory)
  await reloaded.init()
  const updated = await reloaded.update({ snapshots: false })
  const again = new AgentConfigStore(directory)
  await again.init()

  expect(updated.snapshots).toBe(false)
  expect(updated.lspServers).toMatchObject({ custom: { command: ['custom-lsp'] } })
  expect(updated.providers).toMatchObject({ 'provider-1': { type: 'openai' } })
  expect(updated.commands).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'review', template: 'Review' })])
  )
  expect(updated.skills).toEqual([path.join(directory, 'agent', 'skills')])
  expect(again.get()).toEqual(updated)
})

describe('additional patch fields', () => {
  it('persists additional config fields from a core patch', async () => {
    const updated = await store.update({
      permissionRules: [{ action: 'shell', resource: 'git *', effect: 'allow', sessionId: null }],
      mcpServers: [{ name: 'patch-mcp', type: 'local', command: 'node' }],
      agents: [{ name: 'patch-agent' }],
      lspServers: { custom: { command: ['custom-lsp'], extensions: ['.x'] } },
      formatterServers: { custom: { command: ['fmt', '$FILE'], extensions: ['.x'] } }
    })

    expect(updated.permissionRules).toEqual([
      { action: 'shell', resource: 'git *', effect: 'allow', sessionId: null }
    ])
    expect(updated.mcpServers?.[0]).toMatchObject({ name: 'patch-mcp' })
    expect(updated.agents).toEqual([{ name: 'patch-agent' }])
    expect(updated.lspServers?.custom).toMatchObject({ command: ['custom-lsp'] })
    expect(updated.formatterServers?.custom).toMatchObject({ command: ['fmt', '$FILE'] })
    const reloaded = new AgentConfigStore(directory)
    await reloaded.init()
    expect(reloaded.get()).toEqual(updated)
  })
})
