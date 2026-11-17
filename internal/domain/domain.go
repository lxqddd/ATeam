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
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Description     string    `json:"description"`
	Instructions    string    `json:"instructions"`
	Runtime         string    `json:"runtime"`
	Model           string    `json:"model"`
	WorkspaceMode   string    `json:"workspaceMode"`
	MaxConcurrency  int       `json:"maxConcurrency"`
	TimeoutMinutes  int       `json:"timeoutMinutes"`
	AllowedPaths    []string  `json:"allowedPaths"`
	AllowedCommands []string  `json:"allowedCommands"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
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

type Run struct {
	ID        string     `json:"id"`
	TaskID    string     `json:"taskId"`
	AgentID   string     `json:"agentId"`
	Status    RunStatus  `json:"status"`
	Trigger   string     `json:"trigger"`
	Branch    string     `json:"branch"`
	Worktree  string     `json:"worktree"`
	Summary   string     `json:"summary"`
	Error     string     `json:"error"`
	CreatedAt time.Time  `json:"createdAt"`
	StartedAt *time.Time `json:"startedAt,omitempty"`
	EndedAt   *time.Time `json:"endedAt,omitempty"`
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
