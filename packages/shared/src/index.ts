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
  workspaceId?: string
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
  workspaceId?: string
  name: string
  description: string
  instructions: string
  runtime: string
  model: string
  workspaceMode: string
  permissionMode?: string
  currentVersionId?: string
  maxConcurrency: number
  timeoutMinutes: number
  allowedPaths: string[]
  allowedCommands: string[]
  createdAt: string
  updatedAt: string
}

export interface WorkspaceSettings {
  remote?: string
  worktreeRoot?: string
  branchTemplate?: string
  protectedBranches?: string[]
  verificationCommands?: string[]
}

export interface Workspace {
  id: string
  name: string
  repoPath: string
  defaultBranch: string
  settings: WorkspaceSettings
  status: string
  archivedAt?: string
  createdAt: string
  updatedAt: string
}

export interface Run {
  id: string
  workspaceId?: string
  agentVersionId?: string
  attempt?: number
  taskId: string
  agentId: string
  status: RunStatus
  trigger: string
  branch: string
  worktree: string
  baseCommit?: string
  headCommit?: string
  summary: string
  error: string
  errorCode?: string
  failureDetail?: string
  createdAt: string
  queuedAt?: string
  startedAt?: string
  endedAt?: string
}

export interface RunEvent {
  id: string
  runId: string
  seq: number
  type: string
  source?: string
  level?: string
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

export interface Artifact {
  id: string
  workspaceId: string
  taskId: string
  runId: string
  type: string
  subtype?: string
  name: string
  mediaType: string
  sizeBytes: number
  sha256: string
  origin: string
  truncated: boolean
  supersedesId?: string
  redactionState: string
  createdAt: string
}

export interface Review {
  id: string
  workspaceId: string
  taskId: string
  runId: string
  status: string
  requestedBy: string
  reviewerId: string
  decisionNote: string
  evidenceSnapshotHash: string
  requiresMerge: boolean
  noMergeReason?: string
  createdAt: string
  startedAt?: string
  decidedAt?: string
  supersededBy?: string
  revision: number
}

export interface ReviewComment {
  id: string
  reviewId: string
  artifactId?: string
  filePath?: string
  line?: number
  severity: string
  body: string
  resolvedAt?: string
  createdBy: string
  createdAt: string
}

export interface MergeRecord {
  id: string
  workspaceId: string
  runId: string
  reviewId: string
  targetBranch: string
  sourceBranch: string
  strategy: string
  commit: string
  operator: string
  result: string
  createdAt: string
}

export interface RunWorkspace {
  runId: string
  path: string
  branch: string
  baseCommit: string
  headCommit: string
  state: string
  cleanupState: string
}

export interface TaskDoD {
  required: string[]
  present: Record<string, boolean>
  satisfied: boolean
  missing: string[]
}

export interface TaskArtifactsResponse {
  artifacts: Artifact[]
  dod: TaskDoD
}
