import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readAgentConfig } from './config-store'
import {
  parseProjectConfigContent,
  readProjectConfigFile,
  writeProjectConfigFile,
  parseProjectConfigDocument,
  readProjectConfig
} from './project-config'

let directory: string
let userData: string
let workspace: string

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-project-config-')))
  userData = path.join(directory, 'user-data')
  workspace = path.join(directory, 'repo', 'packages', 'app')
  await fs.mkdir(path.join(directory, 'repo', '.git'), { recursive: true })
  await fs.mkdir(workspace, { recursive: true })
  await fs.mkdir(path.join(userData, 'agent'), { recursive: true })
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('project config', () => {
  it('parses JSONC with comments and trailing commas', () => {
    const config = parseProjectConfigContent(`{
      // project settings
      "snapshots": false,
      "instructions": ["docs/rules.md", "docs/rules.md"],
      "permissions": [
        { "action": "shell", "resource": "git push *", "effect": "deny" }
      ],
      "mcp": [
        { "name": "docs", "type": "local", "command": "node", "args": ["server.js"] }
      ],
    }`)

    expect(config.snapshots).toBe(false)
    expect(config.instructions).toEqual(['docs/rules.md'])
    expect(config.permissions).toEqual([
      { action: 'shell', resource: 'git push *', effect: 'deny', sessionId: null }
    ])
    expect(config.mcp?.[0]).toMatchObject({ name: 'docs', type: 'local', command: 'node' })
  })

  it('discovers the config at the git root from a nested workspace', async () => {
    await fs.writeFile(
      path.join(directory, 'repo', 'ateam.json'),
      JSON.stringify({ formatters: false })
    )

    expect(await readProjectConfig(workspace)).toMatchObject({ formatters: false })
  })

  it('merges project settings over global settings', async () => {
    await fs.writeFile(
      path.join(userData, 'agent', 'config.json'),
      JSON.stringify({
        snapshots: true,
        instructions: ['global.md'],
        lsp: true,
        formatters: true,
        formatterOverrides: { '.ts': 'prettier' },
        references: [{ alias: 'docs', path: '/global/docs' }]
      })
    )
    await fs.writeFile(
      path.join(directory, 'repo', 'ateam.json'),
      JSON.stringify({
        snapshots: false,
        lsp: false,
        formatters: false,
        instructions: ['project.md'],
        formatterOverrides: { '.py': 'ruff' },
        references: [{ alias: 'docs', path: '/project/docs' }],
        permissions: [{ action: 'shell', resource: 'git push *', effect: 'deny' }],
        mcp: [{ name: 'project-docs', type: 'local', command: 'node' }],
        agents: [{ name: 'project-helper', description: 'Helper', mode: 'subagent' }]
      })
    )

    const config = await readAgentConfig(userData, workspace)

    expect(config.snapshots).toBe(false)
    expect(config.lsp).toBe(false)
    expect(config.formatters).toBe(false)
    expect(config.instructions).toEqual(['global.md', path.join(directory, 'repo', 'project.md')])
    expect(config.formatterOverrides).toEqual({ '.ts': 'prettier', '.py': 'ruff' })
    expect(config.references).toEqual([{ alias: 'docs', path: '/project/docs' }])
    expect(config.permissionRules).toEqual([
      { action: 'shell', resource: 'git push *', effect: 'deny', sessionId: null }
    ])
    expect(config.mcpServers?.[0]).toMatchObject({ name: 'project-docs' })
    expect(config.agents).toHaveLength(1)
  })

  it('ignores invalid project config without failing global settings', async () => {
    await fs.writeFile(path.join(directory, 'repo', 'ateam.json'), '{ not json')
    await fs.writeFile(
      path.join(userData, 'agent', 'config.json'),
      JSON.stringify({ instructions: ['global.md'] })
    )

    const config = await readAgentConfig(userData, workspace)

    expect(config.instructions).toEqual(['global.md'])
    expect(config.snapshots).toBe(true)
  })
})

describe('layered document fields', () => {
  it('parses providers, custom LSP/formatters, commands and skills', () => {
    const document = parseProjectConfigContent(`{
      "lsp": {
        "deno": { "command": ["deno", "lsp"], "extensions": [".ts"] },
        "clangd": { "disabled": true }
      },
      "formatters": {
        "custom": { "command": ["myfmt", "$FILE"], "extensions": [".foo"] }
      },
      "providers": {
        "provider-1": {
          "baseURL": "https://example.com/v1",
          "models": { "model-1": { "name": "Project Model", "reasoning": true } }
        }
      },
      "commands": {
        "review": { "template": "Review $ARGUMENTS", "description": "Review it" }
      },
      "skills": ["project-skills"]
    }`)

    expect(document.lsp).toMatchObject({
      deno: { command: ['deno', 'lsp'], extensions: ['.ts'] },
      clangd: { disabled: true }
    })
    expect(document.formatters).toMatchObject({
      custom: { command: ['myfmt', '$FILE'], extensions: ['.foo'] }
    })
    expect(document.providers).toMatchObject({
      'provider-1': {
        baseURL: 'https://example.com/v1',
        models: { 'model-1': { name: 'Project Model', reasoning: true } }
      }
    })
    expect(document.commands).toMatchObject({
      review: { template: 'Review $ARGUMENTS', description: 'Review it' }
    })
    expect(document.skills).toEqual(['project-skills'])
  })

  it('reports invalid fields and never retains literal credentials', () => {
    const parsed = parseProjectConfigDocument(
      JSON.stringify({
        lsp: { broken: 'bad' },
        providers: { 'provider-1': { apiKey: 'super-secret' } },
        skills: ['https://example.com/skill']
      }),
      '/repo/ateam.json'
    )

    expect((parsed.document.providers as Record<string, unknown>)['provider-1']).toEqual({})
    expect(JSON.stringify(parsed)).not.toContain('super-secret')
    expect(parsed.diagnostics.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(['$.lsp.broken', '$.providers.provider-1.apiKey', '$.skills'])
    )
  })

  it('anchors project-relative paths to the config directory', async () => {
    await fs.mkdir(path.join(directory, 'repo', 'docs'), { recursive: true })
    await fs.mkdir(path.join(directory, 'repo', 'project-skills'), { recursive: true })
    await fs.writeFile(
      path.join(directory, 'repo', 'ateam.json'),
      JSON.stringify({
        instructions: ['docs/rules.md'],
        references: [{ alias: 'docs', path: 'docs' }],
        plugins: ['./plugin.ts'],
        skills: ['project-skills']
      })
    )

    const config = await readAgentConfig(userData, workspace)
    const root = path.join(directory, 'repo')

    expect(config.instructions).toEqual([path.join(root, 'docs', 'rules.md')])
    expect(config.references).toEqual([{ alias: 'docs', path: path.join(root, 'docs') }])
    expect(config.plugins).toEqual([path.join(root, 'plugin.ts')])
    expect(config.skills).toEqual([path.join(root, 'project-skills')])
  })
})
describe('partial server overrides', () => {
  it('deep-merges project LSP entries over global entries', async () => {
    await fs.writeFile(
      path.join(userData, 'agent', 'config.json'),
      JSON.stringify({
        lsp: { typescript: { command: ['custom-ts'], extensions: ['.ts'] } }
      })
    )
    await fs.writeFile(
      path.join(directory, 'repo', 'ateam.json'),
      JSON.stringify({ lsp: { typescript: { extensions: ['.tsx'] } } })
    )

    const config = await readAgentConfig(userData, workspace)
    expect(config.lspServers?.typescript).toEqual({
      command: ['custom-ts'],
      extensions: ['.tsx']
    })
  })
})

describe('provider model merging', () => {
  it('preserves global model fields in a partial project override', async () => {
    await fs.writeFile(
      path.join(userData, 'agent', 'config.json'),
      JSON.stringify({
        providers: {
          'provider-1': {
            type: 'openai',
            models: { 'model-1': { contextWindow: 200000, costInput: 3 } }
          }
        }
      })
    )
    await fs.writeFile(
      path.join(directory, 'repo', 'ateam.json'),
      JSON.stringify({
        providers: { 'provider-1': { models: { 'model-1': { name: 'Project Name' } } } }
      })
    )

    const config = await readAgentConfig(userData, workspace)
    expect(config.providers?.['provider-1']?.models?.['model-1']).toEqual({
      name: 'Project Name',
      contextWindow: 200000,
      costInput: 3
    })
  })
})

describe('project config file editor', () => {
  it('creates, reads and validates the project config file', async () => {
    const initial = await readProjectConfigFile(workspace)
    expect(initial.exists).toBe(false)
    expect(initial.path).toBe(path.join(directory, 'repo', 'ateam.json'))

    const written = await writeProjectConfigFile(
      workspace,
      `{\n  // editor\n  "snapshots": false,\n}\n`
    )
    expect(written.exists).toBe(true)
    expect(written.content).toContain('// editor')
    expect(written.diagnostics).toEqual([])

    const reloaded = await readProjectConfigFile(workspace)
    expect(reloaded.path).toBe(written.path)
    expect(reloaded.content).toContain('"snapshots": false')

    await expect(writeProjectConfigFile(workspace, '{ not json')).rejects.toThrow(
      'INVALID_PROJECT_CONFIG'
    )
  })
})
