import type { WorkerMessage, WorkerRequest } from '@ateam/shared'
import { AgentRuntime } from './runtime'
import { normalizeError } from './errors'

interface ParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  postMessage(message: unknown): void
}

const port = (process as unknown as { parentPort?: ParentPort }).parentPort

if (!port) {
  console.error('[agent] parentPort is unavailable')
  process.exit(1)
}

const parentPort: ParentPort = port

let runtime: AgentRuntime | null = null

function send(message: WorkerMessage): void {
  parentPort.postMessage(message)
}

function requireRuntime(): AgentRuntime {
  if (!runtime) throw new Error('AGENT_NOT_READY')
  return runtime
}

async function handle(request: WorkerRequest): Promise<unknown> {
  switch (request.method) {
    case 'init': {
      if (runtime) await runtime.shutdown()
      runtime = new AgentRuntime({
        userDataPath: request.params.userDataPath,
        workspacePath: request.params.workspacePath,
        models: request.params.models,
        send: (envelope) => send({ kind: 'event', envelope })
      })
      await runtime.init()
      send({ kind: 'ready', status: { pid: process.pid } })
      return { pid: process.pid }
    }
    case 'setModels':
      requireRuntime().setModels(request.params.models)
      return null
    case 'sessions.list':
      return requireRuntime().listSessions()
    case 'sessions.create':
      return requireRuntime().createSession()
    case 'sessions.rename':
      return requireRuntime().renameSession(request.params.id, request.params.title)
    case 'sessions.delete':
      await requireRuntime().deleteSession(request.params.id)
      return null
    case 'sessions.setModel':
      return requireRuntime().setSessionModel(request.params.id, request.params.model)
    case 'sessions.setSettings':
      return requireRuntime().setSessionSettings(request.params.id, request.params.settings)
    case 'sessions.compact':
      return requireRuntime().compactSession(request.params.id)
    case 'messages.list':
      return requireRuntime().messages(request.params.sessionId)
    case 'chat.send':
      await requireRuntime().sendChat(
        request.params.sessionId,
        request.params.text,
        request.params.model
      )
      return null
    case 'chat.stop':
      requireRuntime().stopChat(request.params.sessionId)
      return null
    case 'chat.retry':
      await requireRuntime().retryChat(request.params.sessionId)
      return null
    case 'permissions.list':
      return requireRuntime().permissions()
    case 'permission.reply':
      requireRuntime().replyPermission(request.params.requestId, request.params.decision)
      return null
    case 'models.test':
      return requireRuntime().testModel(request.params.providerId, request.params.modelId)
    case 'shutdown':
      await runtime?.shutdown()
      return null
    default:
      throw new Error(`UNKNOWN_METHOD: ${(request as { method?: string }).method ?? 'unknown'}`)
  }
}

parentPort.on('message', (event) => {
  const request = event.data as WorkerRequest
  if (!request || typeof request !== 'object' || typeof request.id !== 'string') return

  void handle(request)
    .then((result) => {
      send({ kind: 'response', id: request.id, ok: true, result })
      if (request.method === 'shutdown') {
        setTimeout(() => process.exit(0), 50)
      }
    })
    .catch((error: unknown) => {
      send({ kind: 'response', id: request.id, ok: false, error: normalizeError(error) })
    })
})

process.on('uncaughtException', (error) => {
  console.error('[agent] uncaught exception', error)
  process.exit(1)
})

process.on('unhandledRejection', (error) => {
  console.error('[agent] unhandled rejection', error)
})
