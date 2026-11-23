import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readAgentConfig } from './config-store'
import { parseProjectConfigContent, readProjectConfig } from './project-config'

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
    expect(config.instructions).toEqual(['global.md', 'project.md'])
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
