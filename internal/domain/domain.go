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
	ID           string       `json:"id"`
	WorkspaceID  string       `json:"workspaceId"`
	Title        string       `json:"title"`
	Description  string       `json:"description"`
	Status       TaskStatus   `json:"status"`
	Priority     int          `json:"priority"`
	AssigneeType AssigneeType `json:"assigneeType"`
	AssigneeID   string       `json:"assigneeId"`
	ParentID     string       `json:"parentId,omitempty"`
	Labels       []string     `json:"labels"`
	CreatedAt    time.Time    `json:"createdAt"`
	UpdatedAt    time.Time    `json:"updatedAt"`
}

type Agent struct {
	ID               string    `json:"id"`
	WorkspaceID      string    `json:"workspaceId"`
	Name             string    `json:"name"`
	Description      string    `json:"description"`
	Instructions     string    `json:"instructions"`
	Runtime          string    `json:"runtime"`
	Model            string    `json:"model"`
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
	ID        string         `json:"id"`
	RunID     string         `json:"runId"`
	Seq       int            `json:"seq"`
	Type      string         `json:"type"`
	Message   string         `json:"message"`
	Payload   map[string]any `json:"payload,omitempty"`
	CreatedAt time.Time      `json:"createdAt"`
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
