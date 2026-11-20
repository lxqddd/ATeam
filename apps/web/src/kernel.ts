import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  KernelEvent,
  KernelMessage,
  KernelModel,
  KernelPart,
  KernelPermission,
  KernelPermissionDecision,
  KernelSession,
  KernelState,
  KernelToolStatus,
} from '@ateam/shared'

export interface KernelController {
  state: KernelState
  sessions: KernelSession[]
  models: KernelModel[]
  activeSessionId: string
  activeSession: KernelSession | null
  messages: KernelMessage[]
  streaming: boolean
  permissions: KernelPermission[]
  loadingMessages: boolean
  sending: boolean
  error: string
  newSession: (title: string) => Promise<void>
  selectSession: (sessionId: string) => void
  switchModel: (model: { id: string; providerID: string }) => Promise<void>
  replyPermission: (requestId: string, decision: KernelPermissionDecision, message?: string) => Promise<void>
  send: (text: string) => Promise<void>
  interrupt: () => Promise<void>
  restart: () => Promise<void>
  refresh: () => Promise<void>
}

const bridge = () => window.ateam?.kernel

interface LiveTool {
  id: string
  name: string
  status: KernelToolStatus
  input?: string
  output?: string
}

interface LiveState {
  messageId: string
  text: string
  reasoning: string
  tools: LiveTool[]
  busy: boolean
}

const EMPTY_LIVE: LiveState = { messageId: '', text: '', reasoning: '', tools: [], busy: false }

function toolContent(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const text = value
    .filter((item): item is { type?: unknown; text?: unknown } => typeof item === 'object' && item !== null)
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => String(item.text))
    .join('\n')
  return text || undefined
}

function upsertTool(state: LiveState, tool: LiveTool): LiveState {
  const existing = state.tools.findIndex((item) => item.id === tool.id)
  return {
    ...state,
    tools:
      existing >= 0
        ? state.tools.map((item, index) => (index === existing ? { ...item, ...tool } : item))
        : [...state.tools, tool],
  }
}

function updateTool(state: LiveState, id: string, patch: Partial<LiveTool>): LiveState {
  const existing = state.tools.find((item) => item.id === id)
  if (!existing) return upsertTool(state, { id, name: 'tool', status: 'running', ...patch })
  return {
    ...state,
    tools: state.tools.map((item) => (item.id === id ? { ...item, ...patch } : item)),
  }
}

function applyLiveEvent(state: LiveState, type: string, data: Record<string, unknown>): LiveState {
  const messageId = typeof data.assistantMessageID === 'string' ? data.assistantMessageID : state.messageId
  // A new assistant message starts a fresh text/tool buffer; earlier parts live in the snapshot.
  const base: LiveState =
    messageId !== state.messageId ? { ...EMPTY_LIVE, busy: state.busy, messageId } : state
  switch (type) {
    case 'session.execution.started':
      return { ...EMPTY_LIVE, busy: true }
    case 'session.execution.succeeded':
    case 'session.execution.failed':
    case 'session.execution.interrupted':
      return { ...state, busy: false }
    case 'session.text.started':
      return { ...base, text: '' }
    case 'session.text.delta':
      return { ...base, text: base.text + String(data.delta ?? '') }
    case 'session.reasoning.delta':
      return { ...base, reasoning: base.reasoning + String(data.delta ?? '') }
    case 'session.tool.input.started':
      return upsertTool(base, {
        id: String(data.id ?? ''),
        name: String(data.name ?? 'tool'),
        status: 'running',
      })
    case 'session.tool.input.ended':
      return updateTool(base, String(data.id ?? ''), { input: String(data.text ?? '') })
    case 'session.tool.called':
      return updateTool(base, String(data.id ?? ''), {
        status: 'running',
        ...(data.input === undefined ? {} : { input: JSON.stringify(data.input) }),
      })
    case 'session.tool.success':
      return updateTool(base, String(data.id ?? ''), {
        status: 'completed',
        ...(toolContent(data.content) ? { output: toolContent(data.content) } : {}),
      })
    case 'session.tool.failed':
      return updateTool(base, String(data.id ?? ''), {
        status: 'failed',
        ...(toolContent(data.content) ? { output: toolContent(data.content) } : {}),
      })
    default:
      return state
  }
}

function mergeLive(messages: KernelMessage[], live: LiveState): KernelMessage[] {
  const parts: KernelPart[] = []
  if (live.reasoning) parts.push({ kind: 'text', text: live.reasoning, reasoning: true })
  if (live.text) parts.push({ kind: 'text', text: live.text })
  for (const tool of live.tools) {
    parts.push({
      kind: 'tool',
      id: tool.id,
      name: tool.name,
      status: tool.status,
      ...(tool.input ? { input: tool.input } : {}),
      ...(tool.output ? { output: tool.output } : {}),
    })
  }
  if (!live.messageId || parts.length === 0) return messages
  const index = messages.findIndex((message) => message.id === live.messageId)
  if (index < 0) {
    return [
      ...messages,
      { id: live.messageId, role: 'assistant', parts, text: live.text, streaming: live.busy },
    ]
  }
  const existing = messages[index]
  if (!existing) return messages
  const snapshotText = existing.parts
    .filter((part): part is Extract<KernelPart, { kind: 'text' }> => part.kind === 'text' && !part.reasoning)
    .map((part) => part.text)
    .join('\n')
  const text = live.text.length >= snapshotText.length ? live.text : snapshotText
  const reasoning =
    live.reasoning ||
    existing.parts
      .filter((part): part is Extract<KernelPart, { kind: 'text' }> => part.kind === 'text' && Boolean(part.reasoning))
      .map((part) => part.text)
      .join('\n')
  const tools = new Map(
    existing.parts
      .filter((part): part is Extract<KernelPart, { kind: 'tool' }> => part.kind === 'tool')
      .map((part) => [part.id, part] as const),
  )
  for (const tool of live.tools) tools.set(tool.id, { kind: 'tool', ...tool })
  const mergedParts: KernelPart[] = []
  if (reasoning) mergedParts.push({ kind: 'text', text: reasoning, reasoning: true })
  if (text) mergedParts.push({ kind: 'text', text })
  mergedParts.push(...tools.values())
  const merged: KernelMessage = { ...existing, parts: mergedParts, text, streaming: live.busy }
  return messages.map((message, position) => (position === index ? merged : message))
}

export function useKernel(): KernelController {
  const [state, setState] = useState<KernelState>({ status: 'stopped' })
  const [sessions, setSessions] = useState<KernelSession[]>([])
  const [models, setModels] = useState<KernelModel[]>([])
  const [live, setLive] = useState<LiveState>(EMPTY_LIVE)
  const [permissions, setPermissions] = useState<KernelPermission[]>([])
  const [activeSessionId, setActiveSessionId] = useState('')
  const [messages, setMessages] = useState<KernelMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const activeRef = useRef('')
  const refreshTimer = useRef<number | null>(null)

  useEffect(() => {
    activeRef.current = activeSessionId
  }, [activeSessionId])

  const loadMessages = useCallback(async (sessionId: string) => {
    const kernel = bridge()
    if (!kernel || !sessionId) {
      setMessages([])
      return
    }
    setLoadingMessages(true)
    try {
      setMessages(await kernel.messages(sessionId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingMessages(false)
    }
  }, [])

  const refreshPermissions = useCallback(async (sessionId: string) => {
    const kernel = bridge()
    if (!kernel || !sessionId) {
      setPermissions([])
      return
    }
    try {
      setPermissions(await kernel.permissions(sessionId))
    } catch {
      /* keep the last list */
    }
  }, [])

  const refresh = useCallback(async () => {
    const kernel = bridge()
    if (!kernel) {
      setError('Desktop kernel bridge is unavailable')
      return
    }
    try {
      const nextState = await kernel.status()
      setState(nextState)
      if (nextState.status !== 'ready') {
        setSessions([])
        return
      }
      const nextSessions = await kernel.sessions()
      setSessions(nextSessions)
      setError('')
      const current = activeRef.current
      if (!current && nextSessions.length > 0) {
        const first = nextSessions[0]
        if (first) {
          activeRef.current = first.id
          setActiveSessionId(first.id)
        }
      }
      if (current) {
        setMessages(await kernel.messages(current))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    const kernel = bridge()
    if (!kernel) {
      setError('Desktop kernel bridge is unavailable')
      return
    }
    void refresh()
    // Safety net for missed events; streams drive the UI between these ticks.
    const timer = window.setInterval(() => {
      void refresh()
    }, 10_000)
    const unsubscribe = kernel.onEvent((event: KernelEvent) => {
      const data =
        event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {}
      const sessionID = typeof data.sessionID === 'string' ? data.sessionID : undefined
      if (sessionID && activeRef.current && sessionID !== activeRef.current) {
        return
      }
      setLive((current) => applyLiveEvent(current, event.type, data))
      if (event.type.startsWith('permission.')) {
        void refreshPermissions(activeRef.current)
      }
      // Deltas arrive in bursts; only durable updates need a snapshot refresh.
      if (event.type.endsWith('.delta')) {
        return
      }
      if (refreshTimer.current) {
        window.clearTimeout(refreshTimer.current)
      }
      refreshTimer.current = window.setTimeout(() => {
        refreshTimer.current = null
        const current = activeRef.current
        if (current) {
          void loadMessages(current)
        }
        void kernel.sessions().then(setSessions).catch(() => undefined)
      }, 150)
    })
    return () => {
      window.clearInterval(timer)
      unsubscribe()
      if (refreshTimer.current) {
        window.clearTimeout(refreshTimer.current)
      }
    }
  }, [loadMessages, refresh])

  useEffect(() => {
    if (state.status !== 'ready') {
      setModels([])
      return
    }
    let cancelled = false
    // The catalog settles shortly after the kernel reports ready; retry until it does.
    const load = async (attempt: number) => {
      const next = (await bridge()?.models()) ?? []
      if (cancelled) return
      if (next.length > 0 || attempt >= 10) {
        setModels(next)
        return
      }
      window.setTimeout(() => void load(attempt + 1), 1000)
    }
    void load(0)
    return () => {
      cancelled = true
    }
  }, [state.status])

  useEffect(() => {
    setLive(EMPTY_LIVE)
    if (activeSessionId) {
      void loadMessages(activeSessionId)
      void refreshPermissions(activeSessionId)
    } else {
      setMessages([])
      setPermissions([])
    }
  }, [activeSessionId, loadMessages, refreshPermissions])

  const switchModel = useCallback(async (model: { id: string; providerID: string }) => {
    const kernel = bridge()
    const sessionId = activeRef.current
    if (!kernel || !sessionId) return
    try {
      await kernel.switchModel(sessionId, model)
      setSessions((current) =>
        current.map((session) => (session.id === sessionId ? { ...session, model } : session)),
      )
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const replyPermission = useCallback(
    async (requestId: string, decision: KernelPermissionDecision, message?: string) => {
      const kernel = bridge()
      const sessionId = activeRef.current
      if (!kernel || !sessionId) return
      try {
        await kernel.replyPermission({
          sessionId,
          requestId,
          decision,
          ...(message ? { message } : {}),
        })
        await refreshPermissions(sessionId)
        setError('')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [refreshPermissions],
  )

  const selectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId)
  }, [])

  const newSession = useCallback(
    async (title: string) => {
      const kernel = bridge()
      if (!kernel) {
        return
      }
      try {
        const session = await kernel.createSession(title)
        setSessions((current) => [session, ...current])
        setActiveSessionId(session.id)
        setMessages([])
        setError('')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [],
  )

  const send = useCallback(
    async (text: string) => {
      const kernel = bridge()
      const content = text.trim()
      if (!kernel || !content || sending) {
        return
      }
      setSending(true)
      setError('')
      try {
        let sessionId = activeRef.current
        if (!sessionId) {
          const session = await kernel.createSession(content.slice(0, 40))
          sessionId = session.id
          setSessions((current) => [session, ...current])
          setActiveSessionId(session.id)
        }
        await kernel.prompt(sessionId, content)
        await loadMessages(sessionId)
        const nextSessions = await kernel.sessions()
        setSessions(nextSessions)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setSending(false)
      }
    },
    [loadMessages, sending],
  )

  const interrupt = useCallback(async () => {
    const kernel = bridge()
    if (!kernel || !activeRef.current) {
      return
    }
    try {
      await kernel.interrupt(activeRef.current)
      await loadMessages(activeRef.current)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [loadMessages])

  const restart = useCallback(async () => {
    const kernel = bridge()
    if (!kernel) {
      return
    }
    try {
      setState(await kernel.restart())
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [refresh])

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  )

  const displayMessages = useMemo(() => mergeLive(messages, live), [messages, live])

  return {
    state,
    sessions,
    models,
    activeSessionId,
    activeSession,
    messages: displayMessages,
    streaming: live.busy,
    permissions,
    loadingMessages,
    sending,
    error,
    newSession,
    selectSession,
    switchModel,
    replyPermission,
    send,
    interrupt,
    restart,
    refresh,
  }
}
