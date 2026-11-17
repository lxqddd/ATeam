import { onUnmounted } from 'vue'
import { EventApi, type SseHandle } from '../api'
import { useAgentsStore } from '../stores/agents'
import { useRunsStore } from '../stores/runs'
import { useTasksStore } from '../stores/tasks'

let active = false
let handle: SseHandle | null = null
let retryTimer: number | null = null

function handleEvent(raw: string) {
  const tasks = useTasksStore()
  const agents = useAgentsStore()
  const runs = useRunsStore()

  try {
    const event = JSON.parse(raw) as { type?: string }
    if (event.type?.startsWith('task.')) {
      void tasks.fetchAll()
    }
    if (event.type?.startsWith('agent.')) {
      void agents.fetchAll()
    }
    if (event.type?.startsWith('run.')) {
      void runs.fetchAll()
      void tasks.fetchAll()
    }
  } catch {
    // Ignore malformed events.
  }
}

function connect() {
  if (!active) return

  handle = EventApi.subscribe({
    onMessage: (message) => handleEvent(message.data),
    onError: () => scheduleReconnect(),
    onClose: () => scheduleReconnect(),
  })
}

function scheduleReconnect() {
  if (!active || retryTimer !== null) return
  retryTimer = window.setTimeout(() => {
    retryTimer = null
    connect()
  }, 2000)
}

export function useEventStream() {
  active = true
  if (!handle) {
    connect()
  }
  onUnmounted(() => {
    active = false
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer)
      retryTimer = null
    }
    handle?.close()
    handle = null
  })
}
