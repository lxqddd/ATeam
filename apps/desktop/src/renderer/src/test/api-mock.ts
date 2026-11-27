import type {
  AgentConfig,
  AgentDefinition,
  AgentEvent,
  AgentEventEnvelope,
  AgentInfo,
  AgentStatus,
  BackgroundTaskInfo,
  ConfigFileChange,
  EffectiveAgentConfig,
  GlobalConfigFile,
  PluginAuthMethodState,
  PluginAuthResult,
  PluginEntry,
  ProjectConfigEdit,
  ProjectConfigFile,
  AteamApi,
  CommandDefinition,
  McpAuthStatus,
  McpServerConfig,
  McpServerInput,
  McpServerStatus,
  MessageAttachment,
  MessagesSnapshot,
  ModelCatalogEntry,
  ModelRef,
  ModelsConfigPublic,
  PermissionRequest,
  PermissionRuleInput,
  PermissionRulesOverview,
  ProviderOAuthStatus,
  QuestionRequest,
  SessionMeta,
  SessionExportRequest,
  SessionExportResult,
  SessionSearchResult,
  SessionSettings,
  VcsDiffResult,
  VcsStatus,
  WebSearchInput,
  WebSearchProviderPublic
} from '@ateam/shared'
import { vi } from 'vitest'
import { makeSession } from './factories'

const EMPTY_MODELS: ModelsConfigPublic = {
  providers: [],
  models: [],
  defaultModel: null
}

const DEFAULT_INFO: AgentInfo = {
  workspacePath: '/tmp/workspace',
  appVersion: '0.1.0',
  instructionFiles: [],
  lspServers: [],
  formatters: []
}

const DEFAULT_AGENTS: AgentDefinition[] = [
  {
    id: 'build',
    name: 'build',
    description: 'General coding agent with the full toolset.',
    mode: 'primary',
    model: null,
    tools: null,
    permissions: [],
    temperature: null,
    maxSteps: null,
    prompt: '',
    source: 'builtin'
  },
  {
    id: 'plan',
    name: 'plan',
    description: 'Read-only planning agent.',
    mode: 'primary',
    model: null,
    tools: ['read', 'list', 'grep', 'glob'],
    permissions: [],
    temperature: null,
    maxSteps: 20,
    prompt: 'You are the plan agent.',
    source: 'builtin'
  }
]

export interface ApiMock {
  api: AteamApi
  sessions: SessionMeta[]
  messages: Map<string, MessagesSnapshot>
  permissions: PermissionRequest[]
  emit: (event: AgentEvent, seq?: number) => void
  emitConfigChange: (change: ConfigFileChange) => void
  configChangeListenerCount: () => number
}

export function createApiMock(
  options: { status?: AgentStatus; info?: AgentInfo; models?: ModelsConfigPublic } = {}
): ApiMock {
  const status = options.status ?? { status: 'ready' as const }
  const info = options.info ?? DEFAULT_INFO
  const models = options.models ?? EMPTY_MODELS
  const sessions: SessionMeta[] = []
  const messages = new Map<string, MessagesSnapshot>()
  const permissions: PermissionRequest[] = []
  const listeners = new Set<(envelope: AgentEventEnvelope) => void>()
  const configChangeListeners = new Set<(change: ConfigFileChange) => void>()
  let sequence = 0

  const emptySnapshot = (sessionId: string): MessagesSnapshot => ({
    sessionId,
    seq: 0,
    messages: [],
    running: false
  })

  const api: AteamApi = {
    platform: 'darwin',
    versions: { electron: '44.11.5' },
    theme: { set: vi.fn() },
    updates: {
      check: vi.fn(async () => ({
        currentVersion: '0.1.0',
        latestVersion: '0.1.0',
        available: false,
        releaseName: 'ATeam 0.1.0',
        releaseNotes: '',
        releaseUrl: 'https://github.com/lxqddd/ATeam/releases',
        publishedAt: null,
        asset: null
      })),
      download: vi.fn(async (version: string) => ({
        version,
        path: `/tmp/ATeam-${version}.dmg`,
        assetName: `ATeam-${version}.dmg`,
        opened: true
      })),
      onProgress: vi.fn(() => () => undefined)
    },
    openExternal: vi.fn(async () => undefined),
    workspace: {
      open: vi.fn(async () => undefined),
      pickDirectory: vi.fn(async () => null)
    },
    agent: {
      status: vi.fn(async () => status),
      restart: vi.fn(async () => status),
      info: vi.fn(async () => info),
      agents: vi.fn(async () => DEFAULT_AGENTS.map((agent) => ({ ...agent }))),
      onEvent: vi.fn((callback: (envelope: AgentEventEnvelope) => void) => {
        listeners.add(callback)
        return () => {
          listeners.delete(callback)
        }
      }),
      sessions: {
        list: vi.fn(async () => sessions.map((session) => ({ ...session }))),
        create: vi.fn(async (directory?: string | null) => {
          const session = makeSession({
            id: `created-${sessions.length + 1}`,
            directory: directory ?? null
          })
          sessions.unshift(session)
          return session
        }),
        setDirectory: vi.fn(async (id: string, directory: string | null) => {
          const session = sessions.find((entry) => entry.id === id) ?? makeSession({ id })
          session.directory = directory
          return { ...session }
        }),
        rename: vi.fn(async (id: string, title: string) => {
          const session = sessions.find((entry) => entry.id === id) ?? makeSession({ id })
          session.title = title
          return { ...session }
        }),
        remove: vi.fn(async (id: string) => {
          const index = sessions.findIndex((entry) => entry.id === id)
          if (index >= 0) sessions.splice(index, 1)
        }),
        fork: vi.fn(async (id: string, messageId?: string) => {
          const source = sessions.find((entry) => entry.id === id) ?? makeSession({ id })
          const fork = makeSession({
            id: `fork-${Date.now()}`,
            title: `${source.title} (fork)`,
            model: source.model
          })
          void messageId
          sessions.unshift(fork)
          return fork
        }),
        search: vi.fn(async () => [] as SessionSearchResult[]),
        export: vi.fn(async (options: SessionExportRequest): Promise<SessionExportResult> => ({
          saved: true,
          path: `/tmp/ateam-export.${options.format}`,
          sessionCount: options.sessionId ? 1 : sessions.length,
          messageCount: options.sessionId
            ? (messages.get(options.sessionId)?.messages.length ?? 0)
            : 0
        })),
        changes: vi.fn(async (sessionId: string, messageId?: string) => ({
          sessionId,
          messageId: messageId ?? '',
          latest: true,
          canRevert: true,
          canUnrevert: false,
          revertedPaths: [],
          truncated: false,
          files: []
        })),
        changesSummary: vi.fn(async (sessionId: string) => ({
          sessionId,
          turns: [],
          fileCount: 0,
          additions: 0,
          deletions: 0,
          truncated: false
        })),
        revertFiles: vi.fn(async (sessionId: string, messageId: string) => ({
          sessionId,
          messageId,
          latest: true,
          canRevert: true,
          canUnrevert: true,
          revertedPaths: [],
          truncated: false,
          files: []
        })),
        unrevertFiles: vi.fn(async (sessionId: string) => ({
          sessionId,
          messageId: '',
          latest: true,
          canRevert: true,
          canUnrevert: false,
          revertedPaths: [],
          truncated: false,
          files: []
        })),
        setAgent: vi.fn(async (id: string, agent: string | null) => {
          const session = sessions.find((entry) => entry.id === id) ?? makeSession({ id })
          session.agent = agent
          return { ...session }
        }),
        plan: vi.fn(async (id: string) => ({
          path: `.ateam/plans/${id}.md`,
          absolutePath: `/workspace/.ateam/plans/${id}.md`,
          exists: false,
          content: ''
        })),
        setModel: vi.fn(async (id: string, model: ModelRef | null) => {
          const session = sessions.find((entry) => entry.id === id) ?? makeSession({ id })
          session.model = model
          return { ...session }
        }),
        setSettings: vi.fn(async (id: string, settings: SessionSettings) => {
          const session = sessions.find((entry) => entry.id === id) ?? makeSession({ id })
          session.reasoningEffort = settings.reasoningEffort
          session.permissionMode = settings.permissionMode
          return { ...session }
        }),
        compact: vi.fn(async (id: string) => {
          const session = sessions.find((entry) => entry.id === id) ?? makeSession({ id })
          return { ...session }
        }),
        undo: vi.fn(async (...args: unknown[]) => {
          const id = args[0] as string
          const session = sessions.find((entry) => entry.id === id) ?? makeSession({ id })
          return { session: { ...session, redoAvailable: true }, prompt: '' }
        }),
        redo: vi.fn(async (id: string) => {
          const session = sessions.find((entry) => entry.id === id) ?? makeSession({ id })
          return { ...session, redoAvailable: false }
        })
      },
      messages: {
        list: vi.fn(
          async (sessionId: string) => messages.get(sessionId) ?? emptySnapshot(sessionId)
        )
      },
      vcs: {
        status: vi.fn(async (): Promise<VcsStatus> => ({
          info: { isRepository: false, root: null, branch: null, defaultBranch: null },
          files: [],
          truncated: false
        })),
        diff: vi.fn(async (): Promise<VcsDiffResult> => ({
          isRepository: false,
          mode: 'working',
          base: null,
          files: [],
          truncated: false,
          reason: null
        }))
      },
      chat: {
        send: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
        retry: vi.fn(async () => undefined),
        steer: vi.fn(async (input) => ({
          id: `queued-${Date.now()}`,
          sessionId: input.sessionId,
          text: input.text,
          strategy: input.strategy,
          attachments: input.attachments ?? [],
          createdAt: new Date().toISOString()
        })),
        removeQueued: vi.fn(async () => true)
      },
      background: {
        list: vi.fn(async () => [] as BackgroundTaskInfo[]),
        cancel: vi.fn(async () => true)
      },
      permissions: {
        list: vi.fn(async () => permissions.map((permission) => ({ ...permission }))),
        reply: vi.fn(async () => undefined),
        rules: vi.fn(async () => []),
        overview: vi.fn(async (): Promise<PermissionRulesOverview> => ({
          workspace: '/tmp/workspace',
          groups: [
            { source: 'global-persisted', editable: true, rules: [] },
            {
              source: 'global-config',
              editable: false,
              path: '/tmp/config.json',
              rules: []
            },
            { source: 'project-config', editable: false, rules: [] },
            { source: 'agent', editable: false, rules: [] },
            { source: 'session-persisted', editable: true, rules: [] },
            { source: 'policy', editable: false, rules: [] }
          ]
        })),
        addRule: vi.fn(async (input: PermissionRuleInput) => ({
          id: `rule-${Date.now()}`,
          ...input,
          createdAt: new Date().toISOString()
        })),
        removeRule: vi.fn(async () => true)
      },
      questions: {
        list: vi.fn(async () => [] as QuestionRequest[]),
        reply: vi.fn(async () => undefined)
      },
      config: {
        get: vi.fn(async () => ({
          snapshots: true,
          instructions: [],
          lsp: true,
          formatters: true,
          formatterOverrides: {}
        })),
        onExternalChange: vi.fn((callback: (change: ConfigFileChange) => void) => {
          configChangeListeners.add(callback)
          return () => {
            configChangeListeners.delete(callback)
          }
        }),
        update: vi.fn(async (patch: Partial<AgentConfig>) => ({
          snapshots: true,
          instructions: [],
          lsp: true,
          formatters: true,
          formatterOverrides: {},
          ...patch
        })),
        project: {
          get: vi.fn(async (): Promise<ProjectConfigFile> => ({
            path: '/tmp/workspace/ateam.json',
            directory: '/tmp/workspace',
            root: '/tmp/workspace',
            exists: false,
            content: '',
            diagnostics: [],
            document: {}
          })),
          update: vi.fn(async (input: { content: string }): Promise<ProjectConfigFile> => ({
            path: '/tmp/workspace/ateam.json',
            directory: '/tmp/workspace',
            root: '/tmp/workspace',
            exists: true,
            content: input.content,
            diagnostics: [],
            document: {}
          })),
          edit: vi.fn(
            async (input: { edits: ProjectConfigEdit[] }): Promise<ProjectConfigFile> => ({
              path: '/tmp/workspace/ateam.json',
              directory: '/tmp/workspace',
              root: '/tmp/workspace',
              exists: true,
              content: JSON.stringify(input.edits),
              diagnostics: [],
              document: {}
            })
          )
        },
        global: {
          get: vi.fn(async (): Promise<GlobalConfigFile> => ({
            path: '/tmp/user-data/agent/config.json',
            exists: true,
            content: '{}',
            diagnostics: [],
            document: {},
            raw: {}
          })),
          update: vi.fn(async (input: { content: string }): Promise<GlobalConfigFile> => ({
            path: '/tmp/user-data/agent/config.json',
            exists: true,
            content: input.content,
            diagnostics: [],
            document: {},
            raw: {}
          })),
          edit: vi.fn(async (input: { edits: ProjectConfigEdit[] }): Promise<GlobalConfigFile> => ({
            path: '/tmp/user-data/agent/config.json',
            exists: true,
            content: JSON.stringify(input.edits),
            diagnostics: [],
            document: {},
            raw: {}
          }))
        },
        resolve: vi.fn(async (): Promise<EffectiveAgentConfig> => ({
          config: {
            snapshots: true,
            instructions: [],
            lsp: true,
            formatters: true,
            formatterOverrides: {}
          },
          sources: {
            globalConfigPath: '/tmp/user-data/agent/config.json',
            projectConfigPath: null,
            projectConfigDir: null,
            projectRoot: '/tmp/workspace'
          },
          diagnostics: [],
          provenance: {
            snapshots: 'default',
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
            skills: 'default',
            retry: 'default',
            environment: 'default',
            toolOutput: 'default',
            systemPrompt: 'default'
          }
        }))
      },
      plugins: {
        list: vi.fn(async () => [] as PluginEntry[]),
        install: vi.fn(async () => [] as PluginEntry[]),
        update: vi.fn(async () => [] as PluginEntry[]),
        remove: vi.fn(async () => [] as PluginEntry[]),
        authMethods: vi.fn(async () => [] as PluginAuthMethodState[]),
        authorizeAuth: vi.fn(async (): Promise<PluginAuthResult> => ({
          status: 'failed',
          message: 'Authorization unavailable in tests.'
        })),
        completeAuth: vi.fn(async (): Promise<PluginAuthResult> => ({
          status: 'failed',
          message: 'Authorization unavailable in tests.'
        })),
        logoutAuth: vi.fn(async () => [] as PluginAuthMethodState[])
      },
      mcp: {
        list: vi.fn(async () => ({
          servers: [] as McpServerConfig[],
          statuses: [] as McpServerStatus[]
        })),
        statuses: vi.fn(async () => [] as McpServerStatus[]),
        add: vi.fn(async (input: McpServerInput) => ({
          id: `mcp-${Date.now()}`,
          name: input.name,
          type: input.type,
          command: input.command ?? null,
          args: input.args ?? [],
          url: input.url ?? null,
          headers: input.headers ?? {},
          env: input.env ?? {},
          enabled: input.enabled ?? true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })),
        update: vi.fn(async (id: string, input: Partial<McpServerInput>) => ({
          id,
          name: input.name ?? 'demo',
          type: input.type ?? ('local' as const),
          command: input.command ?? null,
          args: input.args ?? [],
          url: input.url ?? null,
          headers: input.headers ?? {},
          env: input.env ?? {},
          enabled: input.enabled ?? true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })),
        remove: vi.fn(async () => true),
        prompt: vi.fn(async () => ''),
        authStatuses: vi.fn(async () => [] as McpAuthStatus[]),
        authorize: vi.fn(async () => [] as McpAuthStatus[]),
        logout: vi.fn(async () => [] as McpAuthStatus[])
      },
      websearch: {
        get: vi.fn(async (): Promise<WebSearchProviderPublic> => ({
          provider: 'tavily',
          hasApiKey: false,
          updatedAt: null
        })),
        update: vi.fn(async (input: WebSearchInput): Promise<WebSearchProviderPublic> => ({
          provider: input.provider,
          hasApiKey: true,
          updatedAt: new Date().toISOString()
        }))
      },
      attachments: {
        import: vi.fn(
          async (
            sessionId: string,
            input: { name: string; mimeType: string; data: Uint8Array }
          ): Promise<MessageAttachment> => ({
            id: `attachment-${Date.now()}`,
            name: input.name,
            mimeType: input.mimeType,
            size: input.data.byteLength,
            kind: input.mimeType.startsWith('image/')
              ? 'image'
              : input.mimeType === 'application/pdf'
                ? 'pdf'
                : 'text',
            path: `/tmp/attachments/${sessionId}/${input.name}`
          })
        ),
        remove: vi.fn(async () => undefined),
        preview: vi.fn(async (): Promise<string | null> => null)
      },
      files: {
        search: vi.fn(async () => [] as string[])
      },
      commands: {
        list: vi.fn(async () => [] as CommandDefinition[]),
        expand: vi.fn(async ({ template }: { template: string; args: string }) => template),
        run: vi.fn(async () => ({ taskId: 'command-task', sessionId: 'command-session' }))
      }
    },
    models: {
      get: vi.fn(async () => models),
      addProvider: vi.fn(async () => models),
      updateProvider: vi.fn(async () => models),
      deleteProvider: vi.fn(async () => models),
      revealApiKey: vi.fn(async () => null as string | null),
      oauthStatuses: vi.fn(async () => [] as ProviderOAuthStatus[]),
      authorizeOAuth: vi.fn(async () => [] as ProviderOAuthStatus[]),
      logoutOAuth: vi.fn(async () => [] as ProviderOAuthStatus[]),
      addModel: vi.fn(async () => models),
      updateModel: vi.fn(async () => models),
      deleteModel: vi.fn(async () => models),
      setDefault: vi.fn(async () => models),
      test: vi.fn(async () => ({ ok: true, message: 'ok' })),
      listModels: vi.fn(async () => []),
      previewModels: vi.fn(async () => []),
      catalog: vi.fn(async () => [] as ModelCatalogEntry[])
    }
  }

  return {
    api,
    sessions,
    messages,
    permissions,
    emit: (event: AgentEvent, seq?: number) => {
      sequence += 1
      const envelope: AgentEventEnvelope = {
        seq: seq ?? sequence,
        at: new Date().toISOString(),
        event
      }
      for (const listener of listeners) listener(envelope)
    },
    emitConfigChange: (change: ConfigFileChange) => {
      for (const listener of configChangeListeners) listener(change)
    },
    configChangeListenerCount: () => configChangeListeners.size
  }
}
