import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readEffectiveAgentConfig } from './config-store'
import { readProjectConfigFile, writeProjectConfigFile } from './project-config'

let directory: string
let userData: string
let repo: string
let workspace: string

const PROJECT_CONFIG = `{
  // project overrides with JSONC
  "snapshots": false,
  "instructions": ["docs/rules.md", "docs/rules.md"],
  "lsp": {
    "project-ts": { "command": ["project-lsp"], "extensions": [".tsx"] }
  },
  "formatters": {
    "project-fmt": { "command": ["project-fmt", "$FILE"], "extensions": [".p"] }
  },
  "formatterOverrides": { ".ts": "project-fmt" },
  "permissions": [{ "action": "write", "resource": "src/*", "effect": "allow" }],
  "mcp": [{ "name": "project-mcp", "type": "local", "command": "node", "args": ["server.js"] }],
  "providers": {
    "provider-1": {
      "baseURL": "https://project.example",
      "apiKey": "super-secret",
      "models": { "project-model": { "name": "Project", "contextWindow": 8192 } }
    }
  },
  "commands": { "review": { "template": "Review $ARGUMENTS", "description": "Review" } },
  "skills": ["project-skills", "https://example.com/skill"],
  "references": [{ "alias": "project-docs", "path": "docs" }],
  "agents": [{ "name": "project-reviewer", "description": "Reviewer", "mode": "primary" }],
  "environment": { "notes": "Project note" },
  "retry": { "maxRetries": 99 },
  "systemPrompt": "Project-specific prompt.",
}
`

async function writeGlobalConfig(): Promise<void> {
  await fs.mkdir(path.join(userData, 'agent'), { recursive: true })
  await fs.writeFile(
    path.join(userData, 'agent', 'config.json'),
    JSON.stringify({
      snapshots: true,
      instructions: ['global-rules.md'],
      lsp: { 'global-ts': { command: ['global-lsp'], extensions: ['.ts'] } },
      formatters: {
        'global-fmt': { command: ['global-fmt', '$FILE'], extensions: ['.g'] }
      },
      formatterOverrides: { '.g': 'global-fmt' },
      permissions: [{ action: 'shell', resource: 'rm *', effect: 'deny' }],
      mcp: [{ name: 'global-mcp', type: 'local', command: 'node' }],
      providers: {
        'provider-1': {
          baseURL: 'https://global.example',
          models: { 'global-model': { name: 'Global' } }
        }
      },
      commands: { 'global-review': { template: 'Global review' } },
      skills: ['global-skills'],
      references: [{ alias: 'global-docs', path: 'global-docs' }],
      environment: { timezone: 'UTC', notes: 'Global note' },
      retry: { maxRetries: 2, maxDelayMs: 5_000, timeoutMs: 1_000 }
    })
  )
}

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-config-e2e-')))
  userData = path.join(directory, 'user-data')
  repo = path.join(directory, 'repo')
  workspace = path.join(repo, 'packages', 'app')
  await fs.mkdir(path.join(repo, '.git'), { recursive: true })
  await fs.mkdir(workspace, { recursive: true })
  await fs.mkdir(path.join(repo, 'docs'), { recursive: true })
  await fs.mkdir(path.join(repo, 'project-skills', 'demo'), { recursive: true })
  await fs.mkdir(path.join(userData, 'agent', 'global-skills', 'demo'), { recursive: true })
  await fs.writeFile(path.join(repo, 'docs', 'rules.md'), 'PROJECT_RULE_MARKER')
  await fs.writeFile(path.join(userData, 'agent', 'global-rules.md'), 'GLOBAL_RULE_MARKER')
  await writeGlobalConfig()
  await fs.writeFile(path.join(repo, 'ateam.jsonc'), PROJECT_CONFIG)
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('layered project configuration end to end', () => {
  it('merges sources, paths, overrides and bad fields without secrets', async () => {
    const effective = await readEffectiveAgentConfig(userData, workspace)
    const config = effective.config

    expect(effective.sources).toEqual({
      globalConfigPath: path.join(userData, 'agent', 'config.json'),
      projectConfigPath: path.join(repo, 'ateam.jsonc'),
      projectConfigDir: repo,
      projectRoot: repo
    })
    expect(effective.provenance).toMatchObject({
      snapshots: 'project',
      instructions: 'merged',
      lsp: 'project',
      formatters: 'project',
      permissions: 'merged',
      mcp: 'merged',
      agents: 'project',
      providers: 'merged',
      commands: 'merged',
      skills: 'merged',
      references: 'merged',
      retry: 'global',
      environment: 'merged',
      systemPrompt: 'project'
    })

    expect(config.snapshots).toBe(false)
    expect(config.instructions).toEqual(['global-rules.md', path.join(repo, 'docs', 'rules.md')])
    expect(config.lspServers).toEqual({
      'global-ts': { command: ['global-lsp'], extensions: ['.ts'] },
      'project-ts': { command: ['project-lsp'], extensions: ['.tsx'] }
    })
    expect(config.formatterServers).toEqual({
      'global-fmt': { command: ['global-fmt', '$FILE'], extensions: ['.g'] },
      'project-fmt': { command: ['project-fmt', '$FILE'], extensions: ['.p'] }
    })
    expect(config.formatterOverrides).toEqual({ '.g': 'global-fmt', '.ts': 'project-fmt' })
    expect(config.permissionRules).toEqual([
      { action: 'shell', resource: 'rm *', effect: 'deny', sessionId: null },
      { action: 'write', resource: 'src/*', effect: 'allow', sessionId: null }
    ])
    expect(config.mcpServers).toEqual([
      { name: 'global-mcp', type: 'local', command: 'node' },
      { name: 'project-mcp', type: 'local', command: 'node', args: ['server.js'] }
    ])
    expect(effective.projectMcpServers).toEqual([
      { name: 'project-mcp', type: 'local', command: 'node', args: ['server.js'] }
    ])
    expect(config.providers?.['provider-1']).toMatchObject({
      baseURL: 'https://project.example',
      models: {
        'global-model': { name: 'Global' },
        'project-model': { name: 'Project', contextWindow: 8192 }
      }
    })
    expect(config.commands?.map((command) => command.name).sort()).toEqual([
      'global-review',
      'review'
    ])
    expect(config.commands?.find((command) => command.name === 'review')?.source).toBe('project')
    expect(config.skills).toEqual([
      path.join(userData, 'agent', 'global-skills'),
      path.join(repo, 'project-skills')
    ])
    expect(config.references).toEqual([
      { alias: 'global-docs', path: 'global-docs' },
      { alias: 'project-docs', path: path.join(repo, 'docs') }
    ])
    expect(config.environment).toEqual({ timezone: 'UTC', notes: 'Project note' })
    expect(config.retry).toEqual({ maxRetries: 2, maxDelayMs: 5_000, timeoutMs: 1_000 })
    expect(config.systemPrompt).toBe('Project-specific prompt.')
    expect(config.agents).toHaveLength(1)
    expect(JSON.stringify(effective)).not.toContain('super-secret')
    expect(effective.diagnostics.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(['$.providers.provider-1.apiKey', '$.retry.maxRetries', '$.skills'])
    )
  })

  it('keeps global settings when the project config is invalid', async () => {
    await fs.writeFile(path.join(repo, 'ateam.jsonc'), '{ not json')

    const effective = await readEffectiveAgentConfig(userData, workspace)

    expect(effective.config.snapshots).toBe(true)
    expect(effective.config.instructions).toEqual(['global-rules.md'])
    expect(effective.sources.projectConfigPath).toBe(path.join(repo, 'ateam.jsonc'))
    expect(effective.diagnostics.some((entry) => entry.severity === 'error')).toBe(true)
    expect(effective.provenance.snapshots).toBe('global')
  })

  it('edits the project config through the file API and reloads it', async () => {
    const file = await readProjectConfigFile(workspace)
    expect(file).toMatchObject({
      path: path.join(repo, 'ateam.jsonc'),
      directory: repo,
      root: repo,
      exists: true
    })
    expect(file.diagnostics.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(['$.providers.provider-1.apiKey', '$.retry.maxRetries', '$.skills'])
    )

    const updated = await writeProjectConfigFile(
      workspace,
      JSON.stringify({ instructions: ['docs/new.md'], commands: { ship: { template: 'Ship' } } })
    )
    expect(updated.exists).toBe(true)
    expect(updated.content).toContain('docs/new.md')

    const effective = await readEffectiveAgentConfig(userData, workspace)
    expect(effective.config.instructions).toContain(path.join(repo, 'docs', 'new.md'))
    expect(effective.config.commands?.map((command) => command.name)).toContain('ship')
    expect(effective.config.snapshots).toBe(true)

    await expect(writeProjectConfigFile(workspace, '{ broken')).rejects.toThrow(
      'INVALID_PROJECT_CONFIG'
    )
    expect((await readProjectConfigFile(workspace)).content).toContain('docs/new.md')
  })
})
