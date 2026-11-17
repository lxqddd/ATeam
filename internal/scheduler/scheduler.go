package scheduler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/lxqddd/ATeam/internal/domain"
	"github.com/lxqddd/ATeam/internal/events"
	"github.com/lxqddd/ATeam/internal/runtime"
	"github.com/lxqddd/ATeam/internal/store"
	"github.com/lxqddd/ATeam/internal/workspace"
)

type Scheduler struct {
	store      store.Store
	hub        *events.Hub
	registry   *runtime.Registry
	workspaces *workspace.Manager
	queue      chan string
	workers    int
	mu         sync.Mutex
	cancels    map[string]context.CancelFunc
}

func New(st store.Store, hub *events.Hub, registry *runtime.Registry, workspaces *workspace.Manager, workers int) *Scheduler {
	if workers < 1 {
		workers = 1
	}
	return &Scheduler{
		store:      st,
		hub:        hub,
		registry:   registry,
		workspaces: workspaces,
		queue:      make(chan string, 256),
		workers:    workers,
		cancels:    make(map[string]context.CancelFunc),
	}
}

func (s *Scheduler) Start(ctx context.Context) {
	for index := 0; index < s.workers; index++ {
		go s.worker(ctx)
	}
}

func (s *Scheduler) Enqueue(ctx context.Context, runID string) error {
	select {
	case s.queue <- runID:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Scheduler) Cancel(runID string) bool {
	s.mu.Lock()
	cancel, ok := s.cancels[runID]
	s.mu.Unlock()
	if ok {
		cancel()
	}
	return ok
}

func (s *Scheduler) worker(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case runID := <-s.queue:
			s.execute(ctx, runID)
		}
	}
}

func (s *Scheduler) execute(ctx context.Context, runID string) {
	run, err := s.store.GetRun(ctx, runID)
	if err != nil {
		slog.Warn("load run", "run", runID, "error", err)
		return
	}

	task, err := s.store.GetTask(ctx, run.TaskID)
	if err != nil {
		s.fail(ctx, run, fmt.Errorf("load task: %w", err))
		return
	}
	agent, err := s.store.GetAgent(ctx, run.AgentID)
	if err != nil {
		s.fail(ctx, run, fmt.Errorf("load agent: %w", err))
		return
	}
	if !task.Status.Executable() {
		s.fail(ctx, run, fmt.Errorf("task %s is %s; move it to todo or in_progress before running", task.ID, task.Status))
		return
	}

	run.Status = domain.RunPreparing
	started := domain.Now()
	run.StartedAt = &started
	s.saveRun(ctx, run, "run.preparing")

	workdir, err := s.workspaces.Prepare(ctx, run.ID, agent.WorkspaceMode)
	if err != nil {
		s.fail(ctx, run, err)
		return
	}
	run.Worktree = workdir
	run.Status = domain.RunRunning
	s.saveRun(ctx, run, "run.running")

	runCtx := ctx
	cancelRun := func() {}
	if agent.TimeoutMinutes > 0 {
		runCtx, cancelRun = context.WithTimeout(ctx, time.Duration(agent.TimeoutMinutes)*time.Minute)
	}
	s.mu.Lock()
	s.cancels[run.ID] = cancelRun
	s.mu.Unlock()
	defer func() {
		cancelRun()
		s.mu.Lock()
		delete(s.cancels, run.ID)
		s.mu.Unlock()
	}()

	sequence := 0
	emit := func(event runtime.Event) {
		sequence++
		runEvent := &domain.RunEvent{
			ID:        domain.NewID(),
			RunID:     run.ID,
			Seq:       sequence,
			Type:      event.Type,
			Message:   event.Message,
			Payload:   event.Data,
			CreatedAt: domain.Now(),
		}
		if err := s.store.AppendRunEvent(ctx, runEvent); err != nil {
			slog.Warn("append run event", "run", run.ID, "error", err)
		}
		s.hub.Broadcast(events.Event{Type: "run.event", Data: runEvent})
	}

	adapter := s.registry.Get(agent.Runtime)
	emit(runtime.Event{
		Type:    "log",
		Message: fmt.Sprintf("Starting %s runtime for agent %s", adapter.Name(), agent.Name),
	})

	err = adapter.Run(runCtx, runtime.Request{
		RunID:   run.ID,
		TaskID:  task.ID,
		AgentID: agent.ID,
		Prompt:  buildPrompt(task, agent),
		Workdir: workdir,
	}, emit)

	ended := domain.Now()
	run.EndedAt = &ended
	if err != nil {
		run.Status = domain.RunFailed
		run.Error = err.Error()
		if errors.Is(err, context.Canceled) {
			run.Status = domain.RunCancelled
			run.Error = "run cancelled"
		}
	} else {
		run.Status = domain.RunCompleted
		run.Summary = fmt.Sprintf("Completed with %s runtime", adapter.Name())
	}
	s.saveRun(ctx, run, "run.updated")
}

func (s *Scheduler) saveRun(ctx context.Context, run *domain.Run, eventType string) {
	if err := s.store.UpdateRun(ctx, run); err != nil {
		slog.Warn("update run", "run", run.ID, "error", err)
		return
	}
	s.hub.Broadcast(events.Event{Type: eventType, Data: run})
}

func (s *Scheduler) fail(ctx context.Context, run *domain.Run, err error) {
	ended := domain.Now()
	run.Status = domain.RunFailed
	run.Error = err.Error()
	run.EndedAt = &ended
	s.saveRun(ctx, run, "run.updated")
}

func buildPrompt(task *domain.Task, agent *domain.Agent) string {
	return fmt.Sprintf(`You are working on a software development task.

## Task
ID: %s
Title: %s
Status: %s
Priority: %d

## Description
%s

## Agent instructions
%s

## Rules
- Work only inside the provided working directory.
- Read the existing code before changing it.
- Prefer small, reviewable changes.
- Run the relevant checks when possible.
- Do not push, merge, or deploy without explicit human approval.
- Report progress, blockers, and the final summary back to the run.
`, task.ID, task.Title, task.Status, task.Priority, task.Description, agent.Instructions)
}
