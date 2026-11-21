import type {
  AgentEvent,
  AgentEventEnvelope,
  AgentInfo,
  AgentStatus,
  AteamApi,
  MessagesSnapshot,
  ModelRef,
  ModelsConfigPublic,
  PermissionRequest,
  SessionMeta
} from '@ateam/shared'
import { vi } from 'vitest'
import { makeSession } from './factories'

const EMPTY_MODELS: ModelsConfigPublic = {
  providers: [],
  models: [],
  defaultModel: null,
  encryptionAvailable: true
}

const DEFAULT_INFO: AgentInfo = {
  workspacePath: '/tmp/workspace',
  appVersion: '0.1.0',
  encryptionAvailable: true
}

export interface ApiMock {
  api: AteamApi
  sessions: SessionMeta[]
  messages: Map<string, MessagesSnapshot>
  permissions: PermissionRequest[]
  emit: (event: AgentEvent, seq?: number) => void
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
    openExternal: vi.fn(async () => undefined),
    workspace: { open: vi.fn(async () => undefined) },
    agent: {
      status: vi.fn(async () => status),
      restart: vi.fn(async () => status),
      info: vi.fn(async () => info),
      onEvent: vi.fn((callback: (envelope: AgentEventEnvelope) => void) => {
        listeners.add(callback)
        return () => {
          listeners.delete(callback)
        }
      }),
      sessions: {
        list: vi.fn(async () => sessions.map((session) => ({ ...session }))),
        create: vi.fn(async () => {
          const session = makeSession({ id: `created-${sessions.length + 1}` })
          sessions.unshift(session)
          return session
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
        setModel: vi.fn(async (id: string, model: ModelRef | null) => {
          const session = sessions.find((entry) => entry.id === id) ?? makeSession({ id })
          session.model = model
          return { ...session }
        })
      },
      messages: {
        list: vi.fn(
          async (sessionId: string) => messages.get(sessionId) ?? emptySnapshot(sessionId)
        )
      },
      chat: {
        send: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
        retry: vi.fn(async () => undefined)
      },
      permissions: {
        list: vi.fn(async () => permissions.map((permission) => ({ ...permission }))),
        reply: vi.fn(async () => undefined)
      }
    },
    models: {
      get: vi.fn(async () => models),
      addProvider: vi.fn(async () => models),
      updateProvider: vi.fn(async () => models),
      deleteProvider: vi.fn(async () => models),
      revealApiKey: vi.fn(async () => null as string | null),
      addModel: vi.fn(async () => models),
      updateModel: vi.fn(async () => models),
      deleteModel: vi.fn(async () => models),
      setDefault: vi.fn(async () => models),
      test: vi.fn(async () => ({ ok: true, message: 'ok' }))
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
    }
  }
}
