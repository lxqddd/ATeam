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
  modelStatus?: 'available' | 'unavailable' | 'unknown'
  role?: string
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

export const AGENT_ROLES: { value: string; labelKey: string }[] = [
  { value: 'general', labelKey: 'agents.form.roleGeneral' },
  { value: 'ui_design', labelKey: 'agents.form.roleUiDesign' },
  { value: 'frontend', labelKey: 'agents.form.roleFrontend' },
  { value: 'backend', labelKey: 'agents.form.roleBackend' },
  { value: 'devops', labelKey: 'agents.form.roleDevOps' },
  { value: 'custom', labelKey: 'agents.form.roleCustom' },
]

export interface RuntimeModel {
  id: string
  label?: string
  source: 'runtime' | 'settings'
  default: boolean
  status: 'available' | 'unverified' | 'unavailable'
  deprecated?: boolean
}

export interface RuntimeInfo {
  name: string
  available: boolean
  installed?: boolean
  supported: boolean
  compatible: boolean
  version: string
  detail?: string
  capabilities?: Record<string, boolean>
  models: RuntimeModel[]
  defaultModel?: string
  modelsError?: string
}

export interface CLIHarnessInfo {
  id: string
  displayName: string
  executable: string
  path?: string
  version?: string
  transport?: string
  supported: boolean
  installed: boolean
  npmPackage?: string
  installCommand?: string
  configPath?: string
  authPath?: string
  configPresent: boolean
  authPresent: boolean
  loginChecked: boolean
  loggedIn: boolean
  authMethod?: string
  providers?: string[]
  loginCommand?: string
  accountRoot?: string
  accountProfiles?: { name: string; path: string; loginCommand: string }[]
}

export interface ModelTestResult {  ok: boolean
  runtime: string
  model: string
  latencyMs: number
  message?: string
  error?: string
  errorCode?: string
}

export interface TaskDependency {
  taskId: string
  dependsOnTaskId: string
  type: string
  requiredArtifactKinds: string[]
  createdAt: string
}

export interface TaskReadiness {
  ready: boolean
  reasons: string[]
  waitingOn: string[]
}

export interface TaskDependenciesResponse {
  taskId: string
  outgoing: TaskDependency[]
  incoming: TaskDependency[]
  readiness: TaskReadiness
}

export type AgentWorkStatus = 'idle' | 'working' | 'completed' | 'failed'

export interface RunSummary {
  id: string
  taskId: string
  taskTitle?: string
  status: RunStatus | string
  phase?: string
  startedAt?: string
  endedAt?: string
  durationMs: number
  branch?: string
  headCommit?: string
  error?: string
  errorCode?: string
  summary?: string
  reviewDone: boolean
  artifactCount: number
}

export interface WorkCounts {
  active: number
  completed24h: number
  failed24h: number
}

export interface AgentWork {
  agent: Agent
  workStatus: AgentWorkStatus
  workStatusReason: string
  activeRuns: RunSummary[]
  lastRun: RunSummary | null
  recentRuns: RunSummary[]
  counts: WorkCounts
  generatedAt: string
}

export interface RunSnapshot {
  runId: string
  agentVersionId?: string
  configSnapshot: Record<string, unknown>
  promptHash: string
  runtimeVersion: string
  permissionMode: string
  permissionEnvelope: Record<string, unknown>
  createdAt: string
}

export interface WorkspaceSettings {
  remote?: string
  worktreeRoot?: string
  branchTemplate?: string
  protectedBranches?: string[]
  verificationCommands?: string[]
  sandboxMode?: 'none' | 'seatbelt'
  allowSandboxFallback?: boolean
  accountProfiles?: Record<string, string>
  useGateway?: boolean
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
  { value: 'blocked', label: 'Blocked', hint: 'Waiting on dependencies or manual hold' },
  { value: 'done', label: 'Done', hint: 'Accepted' },
  { value: 'cancelled', label: 'Cancelled', hint: 'No longer needed' },
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

export interface GatewayProvider {
  id: string
  name: string
  kind: string
  baseUrl: string
  apiKey: string
  model: string
  default: boolean
}

export interface GatewayStatus {
  baseUrl: string
  token: string
  configured: boolean
  providers: GatewayProvider[]
}

export interface GatewayProviderInput {
  name: string
  kind?: string
  baseUrl: string
  apiKey?: string
  model?: string
  default?: boolean
}

export interface AgentTeamMember {
  agentId: string
  name: string
  role: string
  roleOverride?: string
  position: number
  joinedAt: string
}

export interface AgentTeam {
  id: string
  workspaceId: string
  name: string
  description: string
  status: string
  revision: number
  members: AgentTeamMember[]
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

export interface Conversation {
  id: string
  teamId: string
  workspaceId: string
  title: string
  status: string
  revision: number
  lastMessageAt?: string
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

export interface RoutingCandidate {
  agentId: string
  name: string
  role: string
}

export interface ConversationRoutingDecision {
  id: string
  conversationId: string
  messageId: string
  mode: string
  source: string
  candidates: RoutingCandidate[]
  selectedAgentId?: string
  rationale?: string
  createdAt: string
}

export interface ConversationMessage {
  id: string
  conversationId: string
  seq: number
  role: 'user' | 'agent' | 'system'
  agentId?: string
  status: string
  content: string
  errorMessage?: string
  usage?: Record<string, unknown>
  routing?: ConversationRoutingDecision
  replyToId?: string
  taskId?: string
  createdAt: string
  updatedAt: string
}
