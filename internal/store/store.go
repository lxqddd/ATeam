package store

import (
	"context"
	"errors"

	"github.com/lxqddd/ATeam/internal/domain"
)

var ErrNotFound = errors.New("not found")

type Store interface {
	CreateWorkspace(context.Context, *domain.Workspace) error
	ListWorkspaces(context.Context) ([]domain.Workspace, error)
	GetWorkspace(context.Context, string) (*domain.Workspace, error)
	UpdateWorkspace(context.Context, *domain.Workspace) error
	// HasActiveRunsByWorkspace reports whether a queued/preparing/running Run
	// belongs to the workspace; repoPath/defaultBranch changes are blocked
	// while true.
	HasActiveRunsByWorkspace(context.Context, string) (bool, error)

	CreateTask(context.Context, *domain.Task) error
	ListTasks(context.Context) ([]domain.Task, error)
	GetTask(context.Context, string) (*domain.Task, error)
	UpdateTask(context.Context, *domain.Task) error
	DeleteTask(context.Context, string) error

	CreateAgent(context.Context, *domain.Agent) error
	ListAgents(context.Context) ([]domain.Agent, error)
	GetAgent(context.Context, string) (*domain.Agent, error)
	UpdateAgent(context.Context, *domain.Agent) error
	DeleteAgent(context.Context, string) error

	CreateRun(context.Context, *domain.Run) error
	ListRuns(context.Context) ([]domain.Run, error)
	ListRunsByTask(context.Context, string) ([]domain.Run, error)
	GetRun(context.Context, string) (*domain.Run, error)
	UpdateRun(context.Context, *domain.Run) error
	// UpdateRunIfActive writes the run only while the stored status is still
	// queued/preparing/running. It reports false when the run already reached
	// a terminal state (for example a concurrent cancel), so callers never
	// resurrect a cancelled run.
	UpdateRunIfActive(context.Context, *domain.Run) (bool, error)
	// MarkRunCancelRequested records cancel_requested_at for an active run
	// without touching the other columns, so worker writes cannot clear it.
	MarkRunCancelRequested(context.Context, string) (bool, error)

	CreateRunConfigSnapshot(context.Context, *domain.RunConfigSnapshot) error
	GetRunConfigSnapshotByRun(context.Context, string) (*domain.RunConfigSnapshot, error)

	CreateArtifact(context.Context, *domain.Artifact) error
	GetArtifact(context.Context, string) (*domain.Artifact, error)
	ListArtifactsByRun(context.Context, string) ([]domain.Artifact, error)
	ListArtifactsByTask(context.Context, string) ([]domain.Artifact, error)
	FindArtifactBySHA(context.Context, string) (*domain.Artifact, error)

	AppendRunEvent(context.Context, *domain.RunEvent) error
	ListRunEvents(context.Context, string) ([]domain.RunEvent, error)

	Close() error
}
