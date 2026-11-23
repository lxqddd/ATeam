import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EffectiveAgentConfig } from '@ateam/shared'
import { WorkspaceServices } from './workspace-services'

let directory: string
let workspace: string
let services: WorkspaceServices

function effective(skills: string[]): EffectiveAgentConfig {
  return {
    config: {
      snapshots: true,
      instructions: [],
      lsp: true,
      formatters: true,
      formatterOverrides: {},
      skills
    },
    sources: {
      globalConfigPath: path.join(directory, 'agent', 'config.json'),
      projectConfigPath: path.join(directory, 'ateam.json'),
      projectConfigDir: directory,
      projectRoot: directory
    },
    diagnostics: [],
    provenance: {
      snapshots: 'project',
      instructions: 'default',
      lsp: 'default',
      formatters: 'default',
      references: 'default',
      permissions: 'default',
      mcp: 'default',
      agents: 'default',
      providers: 'default',
      plugins: 'default',
      commands: 'default',
      skills: skills.length > 0 ? 'project' : 'default'
    }
  }
}

beforeEach(async () => {
  directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-workspace-services-'))
  )
  workspace = path.join(directory, 'workspace')
  await fs.mkdir(workspace, { recursive: true })
  services = new WorkspaceServices({
    userDataPath: path.join(directory, 'user-data'),
    defaultWorkspacePath: workspace,
    appVersion: '0.1.1',
    createMcpManager: vi.fn(() => ({
      tools: async () => ({}),
      servers: async () => [],
      statuses: async () => [],
      prompts: async () => [],
      resources: async () => [],
      getPrompt: async () => '',
      readResource: async () => '',
      addServer: async () => {
        throw new Error('unused')
      },
      updateServer: async () => {
        throw new Error('unused')
      },
      removeServer: async () => false,
      setMcpAuth: async () => undefined,
      setTransientServers: async () => undefined,
      dispose: async () => undefined
    })),
    fetchWeb: async () => ({
      url: '',
      status: 200,
      contentType: 'text/plain',
      format: 'text',
      content: ''
    }),
    searchWeb: async () => [],
    workspaceInUse: () => false
  })
})

afterEach(async () => {
  await services.dispose()
  await fs.rm(directory, { recursive: true, force: true })
})

function writeSkill(root: string, name: string): Promise<void> {
  return fs
    .mkdir(path.join(root, name), { recursive: true })
    .then(() =>
      fs.writeFile(
        path.join(root, name, 'SKILL.md'),
        [`---`, `name: ${name}`, `description: ${name} skill`, `---`, `${name} body`].join('\n')
      )
    )
}

describe('WorkspaceServices config cache', () => {
  it('invalidates skill caches when the config fingerprint changes', async () => {
    const first = path.join(directory, 'skills-one')
    const second = path.join(directory, 'skills-two')
    await writeSkill(first, 'one')
    await writeSkill(second, 'two')

    await services.applyConfig(workspace, effective([first]))
    expect((await services.skillsFor(workspace)).map((skill) => skill.name)).toEqual(['one'])

    await services.applyConfig(workspace, effective([second]))
    expect((await services.skillsFor(workspace)).map((skill) => skill.name)).toEqual(['two'])
  })
})
