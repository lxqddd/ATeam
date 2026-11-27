import type { EffectiveAgentConfig, McpServerConfig, McpServerStatus } from '@ateam/shared'
import { describe, expect, it } from 'vitest'
import {
  redactArguments,
  redactResource,
  sanitizeConfig,
  sanitizeLspServers,
  sanitizeMcpServers,
  sanitizeProviders,
  sanitizeUrl
} from './resources'

const SECRET = 'sk-abcdefghijklmnopqrstuvwxyz'

function effectiveConfig(): EffectiveAgentConfig {
  return {
    config: {
      snapshots: true,
      instructions: [],
      lsp: true,
      formatters: false,
      formatterOverrides: {},
      systemPrompt: `Use ${SECRET} for calls`,
      mcpServers: [
        {
          name: 'github',
          type: 'local',
          command: 'node',
          args: ['server.js'],
          env: { GITHUB_TOKEN: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
          headers: { Authorization: 'Bearer abcdefghijklmnop' }
        }
      ],
      lspServers: {
        custom: {
          command: ['custom-lsp'],
          extensions: ['.foo'],
          env: { LSP_TOKEN: 'lsp-secret-value' }
        }
      },
      formatterServers: {
        custom: {
          command: ['custom-fmt', '$FILE'],
          extensions: ['.foo'],
          environment: { FMT_TOKEN: 'fmt-secret-value' }
        }
      },
      providers: {
        project: {
          type: 'openai-compatible',
          baseURL: 'https://project.example',
          apiKeyEnv: 'PROJECT_KEY'
        }
      }
    },
    sources: {
      globalConfigPath: '/user/agent/config.json',
      projectConfigPath: '/workspace/ateam.json',
      projectConfigDir: '/workspace',
      projectRoot: '/workspace'
    },
    diagnostics: [],
    provenance: {
      snapshots: 'default',
      instructions: 'default',
      lsp: 'project',
      formatters: 'project',
      references: 'default',
      permissions: 'default',
      mcp: 'project',
      agents: 'default',
      providers: 'project',
      plugins: 'default',
      commands: 'default',
      skills: 'default',
      retry: 'default',
      environment: 'default',
      toolOutput: 'default',
      systemPrompt: 'default'
    }
  }
}

function mcpServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'mcp-1',
    name: 'remote',
    type: 'remote',
    command: null,
    args: [],
    url: 'https://user:pass@mcp.example.com/sse?token=query-secret#frag',
    headers: { Authorization: 'Bearer header-secret-value', 'X-Api-Key': 'key-value' },
    env: {},
    enabled: true,
    timeout: null,
    cwd: null,
    oauthClientId: 'client-id',
    oauthScope: 'read',
    oauthRedirectUri: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    source: 'project',
    ...overrides
  }
}

describe('resource sanitizers', () => {
  it('redacts credential flags and values in command arguments', () => {
    expect(
      redactArguments([
        '--token=abc123',
        '--api-key',
        'key-value',
        '--stdio',
        '--monkey=banana',
        'Authorization: Bearer abcdefghijklmnop'
      ])
    ).toEqual([
      '--token=[REDACTED]',
      '--api-key',
      '[REDACTED]',
      '--stdio',
      '--monkey=banana',
      'Authorization: [REDACTED]'
    ])
  })

  it('strips userinfo, query strings and fragments from URLs', () => {
    expect(sanitizeUrl('https://user:pass@mcp.example.com/sse?token=secret#frag')).toBe(
      'https://mcp.example.com/sse'
    )
    expect(sanitizeUrl('')).toBeNull()
    expect(sanitizeUrl(null)).toBeNull()
    expect(sanitizeUrl(`https://example.com/${SECRET}`)).toBe('https://example.com/[REDACTED]')
  })

  it('keeps MCP credential names but never values', () => {
    const statuses: McpServerStatus[] = [
      {
        id: 'mcp-1',
        name: 'remote',
        state: 'connected',
        toolCount: 2,
        promptCount: 0,
        resourceCount: 0,
        error: null,
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]
    const [server] = sanitizeMcpServers(
      [
        mcpServer(),
        mcpServer({
          id: 'mcp-2',
          name: 'local',
          type: 'local',
          command: 'node',
          args: ['server.js', '--token=abc123', '--api-key', 'key-value'],
          url: null,
          source: 'user'
        })
      ],
      statuses
    )

    expect(server).toMatchObject({
      id: 'mcp-1',
      url: 'https://mcp.example.com/sse',
      headerNames: ['Authorization', 'X-Api-Key'],
      envNames: [],
      hasOAuthClientId: true,
      oauthScope: 'read',
      source: 'project',
      status: { id: 'mcp-1', state: 'connected' }
    })
    const second = sanitizeMcpServers([
      mcpServer({
        id: 'mcp-2',
        name: 'local',
        type: 'local',
        command: 'node',
        args: ['server.js', '--token=abc123', '--api-key', 'key-value'],
        url: null,
        source: 'user'
      })
    ])[0]
    expect(second.args).toEqual(['server.js', '--token=[REDACTED]', '--api-key', '[REDACTED]'])
    expect(second.status).toBeNull()
    expect(second.url).toBeNull()
    expect(JSON.stringify([server, second])).not.toContain('header-secret-value')
    expect(JSON.stringify([server, second])).not.toContain('query-secret')
    expect(JSON.stringify([server, second])).not.toContain('abc123')
  })

  it('keeps LSP env names but not values and redacts command arguments', () => {
    const [server] = sanitizeLspServers([
      {
        id: 'custom',
        extensions: ['.foo'],
        command: ['custom-lsp', '--api-key', 'key-value'],
        env: { API_KEY: 'lsp-secret', ZED: 'x' },
        rootMarkers: ['foo.toml'],
        npmPackages: ['custom-lsp']
      }
    ])

    expect(server).toEqual({
      id: 'custom',
      extensions: ['.foo'],
      command: ['custom-lsp', '--api-key', '[REDACTED]'],
      envNames: ['API_KEY', 'ZED'],
      rootMarkers: ['foo.toml'],
      npmPackages: ['custom-lsp']
    })
  })

  it('strips provider URL credentials while keeping key presence', () => {
    expect(
      sanitizeProviders([
        {
          id: 'p1',
          name: 'Project',
          type: 'openai-compatible',
          baseURL: 'https://user:pass@api.example.com/v1?token=secret',
          hasApiKey: true,
          source: 'project'
        }
      ])
    ).toEqual([
      {
        id: 'p1',
        name: 'Project',
        type: 'openai-compatible',
        baseURL: 'https://api.example.com/v1',
        hasApiKey: true,
        source: 'project'
      }
    ])
  })

  it('removes credential maps from the effective config and redacts remaining text', () => {
    const snapshot = sanitizeConfig('/workspace', effectiveConfig())
    const text = JSON.stringify(snapshot)

    expect(snapshot.workspace).toBe('/workspace')
    expect(snapshot.config.mcpServers?.[0]).not.toHaveProperty('env')
    expect(snapshot.config.mcpServers?.[0]).not.toHaveProperty('headers')
    expect(snapshot.config.lspServers?.custom).not.toHaveProperty('env')
    expect(snapshot.config.formatterServers?.custom).not.toHaveProperty('environment')
    expect(snapshot.config.providers?.project.apiKeyEnv).toBe('PROJECT_KEY')
    expect(snapshot.config.systemPrompt).toContain('[REDACTED]')

    expect(text).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    expect(text).not.toContain('lsp-secret-value')
    expect(text).not.toContain('fmt-secret-value')
    expect(text).not.toContain(SECRET)
  })

  it('redacts resource list strings without changing their shape', () => {
    const agents = redactResource([
      {
        id: 'a1',
        name: 'Agent',
        description: 'd',
        mode: 'primary',
        model: null,
        tools: null,
        permissions: [],
        maxSteps: null,
        temperature: null,
        prompt: SECRET,
        source: 'project'
      }
    ])
    expect(agents).toEqual([
      {
        id: 'a1',
        name: 'Agent',
        description: 'd',
        mode: 'primary',
        model: null,
        tools: null,
        permissions: [],
        maxSteps: null,
        temperature: null,
        prompt: '[REDACTED]',
        source: 'project'
      }
    ])
    expect(JSON.stringify(agents)).not.toContain(SECRET)
  })
})
