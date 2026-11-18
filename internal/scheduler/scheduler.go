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

// Cancel stops a run regardless of its phase (D-M0-01): a queued run is
// marked cancelled so the worker skips it when dequeued, a preparing or
// running run has its context cancelled and the worker persists the terminal
// state. Cancellation never resurrects a finished run because every write
// goes through UpdateRunIfActive.
func (s *Scheduler) Cancel(ctx context.Context, runID string) bool {
	s.mu.Lock()
	cancel, running := s.cancels[runID]
	s.mu.Unlock()
	if running {
		cancel()
		return true
	}

	run, err := s.store.GetRun(ctx, runID)
	if err != nil {
		slog.Warn("cancel run: load", "run", runID, "error", err)
		return false
	}
	if !run.Status.Active() {
		return false
	}
	ended := domain.Now()
	run.Status = domain.RunCancelled
	run.Error = "run cancelled"
	run.EndedAt = &ended
	s.writeActiveRun(ctx, run, "run.updated")
	return true
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
	// A queued run cancelled before the worker picked it up must not execute.
	if !run.Status.Active() {
		slog.Info("skip run: no longer active", "run", run.ID, "status", run.Status)
		return
	}

	task, err := s.store.GetTask(ctx, run.TaskID)
	if err != nil {
		s.finishFailed(ctx, run, "internal_error", "failed to load the task")
		return
	}
	agent, err := s.store.GetAgent(ctx, run.AgentID)
	if err != nil {
		s.finishFailed(ctx, run, "internal_error", "failed to load the agent")
		return
	}
	if !task.Status.Executable() {
		s.finishFailed(ctx, run, "task_not_executable", fmt.Sprintf("task is %s; move it to todo or in_progress before running", task.Status))
		return
	}

	// Register the cancel function before preparing so cancelling works in
	// every phase, then keep the timeout from the agent configuration.
	runCtx := ctx
	cancelRun := func() {}
	if agent.TimeoutMinutes > 0 {
		runCtx, cancelRun = context.WithTimeout(ctx, time.Duration(agent.TimeoutMinutes)*time.Minute)
	} else {
		runCtx, cancelRun = context.WithCancel(ctx)
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

	run.Status = domain.RunPreparing
	started := domain.Now()
	run.StartedAt = &started
	if !s.writeActiveRun(ctx, run, "run.preparing") {
		return
	}

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

	adapter, registered := s.registry.Get(agent.Runtime)
	if !registered {
		// Unknown runtimes fail explicitly; they never fall back to mock (MILE-009).
		emit(runtime.Event{Type: "error", Message: fmt.Sprintf("runtime %q is not registered", agent.Runtime), Data: map[string]any{"errorCode": "runtime_error"}})
		s.finishFailed(ctx, run, "runtime_error", fmt.Sprintf("runtime %q is not registered", agent.Runtime))
		return
	}

	// Code changing runs get an isolated git worktree; mock (non-code) runs
	// only get a plain directory (PRD runtime-and-workspace §8.2).
	codeChange := adapter.Name() != "mock"
	workdir := ""
	if codeChange {
		workspaceRecord, err := s.store.GetWorkspace(ctx, run.WorkspaceID)
		if err != nil || !workspaceRecord.Bound() {
			emit(runtime.Event{Type: "error", Message: "workspace is not bound to a local repository", Data: map[string]any{"errorCode": "workspace_error"}})
			s.finishFailed(ctx, run, "workspace_error", "workspace is not bound to a local repository")
			return
		}
		settings := workspaceRecord.Settings.WithDefaults()
		emit(runtime.Event{
			Type:    "run.workspace.provisioning",
			Message: "Provisioning run workspace",
			Data:    map[string]any{"runId": run.ID},
		})
		worktree, err := s.workspaces.CreateWorktree(runCtx, workspace.WorktreeOptions{
			RepoPath:       workspaceRecord.RepoPath,
			DefaultBranch:  workspaceRecord.DefaultBranch,
			Remote:         settings.Remote,
			WorktreeRoot:   settings.WorktreeRoot,
			BranchTemplate: settings.BranchTemplate,
			TaskID:         task.ID,
			TaskTitle:      task.Title,
			RunID:          run.ID,
		})
		if err != nil {
			if errors.Is(err, context.Canceled) {
				s.finishCancelled(ctx, run)
				return
			}
			emit(runtime.Event{
				Type:    "run.workspace.failed",
				Message: "Failed to provision run workspace",
				Data:    map[string]any{"runId": run.ID, "errorCode": "workspace_error"},
			})
			s.finishFailed(ctx, run, "workspace_error", "failed to provision the run workspace")
			return
		}
		run.Branch = worktree.Branch
		run.BaseCommit = worktree.BaseCommit
		run.Worktree = worktree.Path
		emit(runtime.Event{
			Type:    "run.workspace.ready",
			Message: "Run workspace ready",
			Data: map[string]any{
				"runId":      run.ID,
				"branch":     worktree.Branch,
				"baseCommit": worktree.BaseCommit,
				"path":       worktree.Path,
			},
		})
		workdir = worktree.Path
	} else {
		dir, err := s.workspaces.Prepare(runCtx, run.ID)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				s.finishCancelled(ctx, run)
				return
			}
			s.finishFailed(ctx, run, "workspace_error", "failed to prepare the run directory")
			return
		}
		run.Worktree = dir
		workdir = dir
	}

	run.Status = domain.RunRunning
	if !s.writeActiveRun(ctx, run, "run.running") {
		return
	}

	emit(runtime.Event{
		Type:    "log",
		Message: fmt.Sprintf("Starting %s runtime for agent %s", adapter.Name(), agent.Name),
	})

	err = adapter.Run(runCtx, runtime.Request{
		Prompt:  buildPrompt(task, agent),
		Workdir: workdir,
	}, emit)

	if codeChange && workdir != "" {
		if head, headErr := s.workspaces.HeadCommit(ctx, workdir); headErr == nil && head != "" {
			run.HeadCommit = head
		}
	}

	ended := domain.Now()
	run.EndedAt = &ended
	switch {
	case errors.Is(err, context.Canceled):
		run.Status = domain.RunCancelled
		run.Error = "run cancelled"
		run.ErrorCode = "cancelled"
	case errors.Is(err, context.DeadlineExceeded):
		run.Status = domain.RunFailed
		run.Error = "run timed out"
		run.ErrorCode = "timeout"
		run.FailureDetail = "run timed out"
	case err != nil:
		run.Status = domain.RunFailed
		run.Error = err.Error()
		run.ErrorCode = "runtime_error"
		run.FailureDetail = err.Error()
	default:
		run.Status = domain.RunCompleted
		run.Summary = fmt.Sprintf("Completed with %s runtime", adapter.Name())
	}
	if !s.writeActiveRun(ctx, run, "run.updated") {
		slog.Info("run already terminal; keeping stored state", "run", run.ID)
	}
}

func (s *Scheduler) finishCancelled(ctx context.Context, run *domain.Run) {
	ended := domain.Now()
	run.Status = domain.RunCancelled
	run.Error = "run cancelled"
	run.ErrorCode = "cancelled"
	run.EndedAt = &ended
	s.writeActiveRun(ctx, run, "run.updated")
}

func (s *Scheduler) finishFailed(ctx context.Context, run *domain.Run, code, message string) {
	ended := domain.Now()
	run.Status = domain.RunFailed
	run.Error = message
	run.ErrorCode = code
	run.FailureDetail = message
	run.EndedAt = &ended
	s.writeActiveRun(ctx, run, "run.updated")
}

// writeActiveRun persists a run only while its stored status is still active.
// A concurrent cancel therefore always wins instead of being overwritten by
// the worker (D-M0-01).
func (s *Scheduler) writeActiveRun(ctx context.Context, run *domain.Run, eventType string) bool {
	updated, err := s.store.UpdateRunIfActive(ctx, run)
	if err != nil {
		slog.Warn("update run", "run", run.ID, "error", err)
		return false
	}
	if !updated {
		return false
	}
	s.hub.Broadcast(events.Event{Type: eventType, Data: run})
	return true
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
