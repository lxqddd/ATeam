export type TaskStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'blocked'
  | 'cancelled'

type AssigneeType = '' | 'human' | 'agent' | 'crew'

export type RunStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: number
  assigneeType: AssigneeType
  assigneeId: string
  parentId?: string
  labels: string[]
  createdAt: string
  updatedAt: string
}

export interface Agent {
  id: string
  name: string
  description: string
  instructions: string
  runtime: string
  model: string
  workspaceMode: string
  maxConcurrency: number
  timeoutMinutes: number
  allowedPaths: string[]
  allowedCommands: string[]
  createdAt: string
  updatedAt: string
}

export interface Run {
  id: string
  taskId: string
  agentId: string
  status: RunStatus
  trigger: string
  branch: string
  worktree: string
  summary: string
  error: string
  createdAt: string
  startedAt?: string
  endedAt?: string
}

export interface RunEvent {
  id: string
  runId: string
  seq: number
  type: string
  message: string
  payload?: Record<string, unknown>
  createdAt: string
}

export interface Health {
  status: string
  version: string
  time: string
}

export const TASK_STATUSES: { value: TaskStatus; label: string; hint: string }[] = [
  { value: 'backlog', label: 'Backlog', hint: 'Not ready to run' },
  { value: 'todo', label: 'Todo', hint: 'Ready for an agent' },
  { value: 'in_progress', label: 'In Progress', hint: 'Agent is working' },
  { value: 'in_review', label: 'In Review', hint: 'Waiting for a human' },
  { value: 'done', label: 'Done', hint: 'Accepted' },
]

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
}

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: 'Queued',
  preparing: 'Preparing',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

export const PRIORITY_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Low',
  2: 'Medium',
  3: 'High',
  4: 'Urgent',
}

export const RUNTIMES: { value: string; label: string }[] = [
  { value: 'mock', label: 'Mock' },
  { value: 'claude', label: 'Claude Code' },
]
