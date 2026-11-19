package domain

import (
	"crypto/rand"
	"encoding/hex"
	"time"
)

type TaskStatus string

const (
	TaskBacklog    TaskStatus = "backlog"
	TaskTodo       TaskStatus = "todo"
	TaskInProgress TaskStatus = "in_progress"
	TaskInReview   TaskStatus = "in_review"
	TaskDone       TaskStatus = "done"
	TaskBlocked    TaskStatus = "blocked"
	TaskCancelled  TaskStatus = "cancelled"
)

func (s TaskStatus) Executable() bool {
	switch s {
	case TaskTodo, TaskInProgress, TaskInReview:
		return true
	default:
		return false
	}
}

type AssigneeType string

const AssigneeAgent AssigneeType = "agent"

type Task struct {
	ID                   string       `json:"id"`
	WorkspaceID          string       `json:"workspaceId"`
	Title                string       `json:"title"`
	Description          string       `json:"description"`
	Status               TaskStatus   `json:"status"`
	Priority             int          `json:"priority"`
	AssigneeType         AssigneeType `json:"assigneeType"`
	AssigneeID           string       `json:"assigneeId"`
	ParentID             string       `json:"parentId,omitempty"`
	Labels               []string     `json:"labels"`
	BlockedReason        string       `json:"blockedReason,omitempty"`
	OriginConversationID string       `json:"originConversationId,omitempty"`
	OriginMessageID      string       `json:"originMessageId,omitempty"`
	CreatedAt            time.Time    `json:"createdAt"`
	UpdatedAt            time.Time    `json:"updatedAt"`
}

// TaskDependency is a finish_to_start edge: taskId may start only after
// dependsOnTaskId reaches done (PRD 02-domain-model §3.3).
type TaskDependency struct {
	TaskID                string    `json:"taskId"`
	DependsOnTaskID       string    `json:"dependsOnTaskId"`
	Type                  string    `json:"type"`
	RequiredArtifactKinds []string  `json:"requiredArtifactKinds"`
	CreatedAt             time.Time `json:"createdAt"`
}

const DependencyFinishToStart = "finish_to_start"

// Agent roles are the M2 vocabulary (PRD agent-system §4.4). The role drives
// DAG validation and default gates, never permissions.
const (
	AgentRoleGeneral  = "general"
	AgentRoleUIDesign = "ui_design"
	AgentRoleFrontend = "frontend"
	AgentRoleBackend  = "backend"
	AgentRoleDevOps   = "devops"
	AgentRoleCustom   = "custom"
)

var AgentRoles = []string{AgentRoleGeneral, AgentRoleUIDesign, AgentRoleFrontend, AgentRoleBackend, AgentRoleDevOps, AgentRoleCustom}

func ValidAgentRole(role string) bool {
	for _, candidate := range AgentRoles {
		if role == candidate {
			return true
		}
	}
	return false
}

type Agent struct {
	ID               string    `json:"id"`
	WorkspaceID      string    `json:"workspaceId"`
	Name             string    `json:"name"`
	Description      string    `json:"description"`
	Instructions     string    `json:"instructions"`
	Runtime          string    `json:"runtime"`
	Model            string    `json:"model"`
	ModelStatus      string    `json:"modelStatus,omitempty"`
	Role             string    `json:"role,omitempty"`
	WorkspaceMode    string    `json:"workspaceMode"`
	PermissionMode   string    `json:"permissionMode"`
	CurrentVersionID string    `json:"currentVersionId"`
	MaxConcurrency   int       `json:"maxConcurrency"`
	TimeoutMinutes   int       `json:"timeoutMinutes"`
	AllowedPaths     []string  `json:"allowedPaths"`
	AllowedCommands  []string  `json:"allowedCommands"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

// RuntimeModel is one locally configured model ID for a runtime. Only the
// ID and an optional display label are persisted; availability comes from
// the runtime probe at request time (PRD api-and-data §5.17).
type RuntimeModel struct {
	ID    string `json:"id"`
	Label string `json:"label,omitempty"`
}

type RuntimeModelConfig struct {
	Runtime      string
	Models       []RuntimeModel
	DefaultModel string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type RunStatus string

const (
	RunQueued    RunStatus = "queued"
	RunPreparing RunStatus = "preparing"
	RunRunning   RunStatus = "running"
	RunCompleted RunStatus = "completed"
	RunFailed    RunStatus = "failed"
	RunCancelled RunStatus = "cancelled"
)

// Active reports whether the run has not reached a terminal state yet.
func (s RunStatus) Active() bool {
	return s == RunQueued || s == RunPreparing || s == RunRunning
}

// Terminal reports whether no further transition may overwrite the status.
func (s RunStatus) Terminal() bool { return !s.Active() }

type Run struct {
	ID                string     `json:"id"`
	WorkspaceID       string     `json:"workspaceId"`
	TaskID            string     `json:"taskId"`
	AgentID           string     `json:"agentId"`
	AgentVersionID    string     `json:"agentVersionId,omitempty"`
	ConfigSnapshotID  string     `json:"configSnapshotId,omitempty"`
	Status            RunStatus  `json:"status"`
	Trigger           string     `json:"trigger"`
	Attempt           int        `json:"attempt"`
	Branch            string     `json:"branch"`
	Worktree          string     `json:"worktree"`
	BaseCommit        string     `json:"baseCommit,omitempty"`
	HeadCommit        string     `json:"headCommit,omitempty"`
	Summary           string     `json:"summary"`
	Error             string     `json:"error"`
	ErrorCode         string     `json:"errorCode,omitempty"`
	FailureDetail     string     `json:"failureDetail,omitempty"`
	QueueReason       string     `json:"queueReason,omitempty"`
	RetryOf           string     `json:"retryOf,omitempty"`
	RuntimeSessionID  string     `json:"runtimeSessionId,omitempty"`
	ExitCode          *int       `json:"exitCode,omitempty"`
	CreatedAt         time.Time  `json:"createdAt"`
	QueuedAt          *time.Time `json:"queuedAt,omitempty"`
	StartedAt         *time.Time `json:"startedAt,omitempty"`
	EndedAt           *time.Time `json:"endedAt,omitempty"`
	CancelRequestedAt *time.Time `json:"cancelRequestedAt,omitempty"`
	LastEventAt       *time.Time `json:"lastEventAt,omitempty"`
}

type RunEvent struct {
	ID             string         `json:"id"`
	RunID          string         `json:"runId"`
	Seq            int            `json:"seq"`
	Type           string         `json:"type"`
	Message        string         `json:"message"`
	Payload        map[string]any `json:"payload,omitempty"`
	Source         string         `json:"source,omitempty"`
	Level          string         `json:"level,omitempty"`
	Truncated      bool           `json:"truncated,omitempty"`
	PayloadVersion int            `json:"payloadVersion,omitempty"`
	CreatedAt      time.Time      `json:"createdAt"`
}

func NewID() string {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		return hex.EncodeToString([]byte(time.Now().UTC().Format(time.RFC3339Nano)))
	}
	return hex.EncodeToString(b[:])
}

func Now() time.Time {
	return time.Now().UTC()
}

// --- M2.3 Agent teams and conversations ---

const (
	AgentTeamActive   = "active"
	AgentTeamArchived = "archived"

	ConversationActive   = "active"
	ConversationArchived = "archived"

	MessageRoleUser   = "user"
	MessageRoleAgent  = "agent"
	MessageRoleSystem = "system"

	MessageStatusPending   = "pending"
	MessageStatusCompleted = "completed"
	MessageStatusFailed    = "failed"
	MessageStatusCancelled = "cancelled"

	RoutingModeAuto    = "auto"
	RoutingModeMention = "mention"

	RouteSourceRules   = "router_rules"
	RouteSourceMention = "mention"
)

type AgentTeamMember struct {
	AgentID      string    `json:"agentId"`
	Name         string    `json:"name"`
	Role         string    `json:"role"`
	RoleOverride string    `json:"roleOverride,omitempty"`
	Position     int       `json:"position"`
	JoinedAt     time.Time `json:"joinedAt"`
}

type AgentTeam struct {
	ID          string            `json:"id"`
	WorkspaceID string            `json:"workspaceId"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Status      string            `json:"status"`
	Revision    int               `json:"revision"`
	Members     []AgentTeamMember `json:"members"`
	CreatedAt   time.Time         `json:"createdAt"`
	UpdatedAt   time.Time         `json:"updatedAt"`
	ArchivedAt  *time.Time        `json:"archivedAt,omitempty"`
}

type Conversation struct {
	ID            string     `json:"id"`
	TeamID        string     `json:"teamId"`
	WorkspaceID   string     `json:"workspaceId"`
	Title         string     `json:"title"`
	Status        string     `json:"status"`
	Revision      int        `json:"revision"`
	LastMessageAt *time.Time `json:"lastMessageAt,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
	ArchivedAt    *time.Time `json:"archivedAt,omitempty"`
}

type RoutingCandidate struct {
	AgentID string `json:"agentId"`
	Name    string `json:"name"`
	Role    string `json:"role"`
}

type ConversationRoutingDecision struct {
	ID              string             `json:"id"`
	ConversationID  string             `json:"conversationId"`
	MessageID       string             `json:"messageId"`
	Mode            string             `json:"mode"`
	Source          string             `json:"source"`
	Candidates      []RoutingCandidate `json:"candidates"`
	SelectedAgentID string             `json:"selectedAgentId,omitempty"`
	Rationale       string             `json:"rationale,omitempty"`
	CreatedAt       time.Time          `json:"createdAt"`
}

type ConversationMessage struct {
	ID             string                       `json:"id"`
	ConversationID string                       `json:"conversationId"`
	Seq            int64                        `json:"seq"`
	Role           string                       `json:"role"`
	AgentID        string                       `json:"agentId,omitempty"`
	Status         string                       `json:"status"`
	Content        string                       `json:"content"`
	ErrorMessage   string                       `json:"errorMessage,omitempty"`
	Usage          map[string]any               `json:"usage,omitempty"`
	Routing        *ConversationRoutingDecision `json:"routing,omitempty"`
	ReplyToID      string                       `json:"replyToId,omitempty"`
	TaskID         string                       `json:"taskId,omitempty"`
	CreatedAt      time.Time                    `json:"createdAt"`
	UpdatedAt      time.Time                    `json:"updatedAt"`
}
