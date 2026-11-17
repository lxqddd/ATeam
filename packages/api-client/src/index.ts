import type { Agent, Health, Run, RunEvent, Task } from '@ateam/shared'

export interface CreateTaskInput {
  title: string
  description?: string
  status?: Task['status']
  priority?: number
  assigneeType?: Task['assigneeType']
  assigneeId?: string
  parentId?: string
  labels?: string[]
}

export interface CreateAgentInput {
  name: string
  description?: string
  instructions?: string
  runtime?: string
  model?: string
  workspaceMode?: string
  maxConcurrency?: number
  timeoutMinutes?: number
  allowedPaths?: string[]
  allowedCommands?: string[]
}

export function createClient(baseUrl = '/api') {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(body || response.statusText)
    }
    if (response.status === 204) {
      return undefined as T
    }
    return (await response.json()) as T
  }

  return {
    health: () => request<Health>('/health'),

    listTasks: () => request<Task[]>('/tasks'),
    getTask: (id: string) => request<Task>(`/tasks/${id}`),
    createTask: (input: CreateTaskInput) =>
      request<Task>('/tasks', { method: 'POST', body: JSON.stringify(input) }),
    updateTask: (id: string, patch: Partial<Task>) =>
      request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    deleteTask: (id: string) =>
      request<void>(`/tasks/${id}`, { method: 'DELETE' }),

    listAgents: () => request<Agent[]>('/agents'),
    getAgent: (id: string) => request<Agent>(`/agents/${id}`),
    createAgent: (input: CreateAgentInput) =>
      request<Agent>('/agents', { method: 'POST', body: JSON.stringify(input) }),
    updateAgent: (id: string, patch: Partial<Agent>) =>
      request<Agent>(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    deleteAgent: (id: string) =>
      request<void>(`/agents/${id}`, { method: 'DELETE' }),

    listRuns: () => request<Run[]>('/runs'),
    listRunsByTask: (taskId: string) => request<Run[]>(`/tasks/${taskId}/runs`),
    getRun: (id: string) => request<Run>(`/runs/${id}`),
    createRun: (taskId: string, input: { agentId: string; trigger?: string }) =>
      request<Run>(`/tasks/${taskId}/runs`, { method: 'POST', body: JSON.stringify(input) }),
    listRunEvents: (runId: string) => request<RunEvent[]>(`/runs/${runId}/events`),
    cancelRun: (runId: string) =>
      request<Run>(`/runs/${runId}/cancel`, { method: 'POST' }),
  }
}

export type ApiClient = ReturnType<typeof createClient>
