package store

import (
	"context"
	"errors"

	"github.com/lxqddd/ATeam/internal/domain"
)

var ErrNotFound = errors.New("not found")

type Store interface {
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

	AppendRunEvent(context.Context, *domain.RunEvent) error
	ListRunEvents(context.Context, string) ([]domain.RunEvent, error)

	Close() error
}
