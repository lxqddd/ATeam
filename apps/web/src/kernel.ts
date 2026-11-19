import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KernelEvent, KernelMessage, KernelSession, KernelState } from '@ateam/shared'

export interface KernelController {
  state: KernelState
  sessions: KernelSession[]
  activeSessionId: string
  activeSession: KernelSession | null
  messages: KernelMessage[]
  loadingMessages: boolean
  sending: boolean
  error: string
  newSession: (title: string) => Promise<void>
  selectSession: (sessionId: string) => void
  send: (text: string) => Promise<void>
  interrupt: () => Promise<void>
  restart: () => Promise<void>
  refresh: () => Promise<void>
}

const bridge = () => window.ateam?.kernel

export function useKernel(): KernelController {
  const [state, setState] = useState<KernelState>({ status: 'stopped' })
  const [sessions, setSessions] = useState<KernelSession[]>([])
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
    const timer = window.setInterval(() => {
      void refresh()
    }, 2000)
    const unsubscribe = kernel.onEvent((event: KernelEvent) => {
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
      }, 300)
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
    if (activeSessionId) {
      void loadMessages(activeSessionId)
    } else {
      setMessages([])
    }
  }, [activeSessionId, loadMessages])

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

  return {
    state,
    sessions,
    activeSessionId,
    activeSession,
    messages,
    loadingMessages,
    sending,
    error,
    newSession,
    selectSession,
    send,
    interrupt,
    restart,
    refresh,
  }
}
