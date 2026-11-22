import type {
  AgentDefinition,
  AgentPermissionRule,
  PermissionAction,
  SubagentInput
} from '@ateam/shared'
import type { SessionsStore, SessionRecord } from '../sessions/sessions-store'
import { makeAssistantMessage, makeUserMessage } from './messages'
import type { Run } from './types'

export interface SubagentHost {
  store: SessionsStore
  agents(workspace: string): Promise<AgentDefinition[]>
  record(sessionId: string): SessionRecord
  hasRun(sessionId: string): boolean
  registerRun(sessionId: string, run: Run): void
  createSnapshotId(sessionId: string): Promise<string | undefined>
  askPermission(
    parent: Run,
    action: PermissionAction,
    resource: string,
    toolName: string,
    toolCallId: string,
    agentRules?: AgentPermissionRule[]
  ): Promise<boolean>
  runAgent(run: Run): Promise<void>
  startBackground(
    run: Run,
    info: {
      parentSessionId: string
      toolCallId: string
      agentId: string
      cleanup: () => void
    }
  ): void
}

export async function runSubagentTask(
  host: SubagentHost,
  parent: Run,
  input: SubagentInput,
  toolCallId: string
): Promise<string> {
  if (parent.depth >= 1) return 'Error: subagents cannot spawn subagents.'
  const requested = input.agent?.trim() || 'general'
  const agent = (await host.agents(parent.workspace)).find(
    (candidate) =>
      (candidate.id === requested || candidate.name.toLowerCase() === requested.toLowerCase()) &&
      (candidate.mode === 'subagent' || candidate.mode === 'all')
  )
  if (!agent) return `Error: unknown subagent: ${requested}`
  if (!input.prompt.trim()) return 'Error: the subagent prompt is empty.'

  const parentRecord = host.record(parent.sessionId)
  let sessionId = input.sessionId?.trim() || null
  if (sessionId) {
    const record = host.store.get(sessionId)
    if (!record || record.session.parentId !== parent.sessionId) {
      return 'Error: unknown subagent session.'
    }
    if (host.hasRun(sessionId)) return 'Error: the subagent session is busy.'
    if (record.session.agent !== agent.id) await host.store.setAgent(sessionId, agent.id)
  } else {
    const session = await host.store.create({
      hidden: true,
      parentId: parent.sessionId,
      agent: agent.id,
      permissionMode: parentRecord.session.permissionMode,
      directory: parent.workspace
    })
    sessionId = session.id
  }

  const childAbort = new AbortController()
  const onAbort = (): void => childAbort.abort()
  if (parent.abort.signal.aborted) childAbort.abort()
  else parent.abort.signal.addEventListener('abort', onAbort, { once: true })

  const user = makeUserMessage(sessionId, input.prompt)
  const assistant = makeAssistantMessage(sessionId)
  if (parent.config.snapshots) {
    assistant.snapshotBefore = await host.createSnapshotId(sessionId)
  }
  await host.store.appendMessage(sessionId, user)
  await host.store.appendMessage(sessionId, assistant)
  await host.store.setStatus(sessionId, 'running')

  const childRun: Run = {
    sessionId,
    messageId: assistant.id,
    workspace: parent.workspace,
    abort: childAbort,
    startedAt: Date.now(),
    steps: 0,
    config: parent.config,
    agent,
    depth: parent.depth + 1,
    parentSessionId: parent.sessionId,
    permissionDelegate: (action, resource, toolName) =>
      host.askPermission(parent, action, resource, toolName, toolCallId, agent.permissions)
  }
  host.registerRun(sessionId, childRun)
  if (input.background) {
    host.startBackground(childRun, {
      parentSessionId: parent.sessionId,
      toolCallId,
      agentId: agent.id,
      cleanup: () => parent.abort.signal.removeEventListener('abort', onAbort)
    })
    return `[subagent ${agent.id} · session ${sessionId}] running in background`
  }
  try {
    await host.runAgent(childRun)
  } finally {
    parent.abort.signal.removeEventListener('abort', onAbort)
  }

  const message = host.store.get(sessionId)?.messages.find((entry) => entry.id === assistant.id)
  const text = (message?.parts ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim()
  const result =
    message?.status === 'complete'
      ? text
      : `Subagent ${message?.status ?? 'failed'}${message?.error ? `: ${message.error}` : ''}`
  return `[subagent ${agent.id} · session ${sessionId}]\n${result || '(no output)'}`
}
