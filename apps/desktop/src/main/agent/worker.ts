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
        webSearch: request.params.webSearch ?? null,
        mcpAuth: request.params.mcpAuth ?? [],
        onMcpAuth: (auth) => send({ kind: 'mcp-auth', auth }),
        send: (envelope) => send({ kind: 'event', envelope })
      })
      await runtime.init()
      send({ kind: 'ready', status: { pid: process.pid } })
      return { pid: process.pid }
    }
    case 'setModels':
      requireRuntime().setModels(request.params.models)
      return null
    case 'setWebSearch':
      requireRuntime().setWebSearch(request.params.config)
      return null
    case 'agents.list':
      return requireRuntime().listAgents()
    case 'commands.list':
      return requireRuntime().listCommands()
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
    case 'sessions.setAgent':
      return requireRuntime().setSessionAgent(request.params.id, request.params.agent)
    case 'sessions.compact':
      return requireRuntime().compactSession(request.params.id, { force: request.params.force })
    case 'sessions.undo':
      return requireRuntime().undoSession(request.params.id, request.params.messageId)
    case 'sessions.redo':
      return requireRuntime().redoSession(request.params.id)
    case 'sessions.fork':
      return requireRuntime().forkSession(request.params.id, request.params.messageId)
    case 'sessions.search':
      return requireRuntime().searchSessions(request.params.query)
    case 'messages.list':
      return requireRuntime().messages(request.params.sessionId)
    case 'chat.send':
      await requireRuntime().sendChat(
        request.params.sessionId,
        request.params.text,
        request.params.model,
        request.params.attachments
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
    case 'questions.list':
      return requireRuntime().questions()
    case 'question.reply':
      requireRuntime().replyQuestion(request.params.questionId, request.params.answer)
      return null
    case 'permissions.rules':
      return requireRuntime().listPermissionRules(request.params.sessionId)
    case 'permissions.addRule':
      return requireRuntime().addPermissionRule(request.params)
    case 'permissions.removeRule':
      return requireRuntime().removePermissionRule(request.params.id)
    case 'mcp.list': {
      const runtime = requireRuntime()
      return {
        servers: await runtime.listMcpServers(),
        statuses: await runtime.mcpStatuses()
      }
    }
    case 'mcp.statuses':
      return requireRuntime().mcpStatuses(request.params)
    case 'mcp.add':
      return requireRuntime().addMcpServer(request.params)
    case 'mcp.update':
      return requireRuntime().updateMcpServer(request.params.id, request.params.input)
    case 'mcp.remove':
      return requireRuntime().removeMcpServer(request.params.id)
    case 'mcp.prompt':
      return requireRuntime().mcpPrompt(
        request.params.server,
        request.params.prompt,
        request.params.arguments
      )
    case 'mcp.setAuth':
      await requireRuntime().setMcpAuth(request.params.auths)
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
