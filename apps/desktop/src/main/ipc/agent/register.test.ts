import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_CHANNELS } from '@ateam/shared'
import type { AgentIpcOptions } from './context'
import { registerAgentIpc } from './register'

const ipcHandle = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/ateam-agent-ipc-test'),
    getVersion: vi.fn(() => '0.0.0-test')
  },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: ipcHandle },
  shell: { openExternal: vi.fn(), openPath: vi.fn() }
}))

vi.mock('@ateam/agent-core/config', () => ({
  AgentConfigStore: class {
    init = vi.fn(async () => undefined)
    get = vi.fn(() => ({}))
    update = vi.fn((patch: unknown) => patch)
  },
  readProjectConfigFile: vi.fn(async () => ({
    path: '',
    directory: '',
    root: '',
    exists: false,
    content: '',
    diagnostics: []
  })),
  writeProjectConfigFile: vi.fn(async () => ({
    path: '',
    directory: '',
    root: '',
    exists: true,
    content: '',
    diagnostics: []
  })),
  readEffectiveAgentConfig: vi.fn(async () => ({
    config: {},
    sources: {
      globalConfigPath: '',
      projectConfigPath: null,
      projectConfigDir: null,
      projectRoot: ''
    },
    diagnostics: [],
    provenance: {}
  })),
  loadOrgPolicy: vi.fn(() => ({})),
  discoverInstructionFiles: vi.fn(async () => [])
}))

vi.mock('@ateam/agent-core/integrations', () => ({
  discoverFormatters: vi.fn(async () => []),
  availableLspServers: vi.fn(async () => []),
  authorizeMcpServer: vi.fn(async () => undefined)
}))

vi.mock('@ateam/agent-core/attachments', () => ({
  attachmentDataUrl: vi.fn(),
  attachmentDirectory: vi.fn(),
  isPathInsideDirectory: vi.fn(),
  removeAttachment: vi.fn(),
  saveAttachment: vi.fn()
}))

vi.mock('@ateam/agent-core/commands', () => ({
  expandCommandTemplate: vi.fn(),
  runWorkspaceShell: vi.fn()
}))

vi.mock('@ateam/agent-core/references', () => ({
  hasProjectReferences: vi.fn(() => false),
  resolveReferences: vi.fn(async () => [])
}))

vi.mock('../../providers/runtime-config', () => ({
  refreshExpiringProviderAuth: vi.fn(async () => false),
  refreshExpiringPluginAuth: vi.fn(async () => false),
  runtimeModelsWithOAuth: vi.fn((config: unknown) => config)
}))

vi.mock('../../attachments/image', () => ({
  normalizeImageAttachment: vi.fn((input: unknown) => input)
}))

function createOptions(isTrusted = true): AgentIpcOptions {
  return {
    manager: {
      getStatus: vi.fn(),
      restart: vi.fn(),
      request: vi.fn(),
      setModels: vi.fn(),
      setMcpAuth: vi.fn(),
      setWebSearch: vi.fn()
    } as unknown as AgentIpcOptions['manager'],
    modelsStore: {} as unknown as AgentIpcOptions['modelsStore'],
    webSearchStore: {} as unknown as AgentIpcOptions['webSearchStore'],
    mcpAuthStore: {} as unknown as AgentIpcOptions['mcpAuthStore'],
    providerAuthStore: {} as unknown as AgentIpcOptions['providerAuthStore'],
    workspacePath: '/tmp/ateam-agent-ipc-workspace',
    isTrustedSender: () => isTrusted
  }
}

function registeredChannels(): string[] {
  return ipcHandle.mock.calls.map(([channel]) => channel as string)
}

beforeEach(() => {
  ipcHandle.mockClear()
})

describe('registerAgentIpc', () => {
  it('registers every AGENT_CHANNELS key exactly once', () => {
    registerAgentIpc(createOptions())

    const channels = registeredChannels()
    const expected = Object.values(AGENT_CHANNELS)

    expect(channels).toHaveLength(expected.length)
    expect(expected.length).toBeGreaterThan(0)
    expect(channels).toContain(AGENT_CHANNELS.mcpList)
    expect(new Set(channels).size).toBe(channels.length)
    expect([...channels].sort()).toEqual([...expected].sort())
  })

  it('routes every registered channel through the trusted sender gate', () => {
    registerAgentIpc(createOptions(false))

    const listeners = ipcHandle.mock.calls.map(([, listener]) => listener)
    expect(listeners).toHaveLength(Object.keys(AGENT_CHANNELS).length)
    for (const listener of listeners) {
      const invoke = listener as (event: unknown, payload: unknown) => unknown
      expect(() => invoke({}, undefined)).toThrow('UNTRUSTED_SENDER')
    }
  })
})
