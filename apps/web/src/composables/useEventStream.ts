import { onUnmounted } from 'vue'
import { useAgentsStore } from '../stores/agents'
import { useRunsStore } from '../stores/runs'
import { useTasksStore } from '../stores/tasks'

let socket: WebSocket | null = null
let active = false

function connect() {
  if (!active) return

  const tasks = useTasksStore()
  const agents = useAgentsStore()
  const runs = useRunsStore()
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'

  socket = new WebSocket(`${protocol}://${location.host}/api/ws`)
  socket.addEventListener('message', (message) => {
    try {
      const event = JSON.parse(message.data) as { type?: string }
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
  })
  socket.addEventListener('close', () => {
    socket = null
    if (active) {
      window.setTimeout(connect, 2000)
    }
  })
}

export function useEventStream() {
  active = true
  if (!socket) {
    connect()
  }
  onUnmounted(() => {
    active = false
    socket?.close()
    socket = null
  })
}
