import { randomUUID } from 'node:crypto'
import type { BrowserResultMessage, WorkerMessage, WorkerRequest } from '@ateam/shared'
import { AgentRuntime } from '@ateam/agent-core'
import { normalizeError } from '@ateam/agent-core'

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
const pendingBrowser = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
>()

function send(message: WorkerMessage): void {
  parentPort.postMessage(message)
}

function requestBrowser(
  sessionId: string,
  method: string,
  params?: Record<string, unknown>
): Promise<unknown> {
  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingBrowser.delete(requestId)
      reject(new Error('BROWSER_TIMEOUT'))
    }, 60_000)
    pendingBrowser.set(requestId, { resolve, reject, timer })
    send({ kind: 'browser', requestId, sessionId, method, params })
  })
}

function settleBrowser(message: BrowserResultMessage): void {
  const pending = pendingBrowser.get(message.requestId)
  if (!pending) return
  pendingBrowser.delete(message.requestId)
  clearTimeout(pending.timer)
  if (message.ok) pending.resolve(message.result)
  else pending.reject(new Error(message.error ?? 'BROWSER_FAILED'))
}

function rejectBrowserRequests(error: string): void {
  for (const pending of pendingBrowser.values()) {
    clearTimeout(pending.timer)
    pending.reject(new Error(error))
  }
  pendingBrowser.clear()
}

function requireRuntime(): AgentRuntime {
  if (!runtime) throw new Error('AGENT_NOT_READY')
  return runtime
}

async function handle(request: WorkerRequest): Promise<unknown> {
  switch (request.method) {
    case 'init': {
      if (runtime) await runtime.shutdown()
      rejectBrowserRequests('AGENT_RESTARTED')
      runtime = new AgentRuntime({
        userDataPath: request.params.userDataPath,
        workspacePath: request.params.workspacePath,
        appVersion: request.params.appVersion,
        models: request.params.models,
        providerAuth: request.params.providerAuth ?? [],
        webSearch: request.params.webSearch ?? null,
        mcpAuth: request.params.mcpAuth ?? [],
        onMcpAuth: (auth) => send({ kind: 'mcp-auth', auth }),
        browserRequest: requestBrowser,
        send: (envelope) => send({ kind: 'event', envelope })
      })
      await runtime.init()
      send({ kind: 'ready', status: { pid: process.pid } })
      return { pid: process.pid }
    }
    case 'setModels':
      requireRuntime().setModels(request.params.models)
      return null
    case 'setProviderAuth':
      requireRuntime().setProviderAuth(request.params.auths)
      return null
    case 'setWebSearch':
      requireRuntime().setWebSearch(request.params.config)
      return null
    case 'agents.list':
      return requireRuntime().listAgents(request.params?.workspace)
    case 'commands.list':
      return requireRuntime().listCommands(request.params?.workspace)
    case 'commands.expand':
      return requireRuntime().expandCommand(
        request.params.template,
        request.params.args,
        request.params.workspace
      )
    case 'sessions.list':
      return requireRuntime().listSessions()
    case 'sessions.create':
      return requireRuntime().createSession(request.params?.directory)
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
    case 'sessions.setDirectory':
      return requireRuntime().setSessionDirectory(request.params.id, request.params.directory)
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
    case 'sessions.changes':
      return requireRuntime().messageChanges(request.params.sessionId, request.params.messageId)
    case 'sessions.revertFiles':
      return requireRuntime().revertChangedFiles(
        request.params.sessionId,
        request.params.messageId,
        request.params.paths
      )
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
    case 'config.reload':
      await requireRuntime().reloadConfig(request.params?.workspace)
      return null
    case 'mcp.list': {
      const runtime = requireRuntime()
      return {
        servers: await runtime.listMcpServers(request.params?.workspace),
        statuses: await runtime.mcpStatuses(undefined, request.params?.workspace)
      }
    }
    case 'mcp.statuses':
      return requireRuntime().mcpStatuses({ probe: request.params.probe }, request.params.workspace)
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
        request.params.arguments,
        request.params.workspace
      )
    case 'mcp.setAuth':
      await requireRuntime().setMcpAuth(request.params.auths)
      return null
    case 'plugins.authMethods':
      return requireRuntime().pluginAuthMethods(request.params?.workspace)
    case 'plugins.authorizeAuth':
      return requireRuntime().authorizePluginAuth(
        request.params.workspace,
        request.params.id,
        request.params.answers
      )
    case 'plugins.completeAuth':
      return requireRuntime().completePluginAuth(
        request.params.workspace,
        request.params.requestId,
        request.params.code
      )
    case 'plugins.refreshAuth':
      return requireRuntime().refreshPluginAuth(
        request.params.workspace,
        request.params.provider,
        request.params.credentials
      )
    case 'models.test':
      return requireRuntime().testModel(request.params.providerId, request.params.modelId)
    case 'metrics.get':
      return requireRuntime().metricsSnapshot()
    case 'shutdown':
      rejectBrowserRequests('AGENT_STOPPED')
      await runtime?.shutdown()
      return null
    default:
      throw new Error(`UNKNOWN_METHOD: ${(request as { method?: string }).method ?? 'unknown'}`)
  }
}

parentPort.on('message', (event) => {
  const incoming = event.data as BrowserResultMessage | WorkerRequest
  if (incoming && typeof incoming === 'object' && incoming.method === 'browser.result') {
    settleBrowser(incoming as BrowserResultMessage)
    return
  }
  const request = incoming as WorkerRequest
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
