import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AgentConfigStore,
  readAgentConfig,
  readGlobalConfigFile,
  writeGlobalConfigFile
} from './config-store'
import { applyGlobalConfigEdits } from './project-config-edit'

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
      subagentDepth: 1,
      instructions: [],
      lsp: true,
      lspInstall: false,
      formatters: true,
      formatterOverrides: {},
      retry: { maxRetries: 4, maxDelayMs: 60_000, timeoutMs: 0 },
      toolOutput: { maxLines: 2_000, maxBytes: 50 * 1024, mode: 'head' }
    })
    expect(await readAgentConfig(directory)).toEqual({
      snapshots: true,
      subagentDepth: 1,
      instructions: [],
      lsp: true,
      lspInstall: false,
      formatters: true,
      formatterOverrides: {},
      retry: { maxRetries: 4, maxDelayMs: 60_000, timeoutMs: 0 },
      toolOutput: { maxLines: 2_000, maxBytes: 50 * 1024, mode: 'head' }
    })
  })

  it('persists the subagent depth', async () => {
    const updated = await store.update({ subagentDepth: 3 })

    expect(updated.subagentDepth).toBe(3)
    const reloaded = new AgentConfigStore(directory)
    await reloaded.init()
    expect(reloaded.get().subagentDepth).toBe(3)
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
      subagentDepth: 1,
      lsp: false,
      lspInstall: false,
      formatters: false,
      instructions: ['AGENTS.md', 'https://example.com/rules.md'],
      formatterOverrides: {},
      retry: { maxRetries: 4, maxDelayMs: 60_000, timeoutMs: 0 },
      toolOutput: { maxLines: 2_000, maxBytes: 50 * 1024, mode: 'head' }
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

  it('normalizes tool output limits and per-tool overrides', async () => {
    const updated = await store.update({
      toolOutput: {
        maxLines: 500,
        maxBytes: 20_000,
        mode: 'tail',
        tools: { shell: { maxLines: 50 }, read: { mode: 'head' } }
      }
    })

    expect(updated.toolOutput).toEqual({
      maxLines: 500,
      maxBytes: 20_000,
      mode: 'tail',
      tools: { shell: { maxLines: 50 }, read: { mode: 'head' } }
    })
    const reloaded = new AgentConfigStore(directory)
    await reloaded.init()
    expect(reloaded.get().toolOutput).toEqual(updated.toolOutput)
  })

  it('drops invalid tool output limits', async () => {
    const file = path.join(directory, 'agent', 'config.json')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(
      file,
      JSON.stringify({
        toolOutput: {
          maxLines: 0,
          maxBytes: -1,
          mode: 'side',
          tools: { 'bad name': { maxLines: 5 }, shell: { maxLines: 'many' } }
        }
      })
    )

    expect((await readAgentConfig(directory)).toolOutput).toEqual({
      maxLines: 2_000,
      maxBytes: 50 * 1024,
      mode: 'head'
    })
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
      subagentDepth: 1,
      instructions: [],
      lsp: true,
      lspInstall: false,
      formatters: true,
      formatterOverrides: {},
      retry: { maxRetries: 4, maxDelayMs: 60_000, timeoutMs: 0 },
      toolOutput: { maxLines: 2_000, maxBytes: 50 * 1024, mode: 'head' }
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
      commands: { review: { template: 'Review', subtask: true } },
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
    expect.arrayContaining([
      expect.objectContaining({ name: 'review', template: 'Review', subtask: true })
    ])
  )
  expect(updated.skills).toEqual([path.join(directory, 'agent', 'skills')])
  expect(again.get()).toEqual(updated)
})

describe('reload', () => {
  it('re-reads the global document after an external edit', async () => {
    await store.update({ snapshots: false })
    const file = path.join(directory, 'agent', 'config.json')
    await fs.writeFile(file, JSON.stringify({ snapshots: true, instructions: ['EXT.md'] }))

    await store.reload()

    expect(store.get().snapshots).toBe(true)
    expect(store.get().instructions).toEqual(['EXT.md'])
  })

  it('keeps the current state when the file is temporarily invalid', async () => {
    await store.update({ snapshots: false })
    const file = path.join(directory, 'agent', 'config.json')
    await fs.writeFile(file, '{ invalid')

    await store.reload()

    expect(store.get().snapshots).toBe(false)
  })

  it('resets to defaults when the file is removed', async () => {
    await store.update({ snapshots: false })
    const file = path.join(directory, 'agent', 'config.json')
    await fs.rm(file)

    await store.reload()

    expect(store.get().snapshots).toBe(true)
  })

  it('serializes reload and update so a save is not lost', async () => {
    const file = path.join(directory, 'agent', 'config.json')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify({ snapshots: false }))

    await Promise.all([store.reload(), store.update({ subagentDepth: 2 })])

    expect(store.get().subagentDepth).toBe(2)
    const saved = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>
    expect(saved.subagentDepth).toBe(2)
    expect(saved.snapshots).toBe(false)
  })
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

describe('global config file snapshots', () => {
  const filePath = (): string => path.join(directory, 'agent', 'config.json')
  const BOM = String.fromCharCode(0xfeff)

  async function writeRaw(content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath()), { recursive: true })
    await fs.writeFile(filePath(), content)
  }

  async function readRaw(): Promise<string> {
    return fs.readFile(filePath(), 'utf8')
  }

  it('reports a missing file without raw data', async () => {
    const snapshot = await readGlobalConfigFile(directory)

    expect(snapshot).toEqual({
      path: filePath(),
      exists: false,
      content: '',
      diagnostics: [],
      document: {}
    })
  })

  it('keeps raw skills relative while anchoring the normalized document', async () => {
    await writeRaw(JSON.stringify({ skills: ['relative'], lsp: { ts: { command: ['ts-ls'] } } }))

    const snapshot = await readGlobalConfigFile(directory)

    expect(snapshot.exists).toBe(true)
    expect(snapshot.raw).toEqual({ skills: ['relative'], lsp: { ts: { command: ['ts-ls'] } } })
    expect(snapshot.document.skills).toEqual([path.join(directory, 'agent', 'relative')])
  })

  it('reports invalid JSON with a root error and no raw data', async () => {
    await writeRaw('{ not json')

    const snapshot = await readGlobalConfigFile(directory)

    expect(snapshot.raw).toBeUndefined()
    expect(snapshot.document).toEqual({})
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({ path: '$', severity: 'error' })
    ])
    expect(snapshot.content).toBe('{ not json')
  })

  it('reports a non-object root with a root error', async () => {
    await writeRaw('[1, 2]')

    const snapshot = await readGlobalConfigFile(directory)

    expect(snapshot.raw).toBeUndefined()
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({ path: '$', severity: 'error' })
    ])
  })

  it('accepts and preserves a leading BOM', async () => {
    await writeRaw(`${BOM}{"skills":["s"]}`)

    const snapshot = await readGlobalConfigFile(directory)

    expect(snapshot.raw).toEqual({ skills: ['s'] })
    expect(snapshot.content.startsWith(BOM)).toBe(true)
  })

  it('rejects invalid content when writing the whole file', async () => {
    await writeRaw('{"snapshots":true}')

    await expect(writeGlobalConfigFile(directory, '{ invalid')).rejects.toThrow(
      /INVALID_GLOBAL_CONFIG/
    )
    await expect(writeGlobalConfigFile(directory, '[]')).rejects.toThrow(/INVALID_GLOBAL_CONFIG/)
    expect(await readRaw()).toBe('{"snapshots":true}')
  })

  it('writes and re-reads a whole file', async () => {
    const snapshot = await writeGlobalConfigFile(directory, '{"snapshots":false}')

    expect(snapshot.raw).toEqual({ snapshots: false })
    expect(await readRaw()).toBe('{"snapshots":false}')
  })
})

describe('applyGlobalConfigEdits', () => {
  it('keeps unknown top-level fields and untouched siblings', () => {
    const content = JSON.stringify({
      'x-custom': { keep: true },
      lsp: { ts: { command: ['ts-ls'], env: { A: '1' } } }
    })

    const next = applyGlobalConfigEdits(content, [
      { path: ['lsp', 'ts', 'command'], value: ['ts-ls', '--stdio'] }
    ])

    expect(JSON.parse(next)).toEqual({
      'x-custom': { keep: true },
      lsp: { ts: { command: ['ts-ls', '--stdio'], env: { A: '1' } } }
    })
  })

  it('returns the original text when an edit changes nothing', () => {
    const content = '{"lsp":true}'
    expect(applyGlobalConfigEdits(content, [{ path: ['commands'] }])).toBe(content)
    expect(applyGlobalConfigEdits(content, [])).toBe(content)
  })

  it('rejects comments, trailing commas and non-object roots', () => {
    expect(() =>
      applyGlobalConfigEdits('{\n  "lsp": true // note\n}', [
        { path: ['lspEnabled'], value: false }
      ])
    ).toThrow(/INVALID_GLOBAL_CONFIG/)
    expect(() =>
      applyGlobalConfigEdits('{"lsp":true,}', [{ path: ['lspEnabled'], value: false }])
    ).toThrow(/INVALID_GLOBAL_CONFIG/)
    expect(() => applyGlobalConfigEdits('[]', [{ path: ['lspEnabled'], value: false }])).toThrow(
      /INVALID_GLOBAL_CONFIG/
    )
  })

  it('rejects edits that walk into a primitive parent', () => {
    expect(() =>
      applyGlobalConfigEdits('{"lsp":true}', [{ path: ['lsp', 'ts'], value: { command: ['x'] } }])
    ).toThrow(/INVALID_GLOBAL_CONFIG_EDIT/)
  })

  it('preserves a leading BOM', () => {
    const BOM = String.fromCharCode(0xfeff)
    const next = applyGlobalConfigEdits(`${BOM}{"lsp":true}`, [
      { path: ['lspEnabled'], value: false }
    ])

    expect(next.startsWith(BOM)).toBe(true)
    expect(JSON.parse(next.slice(BOM.length))).toEqual({ lsp: true, lspEnabled: false })
  })
})

describe('AgentConfigStore global edits', () => {
  const filePath = (): string => path.join(directory, 'agent', 'config.json')

  async function writeRaw(content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath()), { recursive: true })
    await fs.writeFile(filePath(), content)
  }

  async function readRaw(): Promise<Record<string, unknown>> {
    return JSON.parse(await fs.readFile(filePath(), 'utf8')) as Record<string, unknown>
  }

  it('creates the file on first edit and refreshes memory immediately', async () => {
    const snapshot = await store.edit([
      { path: ['commands'], value: { review: { template: 'Review' } } }
    ])

    expect(snapshot.exists).toBe(true)
    expect(store.get().commands).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'review', template: 'Review' })])
    )
    expect(await readRaw()).toEqual({ commands: { review: { template: 'Review' } } })
  })

  it('keeps unknown top-level fields across update, edit and update', async () => {
    await writeRaw(
      JSON.stringify({
        'x-custom': { keep: true },
        snapshots: true,
        lsp: { ts: { command: ['ts-ls'], custom: 'value' } }
      })
    )
    const reloaded = new AgentConfigStore(directory)
    await reloaded.init()

    await reloaded.update({ snapshots: false })
    await reloaded.edit([{ path: ['commands'], value: { review: { template: 'Review' } } }])
    await reloaded.update({ subagentDepth: 2 })

    expect(await readRaw()).toMatchObject({
      'x-custom': { keep: true },
      snapshots: false,
      subagentDepth: 2,
      commands: { review: { template: 'Review' } },
      // `update` re-normalizes known values, so nested unknown keys are dropped.
      lsp: { ts: { command: ['ts-ls'] } }
    })
  })

  it('does not anchor relative skills when writing back', async () => {
    await writeRaw(JSON.stringify({ skills: ['relative'], lsp: { ts: { command: ['ts-ls'] } } }))
    const reloaded = new AgentConfigStore(directory)
    await reloaded.init()

    expect(reloaded.get().skills).toEqual([path.join(directory, 'agent', 'relative')])

    await reloaded.update({ snapshots: false })
    expect((await readRaw()).skills).toEqual(['relative'])

    await reloaded.edit([{ path: ['lspEnabled'], value: false }])
    expect((await readRaw()).skills).toEqual(['relative'])
  })

  it('refuses to edit a file that is not valid JSON', async () => {
    await writeRaw('{ invalid')

    await expect(store.edit([{ path: ['skills'], value: ['a'] }])).rejects.toThrow(
      /INVALID_GLOBAL_CONFIG/
    )
    expect(await fs.readFile(filePath(), 'utf8')).toBe('{ invalid')
  })

  it('repairs an invalid file through writeContent and refreshes memory', async () => {
    await writeRaw('{ invalid')

    await store.writeContent(JSON.stringify({ snapshots: false }))

    expect(store.get().snapshots).toBe(false)
    expect(await readRaw()).toEqual({ snapshots: false })
  })

  it('rejects invalid writeContent without touching the file', async () => {
    await writeRaw('{"snapshots":true}')

    await expect(store.writeContent('{ invalid')).rejects.toThrow(/INVALID_GLOBAL_CONFIG/)
    expect(await fs.readFile(filePath(), 'utf8')).toBe('{"snapshots":true}')
  })
})
