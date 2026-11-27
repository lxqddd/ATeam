import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentDefinition } from '@ateam/shared'
import { JsonProviderAuthStore, ModelConfigStore } from '@ateam/agent-core'
import { loadAgents, parseAgentMarkdown } from '@ateam/agent-core/config'
import { McpStore } from '@ateam/agent-core/integrations'
import { configCommandOf, defaultUserDataDir, parseConfigArgs, runConfigCommand } from './config'
import type { CliIo } from './io'

const tempDirs: string[] = []

async function tempDir(label: string): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `ateam-config-${label}-`)))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

function captureIo(overrides: Partial<CliIo> = {}): {
  io: Partial<CliIo>
  stdout(): string
  stderr(): string
} {
  let stdout = ''
  let stderr = ''
  const io: Partial<CliIo> = {
    cwd: process.cwd(),
    stdinIsTTY: true,
    readStdin: async () => '',
    stdout: (text) => {
      stdout += text
    },
    stderr: (text) => {
      stderr += text
    },
    ...overrides
  }
  return { io, stdout: () => stdout, stderr: () => stderr }
}

async function run(
  argv: string[],
  overrides: Partial<CliIo> = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  const captured = captureIo(overrides)
  const code = await runConfigCommand(argv, captured.io)
  return { code, stdout: captured.stdout(), stderr: captured.stderr() }
}

async function openProviderStore(userData: string): Promise<ModelConfigStore> {
  const store = new ModelConfigStore(userData, new JsonProviderAuthStore(userData))
  await store.init()
  return store
}

describe('configCommandOf', () => {
  it('recognizes configuration groups, including after a pnpm separator', () => {
    expect(configCommandOf(['providers'])).toBe('providers')
    expect(configCommandOf(['--', 'mcp', 'list'])).toBe('mcp')
    expect(configCommandOf(['agent', 'create', 'x'])).toBe('agent')
    expect(configCommandOf(['export'])).toBeNull()
    expect(configCommandOf([])).toBeNull()
  })
})

describe('defaultUserDataDir', () => {
  it('uses ATEAM_USER_DATA when set', () => {
    expect(defaultUserDataDir({ ATEAM_USER_DATA: '/tmp/custom' }, 'darwin', '/home/me')).toBe(
      '/tmp/custom'
    )
  })

  it('follows the platform conventions', () => {
    expect(defaultUserDataDir({}, 'darwin', '/Users/me')).toBe(
      path.join('/Users/me', 'Library', 'Application Support', 'ATeam')
    )
    expect(
      defaultUserDataDir({ APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, 'win32', 'C:\\Users\\me')
    ).toBe(path.join('C:\\Users\\me\\AppData\\Roaming', 'ATeam'))
    expect(defaultUserDataDir({ XDG_CONFIG_HOME: '/home/me/.config-x' }, 'linux', '/home/me')).toBe(
      path.join('/home/me/.config-x', 'ATeam')
    )
  })
})

describe('parseConfigArgs', () => {
  const userData = '/tmp/ateam-user-data'

  it('defaults to list for providers and mcp', () => {
    const providers = parseConfigArgs(['providers', '--user-data', userData], '/tmp')
    expect(providers.group).toBe('providers')
    expect(providers.action).toBe('list')
    expect(providers.userData).toBe(userData)
    expect(providers.json).toBe(false)

    const mcp = parseConfigArgs(['mcp', '--json', '--user-data', userData], '/tmp')
    expect(mcp.action).toBe('list')
    expect(mcp.json).toBe(true)
  })

  it('shows agent help when no action is given', () => {
    const options = parseConfigArgs(['agent'], '/tmp')
    expect(options.group).toBe('agent')
    expect(options.action).toBe('create')
    expect(options.help).toBe(true)
  })

  it('parses inline and separated values', () => {
    const options = parseConfigArgs(
      [
        'providers',
        'add',
        '--name=Work',
        '--type',
        'openai',
        '--api-key=sk-secret',
        '--base-url=https://example.test/v1',
        '--json'
      ],
      '/tmp'
    )
    expect(options.action).toBe('add')
    expect(options.name).toBe('Work')
    expect(options.providerType).toBe('openai')
    expect(options.apiKey).toBe('sk-secret')
    expect(options.baseURL).toBe('https://example.test/v1')
    expect(options.json).toBe(true)
  })

  it('parses agent create options', () => {
    const options = parseConfigArgs(
      [
        'agent',
        'create',
        'Review Bot',
        '--description',
        'Reviews diffs',
        '--mode=primary',
        '--model',
        'anthropic/claude-opus-5#fast',
        '--tools',
        'read, grep',
        '--permission',
        'read|*|allow, shell|git *|ask',
        '--steps',
        '12',
        '--temperature=0.4',
        '--prompt',
        'Review carefully.',
        '--force'
      ],
      '/tmp'
    )
    expect(options.name).toBe('Review Bot')
    expect(options.description).toBe('Reviews diffs')
    expect(options.mode).toBe('primary')
    expect(options.model).toBe('anthropic/claude-opus-5#fast')
    expect(options.tools).toEqual(['read', 'grep'])
    expect(options.permission).toBe('read|*|allow, shell|git *|ask')
    expect(options.steps).toBe(12)
    expect(options.temperature).toBe(0.4)
    expect(options.prompt).toBe('Review carefully.')
    expect(options.force).toBe(true)
  })

  it('treats "*" tools as all tools', () => {
    const options = parseConfigArgs(['agent', 'create', 'x', '--tools', '*'], '/tmp')
    expect(options.tools).toBeNull()
  })

  it('rejects unknown actions, flags and action-specific flags', () => {
    expect(() => parseConfigArgs(['providers', 'nope'], '/tmp')).toThrow(/Unknown providers action/)
    expect(() => parseConfigArgs(['mcp', 'list', '--name', 'x'], '/tmp')).toThrow(
      /--name is only valid for providers add/
    )
    expect(() => parseConfigArgs(['providers', 'add', '--bogus'], '/tmp')).toThrow(/Unknown flag/)
    expect(() => parseConfigArgs(['agent', 'create', 'x', '--type', 'openai'], '/tmp')).toThrow(
      /--type is only valid for providers add/
    )
  })

  it('validates enum and numeric values', () => {
    expect(() =>
      parseConfigArgs(['providers', 'add', '--name', 'x', '--type', 'bad'], '/tmp')
    ).toThrow(/--type must be one of/)
    expect(() => parseConfigArgs(['agent', 'create', 'x', '--mode', 'bad'], '/tmp')).toThrow(
      /--mode must be one of/
    )
    expect(() => parseConfigArgs(['agent', 'create', 'x', '--steps', '0'], '/tmp')).toThrow(
      /--steps must be an integer/
    )
    expect(() => parseConfigArgs(['agent', 'create', 'x', '--temperature', '3'], '/tmp')).toThrow(
      /--temperature must be a number/
    )
    expect(() => parseConfigArgs(['agent', 'create', 'x', '--model', 'nope'], '/tmp')).toThrow(
      /--model must look like/
    )
    expect(() =>
      parseConfigArgs(['agent', 'create', 'x', '--permission', 'read|*'], '/tmp')
    ).toThrow(/--permission entries/)
  })

  it('requires a name for providers add and agent create', () => {
    expect(() => parseConfigArgs(['providers', 'add'], '/tmp')).toThrow(/requires --name/)
    expect(() => parseConfigArgs(['agent', 'create'], '/tmp')).toThrow(/requires a name/)
  })

  it('requires a reference for remove, enable and disable', () => {
    expect(() => parseConfigArgs(['providers', 'remove'], '/tmp')).toThrow(/requires an id or name/)
    expect(() => parseConfigArgs(['mcp', 'enable'], '/tmp')).toThrow(/requires an id or name/)
    expect(() => parseConfigArgs(['mcp', 'disable'], '/tmp')).toThrow(/requires an id or name/)
  })
})

describe('providers', () => {
  it('reports an empty store', async () => {
    const userData = await tempDir('providers-empty')
    const result = await run(['providers', '--user-data', userData])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(`No providers configured in ${userData}.`)
  })

  it('adds a provider with a key and never echoes the key', async () => {
    const userData = await tempDir('providers-add')
    const result = await run([
      'providers',
      'add',
      '--user-data',
      userData,
      '--name',
      'Work',
      '--type',
      'anthropic',
      '--api-key',
      'sk-test-secret',
      '--json'
    ])
    expect(result.code).toBe(0)
    expect(result.stdout).not.toContain('sk-test-secret')
    const payload = JSON.parse(result.stdout) as {
      provider: { id: string; name: string; hasApiKey: boolean; authMode: string }
    }
    expect(payload.provider.name).toBe('Work')
    expect(payload.provider.hasApiKey).toBe(true)
    expect(payload.provider.authMode).toBe('apiKey')

    const store = await openProviderStore(userData)
    expect(store.publicConfig().providers.map((provider) => provider.id)).toContain(
      payload.provider.id
    )
    expect(store.revealApiKey(payload.provider.id)).toBe('sk-test-secret')
  })

  it('allows openai-compatible providers without a key', async () => {
    const userData = await tempDir('providers-compatible')
    const result = await run([
      'providers',
      'add',
      '--user-data',
      userData,
      '--name',
      'Local',
      '--type',
      'openai-compatible',
      '--base-url',
      'http://localhost:11434/v1'
    ])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('API key: not set')
  })

  it('fails without a key for hosted providers', async () => {
    const userData = await tempDir('providers-nokey')
    const result = await run([
      'providers',
      'add',
      '--user-data',
      userData,
      '--name',
      'Work',
      '--type',
      'anthropic'
    ])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('API_KEY_REQUIRED')
  })

  it('lists providers written by the desktop store', async () => {
    const userData = await tempDir('providers-list')
    const store = await openProviderStore(userData)
    await store.addProvider({ name: 'Desktop', type: 'openai', apiKey: 'sk-desktop-secret' })

    const text = await run(['providers', '--user-data', userData])
    expect(text.code).toBe(0)
    expect(text.stdout).toContain('Desktop')
    expect(text.stdout).not.toContain('sk-desktop-secret')

    const json = await run(['providers', 'list', '--user-data', userData, '--json'])
    expect(json.code).toBe(0)
    const payload = JSON.parse(json.stdout) as {
      providers: Array<{ name: string; hasApiKey: boolean }>
    }
    expect(payload.providers).toHaveLength(1)
    expect(payload.providers[0]).toMatchObject({ name: 'Desktop', hasApiKey: true })
  })

  it('removes a provider by case-insensitive name and clears its credentials', async () => {
    const userData = await tempDir('providers-remove')
    const store = await openProviderStore(userData)
    await store.addProvider({ name: 'Work', type: 'anthropic', apiKey: 'sk-remove-me' })
    const id = store.publicConfig().providers[0].id

    const result = await run(['providers', 'remove', 'work', '--user-data', userData, '--json'])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ removed: true })

    const reopened = await openProviderStore(userData)
    expect(reopened.publicConfig().providers).toHaveLength(0)
    expect(reopened.revealApiKey(id)).toBeNull()
  })

  it('fails for unknown providers', async () => {
    const userData = await tempDir('providers-missing')
    const result = await run(['providers', 'remove', 'nope', '--user-data', userData])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('PROVIDER_NOT_FOUND')
  })

  it('prints action help', async () => {
    const result = await run(['providers', 'add', '--help'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('providers add --name')
  })
})

describe('mcp', () => {
  async function seedServers(userData: string): Promise<void> {
    const store = new McpStore(userData)
    await store.init()
    await store.add({
      name: 'Local Docs',
      type: 'local',
      command: 'npx',
      args: ['docs-mcp', '--token', 'arg-secret'],
      env: { API_TOKEN: 'env-secret' },
      enabled: true
    })
    await store.add({
      name: 'Remote Docs',
      type: 'remote',
      url: 'https://mcp.example.test/sse',
      headers: { Authorization: 'Bearer header-secret' },
      enabled: true
    })
  }

  it('reports an empty store', async () => {
    const userData = await tempDir('mcp-empty')
    const result = await run(['mcp', '--user-data', userData])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(`No MCP servers configured in ${userData}.`)
  })

  it('lists servers without leaking env, header or argument secrets', async () => {
    const userData = await tempDir('mcp-list')
    await seedServers(userData)

    const text = await run(['mcp', '--user-data', userData])
    expect(text.code).toBe(0)
    expect(text.stdout).toContain('Local Docs')
    expect(text.stdout).toContain('Remote Docs')
    expect(text.stdout).not.toContain('env-secret')
    expect(text.stdout).not.toContain('header-secret')
    expect(text.stdout).not.toContain('arg-secret')

    const json = await run(['mcp', '--user-data', userData, '--json'])
    expect(json.code).toBe(0)
    expect(json.stdout).not.toContain('env-secret')
    expect(json.stdout).not.toContain('header-secret')
    expect(json.stdout).not.toContain('arg-secret')
    const payload = JSON.parse(json.stdout) as {
      servers: Array<{ name: string; envNames: string[]; headerNames: string[]; enabled: boolean }>
    }
    expect(payload.servers).toHaveLength(2)
    const local = payload.servers.find((server) => server.name === 'Local Docs')
    expect(local?.envNames).toEqual(['API_TOKEN'])
    expect(local?.enabled).toBe(true)
    const remote = payload.servers.find((server) => server.name === 'Remote Docs')
    expect(remote?.headerNames).toEqual(['Authorization'])
  })

  it('disables and enables a server by name', async () => {
    const userData = await tempDir('mcp-toggle')
    await seedServers(userData)

    const disabled = await run(['mcp', 'disable', 'local docs', '--user-data', userData, '--json'])
    expect(disabled.code).toBe(0)
    expect(JSON.parse(disabled.stdout)).toMatchObject({ server: { enabled: false } })

    let store = new McpStore(userData)
    await store.init()
    expect(store.list().find((server) => server.name === 'Local Docs')?.enabled).toBe(false)

    const enabled = await run(['mcp', 'enable', 'Local Docs', '--user-data', userData])
    expect(enabled.code).toBe(0)
    expect(enabled.stdout).toContain('Enabled MCP server Local Docs')

    store = new McpStore(userData)
    await store.init()
    expect(store.list().find((server) => server.name === 'Local Docs')?.enabled).toBe(true)
  })

  it('fails for unknown servers', async () => {
    const userData = await tempDir('mcp-missing')
    const result = await run(['mcp', 'enable', 'nope', '--user-data', userData])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('MCP_SERVER_NOT_FOUND')
  })

  it('prints help', async () => {
    const result = await run(['mcp', '--help'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('mcp <list|enable|disable>')
  })
})

describe('agent create', () => {
  it('writes a markdown agent the runtime can load', async () => {
    const userData = await tempDir('agent-create')
    const result = await run(
      [
        'agent',
        'create',
        'Review Bot',
        '--user-data',
        userData,
        '--description',
        'Reviews diffs',
        '--mode',
        'primary',
        '--model',
        'anthropic/claude-opus-5',
        '--tools',
        'read,grep',
        '--permission',
        'read|*|allow',
        '--steps',
        '8',
        '--temperature',
        '0.2',
        '--prompt',
        'Review carefully.',
        '--json'
      ],
      { cwd: userData }
    )
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout) as {
      agent: { id: string; name: string; mode: string; file: string }
    }
    expect(payload.agent).toMatchObject({ id: 'review-bot', name: 'Review Bot', mode: 'primary' })
    expect(payload.agent.file).toBe(path.join(userData, 'agent', 'agents', 'review-bot.md'))

    const content = await fs.readFile(payload.agent.file, 'utf8')
    const parsed = parseAgentMarkdown(payload.agent.file, content, 'user')
    expect(parsed).not.toBeNull()
    expect(parsed).toMatchObject({
      id: 'review-bot',
      name: 'Review Bot',
      description: 'Reviews diffs',
      mode: 'primary',
      tools: ['read', 'grep'],
      maxSteps: 8,
      temperature: 0.2,
      prompt: 'Review carefully.'
    })
    expect(parsed?.model).toMatchObject({ providerId: 'anthropic', modelId: 'claude-opus-5' })
    expect(parsed?.permissions).toEqual([{ action: 'read', resource: '*', effect: 'allow' }])

    const agents = await loadAgents({ userDataPath: userData, workspacePath: userData })
    expect(agents.find((agent: AgentDefinition) => agent.name === 'Review Bot')).toBeDefined()
  })

  it('refuses to overwrite without --force', async () => {
    const userData = await tempDir('agent-exists')
    const first = await run(['agent', 'create', 'Helper', '--user-data', userData])
    expect(first.code).toBe(0)

    const second = await run(['agent', 'create', 'Helper', '--user-data', userData])
    expect(second.code).toBe(1)
    expect(second.stderr).toContain('AGENT_EXISTS')

    const forced = await run([
      'agent',
      'create',
      'Helper',
      '--user-data',
      userData,
      '--description',
      'Updated',
      '--force'
    ])
    expect(forced.code).toBe(0)
    const content = await fs.readFile(path.join(userData, 'agent', 'agents', 'helper.md'), 'utf8')
    expect(content).toContain('description: Updated')
  })

  it('rejects invalid options with usage exit codes', async () => {
    const userData = await tempDir('agent-invalid')
    const badMode = await run(['agent', 'create', 'x', '--user-data', userData, '--mode', 'nope'])
    expect(badMode.code).toBe(2)
    const badSteps = await run(['agent', 'create', 'x', '--user-data', userData, '--steps', '0'])
    expect(badSteps.code).toBe(2)
    const badPermission = await run([
      'agent',
      'create',
      'x',
      '--user-data',
      userData,
      '--permission',
      'read|*|explode'
    ])
    expect(badPermission.code).toBe(2)
    expect(badPermission.stderr).toContain('--permission effect must be one of')
  })

  it('shows create help for a bare agent command', async () => {
    const result = await run(['agent'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('agent create <name>')
  })
})
